import type { Exercise, LastPerformance, Plan, PlanDay, WorkoutSession } from '@gym/shared';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../api/client';
import { viewerLanguage } from '../exercises/exerciseName';
import { enqueue, flush, type QueuedOp, size, subscribe } from './workoutQueue';
import {
  applyStored,
  canBeDone,
  cardFromExercise,
  cardFromPlanExercise,
  type LogCard,
  type LogSet,
  newRow,
  setBody,
  summarise,
  type Summary,
} from './workoutModel';

export const FLUSH_INTERVAL_MS = 15_000;

const send = (op: QueuedOp): Promise<void> =>
  apiFetch<void>(op.path, {
    method: op.method,
    body: op.body === undefined ? undefined : JSON.stringify(op.body),
  });

export type WorkoutStatus = 'loading' | 'ready' | 'finished' | 'error';

/**
 * A workout in progress, from a plan day or free. Every change goes through the offline queue
 * and shows at once (optimistic); the queue is sent whenever it can be. An open session found on
 * load is resumed, so closing the app mid-workout loses nothing.
 */
export function useWorkoutSession({
  gymId,
  plan,
  day,
}: {
  gymId: string;
  plan?: Plan;
  day?: PlanDay;
}) {
  const { i18n } = useTranslation();
  const lang = viewerLanguage(i18n.language);
  const [status, setStatus] = useState<WorkoutStatus>('loading');
  const [cards, setCards] = useState<LogCard[]>([]);
  const [refusedSetId, setRefusedSetId] = useState<string | null>(null);
  const [rest, setRest] = useState<{ seconds: number; at: number } | null>(null);
  const [dropped, setDropped] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const queued = useSyncExternalStore(subscribe, size, size);

  const cardsRef = useRef<LogCard[]>([]);
  const sessionId = useRef<string>('');
  const base = `/gyms/${gymId}/me/sessions`;

  const flushNow = useCallback(
    () => flush(send, () => setDropped(true)).catch(() => undefined),
    [],
  );
  const commit = useCallback((next: LogCard[]) => {
    cardsRef.current = next;
    setCards(next);
  }, []);
  const write = useCallback(
    (op: QueuedOp) => {
      enqueue(op);
      void flushNow();
    },
    [flushNow],
  );

  // Start or resume.
  const dayId = day?.id;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus('loading');
      await flushNow(); // what an earlier visit left behind goes first
      const ids = [...new Set(day?.exercises.map((e) => e.exerciseId) ?? [])];
      const [lastList, sessions] = await Promise.all([
        ids.length
          ? apiFetch<LastPerformance[]>(
              `/gyms/${gymId}/me/last-performance?exerciseIds=${ids.join(',')}`,
            ).catch(() => [] as LastPerformance[])
          : Promise.resolve([] as LastPerformance[]),
        // null: unknown (offline) — then a fresh session is started and the server sorts it out
        apiFetch<WorkoutSession[]>(`${base}?limit=1`).catch(() => null),
      ]);
      if (cancelled) return;
      const last = new Map(lastList.map((l) => [l.exerciseId, l]));
      const newest = sessions?.[0];
      const open =
        newest && newest.finishedAt === null && (newest.planDayId ?? null) === (dayId ?? null)
          ? newest
          : null;

      let initial: LogCard[] = day
        ? day.exercises.map((e) => cardFromPlanExercise(e, last.get(e.exerciseId) ?? null, lang))
        : [];
      if (open) {
        sessionId.current = open.id;
        if (!day && open.sets.length) {
          // A free workout: the cards are the exercises the session already holds.
          const library = await apiFetch<Exercise[]>(`/gyms/${gymId}/exercises`).catch(() => []);
          if (cancelled) return;
          const byId = new Map(library.map((x) => [x.id, x]));
          const order = [...new Set(open.sets.map((s) => s.exerciseId))];
          initial = order.flatMap((id) => {
            const ex = byId.get(id);
            return ex ? [cardFromExercise(ex, null)] : [];
          });
        }
        initial = initial.map((c) => applyStored(c, open.sets));
      } else {
        sessionId.current = crypto.randomUUID();
        write({
          method: 'PUT',
          path: `${base}/${sessionId.current}`,
          body: {
            startedAt: new Date().toISOString(),
            planId: plan?.id,
            planDayId: day?.id,
          },
        });
      }
      commit(initial);
      setStatus('ready');
    })().catch(() => !cancelled && setStatus('error'));
    return () => {
      cancelled = true;
    };
  }, [gymId, dayId]);

  // Send the queue whenever the phone is back online, and now and then while something waits.
  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      void flushNow();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const timer = setInterval(() => {
      if (size() > 0) void flushNow();
    }, FLUSH_INTERVAL_MS);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      clearInterval(timer);
    };
  }, [flushNow]);

  /** Applies `edit` to one card and returns the new card and the changed row index. */
  const editCard = (key: string, edit: (c: LogCard) => LogCard): LogCard | null => {
    const current = cardsRef.current;
    const at = current.findIndex((c) => c.key === key);
    if (at < 0) return null;
    const card = edit(current[at]!);
    commit(current.map((c, i) => (i === at ? card : c)));
    return card;
  };
  const putSet = (card: LogCard, index: number) =>
    write({
      method: 'PUT',
      path: `${base}/${sessionId.current}/sets/${card.sets[index]!.id}`,
      body: setBody(card, index, new Date().toISOString()),
    });

  const change = (key: string, index: number, patch: Partial<LogSet>) => {
    setRefusedSetId(null);
    const card = editCard(key, (c) => ({
      ...c,
      sets: c.sets.map((s, i) => (i === index ? { ...s, ...patch, touched: true } : s)),
    }));
    if (card) putSet(card, index);
  };

  const toggleDone = (key: string, index: number) => {
    const card = cardsRef.current.find((c) => c.key === key);
    const row = card?.sets[index];
    if (!card || !row) return;
    if (!row.done && !canBeDone(card.measure, row)) {
      setRefusedSetId(row.id); // the server would refuse it: say so instead of losing the set
      return;
    }
    setRefusedSetId(null);
    const next = editCard(key, (c) => ({
      ...c,
      sets: c.sets.map((s, i) => (i === index ? { ...s, done: !s.done, touched: true } : s)),
    }));
    if (!next) return;
    putSet(next, index);
    if (!row.done && card.restSeconds) setRest({ seconds: card.restSeconds, at: Date.now() });
  };

  const addSet = (key: string) =>
    void editCard(key, (c) => ({ ...c, sets: [...c.sets, newRow(c)] }));

  const removeLastSet = (key: string) => {
    const card = cardsRef.current.find((c) => c.key === key);
    const row = card?.sets.at(-1);
    if (!card || !row || card.sets.length < 2) return;
    editCard(key, (c) => ({ ...c, sets: c.sets.slice(0, -1) }));
    if (row.touched) {
      write({ method: 'DELETE', path: `${base}/${sessionId.current}/sets/${row.id}` });
    }
  };

  const addExercise = async (exercise: Exercise) => {
    if (cardsRef.current.some((c) => c.key === exercise.id)) return;
    const last = await apiFetch<LastPerformance[]>(
      `/gyms/${gymId}/me/last-performance?exerciseIds=${exercise.id}`,
    ).catch(() => [] as LastPerformance[]);
    if (cardsRef.current.some((c) => c.key === exercise.id)) return;
    commit([...cardsRef.current, cardFromExercise(exercise, last[0] ?? null)]);
  };

  const finish = () => {
    write({ method: 'POST', path: `${base}/${sessionId.current}/finish` });
    setSummary(summarise(cardsRef.current));
    setRest(null);
    setStatus('finished');
  };

  return {
    status,
    cards,
    refusedSetId,
    rest,
    clearRest: () => setRest(null),
    summary,
    queued,
    online,
    dropped,
    change,
    toggleDone,
    addSet,
    removeLastSet,
    addExercise,
    finish,
  };
}
