import type {
  Exercise,
  LastPerformance,
  Measure,
  PlanExercise,
  SetUpsert,
  WorkoutSet,
} from '@gym/shared';
import { formatKg, formatTarget } from '../plans/planFormat';

export const MAX_REPS = 100;
export const MAX_KG = 999.75;
export const MAX_SECONDS = 7200;
export const KG_STEP = 2.5;
export const SECONDS_STEP = 5;

/** One row of an exercise card. `touched` rows are on the server (or queued for it). */
export interface LogSet {
  id: string;
  reps: number;
  weightKg: number;
  durationSeconds: number;
  done: boolean;
  touched: boolean;
  /**
   * The set's place under its exercise on the server (unique per session and exercise). It is
   * not the row's position: a day may list one exercise twice, and two cards share one sequence.
   */
  index: number;
}

export interface LogCard {
  /** The plan exercise's id, or the exercise's own id in a free workout. */
  key: string;
  exerciseId: string;
  planExerciseId: string | null;
  name: { nameEl: string; nameEn: string | null };
  measure: Measure;
  /** "4 × 8–10 @ 50 kg", from the plan; null in a free workout. */
  target: string | null;
  restSeconds: number | null;
  last: LastPerformance | null;
  sets: LogSet[];
}

/** A decimal typed with a Greek comma or a dot ("22,5"); null when it is not a number. */
export function parseDecimal(text: string): number | null {
  const clean = text.trim().replace(',', '.');
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(clean)) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

export const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, n));

/** The server stores kg in steps of 0.25. */
export const toKgStep = (kg: number): number => clamp(Math.round(kg * 4) / 4, 0, MAX_KG);

/** 90 → "1:30", 45 → "0:45". */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** "1:30" or "90" → 90 seconds; null when it is neither. */
export function parseDuration(text: string): number | null {
  const clean = text.trim();
  const colon = /^(\d{1,3}):([0-5]?\d)$/.exec(clean);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);
  return /^\d{1,5}$/.test(clean) ? Number(clean) : null;
}

/** What the previous session did with an exercise, as a line: "50×10, 50×9", "60″, 45″". */
export function formatLast(last: LastPerformance, measure: Measure, lang: 'el' | 'en'): string {
  return last.sets
    .map((s) => {
      if (measure === 'duration') return `${s.durationSeconds ?? 0}″`;
      if (measure === 'reps') return `${s.reps ?? 0}`;
      return `${formatKg(s.weightKg ?? 0, lang)}×${s.reps ?? 0}`;
    })
    .join(', ');
}

const newId = (): string => crypto.randomUUID();

/** An untouched row, filled from the plan's target and what the member did last time. */
function prefill(
  measure: Measure,
  target: PlanExercise | null,
  last: LastPerformance | null,
  index: number,
): LogSet {
  const before = last?.sets[index] ?? last?.sets.at(-1);
  return {
    id: newId(),
    reps: clamp(target?.repsMin ?? before?.reps ?? 0, 0, MAX_REPS),
    weightKg: toKgStep(before?.weightKg ?? target?.weightKg ?? 0),
    // a timed set needs at least a second
    durationSeconds: clamp(
      target?.durationSeconds ?? before?.durationSeconds ?? 60,
      1,
      MAX_SECONDS,
    ),
    done: false,
    touched: false,
    index,
  };
}

export function cardFromPlanExercise(
  e: PlanExercise,
  last: LastPerformance | null,
  lang: 'el' | 'en',
): LogCard {
  return {
    key: e.id,
    exerciseId: e.exerciseId,
    planExerciseId: e.id,
    name: { nameEl: e.exercise.nameEl, nameEn: e.exercise.nameEn },
    measure: e.exercise.measure,
    target: formatTarget(e, lang),
    restSeconds: e.restSeconds,
    last,
    sets: Array.from({ length: e.sets }, (_, i) => prefill(e.exercise.measure, e, last, i)),
  };
}

export function cardFromExercise(e: Exercise, last: LastPerformance | null): LogCard {
  return {
    key: e.id,
    exerciseId: e.id,
    planExerciseId: null,
    name: { nameEl: e.nameEl, nameEn: e.nameEn },
    measure: e.measure,
    target: null,
    restSeconds: null,
    last,
    sets: [prefill(e.measure, null, last, 0)],
  };
}

/** The next free server index of an exercise across every card that holds it. */
function nextIndex(cards: LogCard[], exerciseId: string): number {
  let max = -1;
  for (const c of cards) {
    if (c.exerciseId === exerciseId) for (const r of c.sets) max = Math.max(max, r.index);
  }
  return max + 1;
}

/** A new untouched row at the end of `card`, numbered after every row of the same exercise. */
export function newRow(card: LogCard, all: LogCard[]): LogSet {
  return {
    ...prefill(card.measure, null, card.last, card.sets.length),
    index: nextIndex(all, card.exerciseId),
  };
}

/**
 * Gives the untouched rows of each exercise consecutive indexes across all its cards, skipping
 * the ones touched rows already hold (those are on the server and never move).
 */
export function normalise(cards: LogCard[]): LogCard[] {
  const used = new Map<string, Set<number>>();
  for (const c of cards) {
    const set = used.get(c.exerciseId) ?? new Set<number>();
    for (const r of c.sets) if (r.touched) set.add(r.index);
    used.set(c.exerciseId, set);
  }
  const counter = new Map<string, number>();
  return cards.map((c) => ({
    ...c,
    sets: c.sets.map((r) => {
      if (r.touched) return r;
      const taken = used.get(c.exerciseId)!;
      let n = counter.get(c.exerciseId) ?? 0;
      while (taken.has(n)) n++;
      taken.add(n);
      counter.set(c.exerciseId, n + 1);
      return { ...r, index: n };
    }),
  }));
}

/**
 * Puts what the server stored into the cards' rows (a resumed session). A set belongs to the
 * card of its plan exercise; one whose plan exercise is gone (or a free workout's) goes to the
 * first card of that exercise.
 */
export function applyStored(cards: LogCard[], stored: WorkoutSet[]): LogCard[] {
  const claimed = new Set<string>();
  const byCard: WorkoutSet[][] = cards.map((c) => {
    if (!c.planExerciseId) return [];
    const mine = stored.filter((s) => s.planExerciseId === c.planExerciseId);
    for (const m of mine) claimed.add(m.id);
    return mine;
  });
  for (const s of stored) {
    if (claimed.has(s.id)) continue;
    const at = cards.findIndex((c) => c.exerciseId === s.exerciseId);
    if (at >= 0) byCard[at]!.push(s);
  }
  const placed = cards.map((card, ci) => {
    const mine = [...byCard[ci]!].sort((a, b) => a.setIndex - b.setIndex);
    if (!mine.length) return card;
    const sets = [...card.sets];
    mine.forEach((s, k) => {
      sets[k] = {
        id: s.id,
        reps: s.reps ?? 0,
        weightKg: s.weightKg ?? 0,
        durationSeconds: s.durationSeconds ?? 60,
        done: s.done,
        touched: true,
        index: s.setIndex,
      };
    });
    return { ...card, sets };
  });
  return normalise(placed);
}

/** The body of the PUT for one row: only the values its exercise is measured by. */
export function setBody(card: LogCard, index: number, loggedAt: string): SetUpsert {
  const s = card.sets[index]!;
  return {
    exerciseId: card.exerciseId,
    planExerciseId: card.planExerciseId,
    setIndex: s.index,
    reps: card.measure === 'duration' ? undefined : s.reps,
    weightKg: card.measure === 'weight_reps' ? s.weightKg : undefined,
    durationSeconds: card.measure === 'duration' ? s.durationSeconds : undefined,
    done: s.done,
    loggedAt,
  };
}

/** A set cannot be done without a rep (the server refuses it). */
export const canBeDone = (measure: Measure, s: LogSet): boolean =>
  measure === 'duration' ? s.durationSeconds >= 1 : s.reps >= 1;

export interface Summary {
  exercises: number;
  sets: number;
  volumeKg: number;
}

export function summarise(cards: LogCard[]): Summary {
  let sets = 0;
  let volumeKg = 0;
  let exercises = 0;
  for (const c of cards) {
    const done = c.sets.filter((s) => s.done);
    if (done.length) exercises += 1;
    sets += done.length;
    if (c.measure === 'weight_reps') volumeKg += done.reduce((n, s) => n + s.weightKg * s.reps, 0);
  }
  return { exercises, sets, volumeKg };
}
