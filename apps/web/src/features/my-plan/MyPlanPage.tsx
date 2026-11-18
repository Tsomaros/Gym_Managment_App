import type { MyMemberships, Plan, PlanDay, PlanSummary } from '@gym/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { ApiError, apiFetch } from '../../api/client';
import { PlanView } from '../plans/PlanView';
import { WorkoutPage } from '../workout/WorkoutPage';

/** A PDF link is signed for 5 minutes; refresh a little before that. */
const LINK_MAX_AGE_MS = 4 * 60_000;

/** Without a plan the API answers 404: that is "none yet", not a failure. */
const orNone = <T,>(promise: Promise<T>): Promise<T | null> =>
  promise.catch((err: unknown) => {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  });

/**
 * The member's own workout plan: the active one day by day (or its PDF), and older plans to look
 * back at. A day of the active plan can be started: the workout logger takes over the page.
 */
export function MyPlanPage() {
  const { t } = useTranslation();
  const { gymId = '' } = useParams();
  const [active, setActive] = useState<Plan | null | undefined>(undefined);
  const [older, setOlder] = useState<PlanSummary[]>([]);
  // Unknown (the memberships could not be read): the friendlier "talk to your trainer" wording.
  const [hasTrainer, setHasTrainer] = useState(true);
  const [opened, setOpened] = useState<Plan | null>(null);
  const [failed, setFailed] = useState(false);
  const [openFailed, setOpenFailed] = useState<string | null>(null);
  // The day being logged: the workout replaces the plan until it is closed.
  const [workout, setWorkout] = useState<{ plan: Plan; day: PlanDay } | null>(null);
  // When the plan on screen was fetched: a PDF link signed then expires 5 minutes later.
  const fetchedAt = useRef(Date.now());
  const backRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      // The plan is what the member came for; the older plans and the wording of the empty state
      // are extras that must not hide it when they fail.
      const [plan, list, mine] = await Promise.all([
        orNone(apiFetch<Plan>(`/gyms/${gymId}/me/plans/active`)),
        apiFetch<PlanSummary[]>(`/gyms/${gymId}/me/plans`).catch(() => [] as PlanSummary[]),
        apiFetch<MyMemberships>(`/gyms/${gymId}/me/memberships`).catch(() => null),
      ]);
      fetchedAt.current = Date.now();
      setActive(plan);
      setOlder(list.filter((p) => p.status === 'archived'));
      if (mine) {
        setHasTrainer(
          mine.memberships.some(
            (m) =>
              m.includesTrainer &&
              (m.status === 'active' || m.status === 'frozen' || m.status === 'upcoming'),
          ),
        );
      }
    } catch {
      setFailed(true);
    }
  }, [gymId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function open(id: string) {
    setOpenFailed(null);
    try {
      const plan = await apiFetch<Plan>(`/gyms/${gymId}/plans/${id}`);
      fetchedAt.current = Date.now();
      setOpened(plan);
      // The plan appears at the top, far from the list that was tapped: bring focus along.
      requestAnimationFrame(() => backRef.current?.focus());
    } catch {
      setOpenFailed(id);
    }
  }

  // Back after a while: a PDF link signed before leaving may have expired. Refresh it quietly,
  // keeping what is on screen if that fails.
  const shown = opened ?? active ?? null;
  const shownId = shown?.id;
  const shownIsPdf = shown?.kind === 'pdf';
  useEffect(() => {
    if (!shownIsPdf || !shownId) return;
    const refresh = async () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - fetchedAt.current < LINK_MAX_AGE_MS) return;
      try {
        const plan = await apiFetch<Plan>(`/gyms/${gymId}/plans/${shownId}`);
        fetchedAt.current = Date.now();
        if (opened) setOpened(plan);
        else setActive(plan);
      } catch {
        // keep the plan that is already on screen
      }
    };
    const onVisible = () => void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [gymId, shownId, shownIsPdf, opened]);

  if (workout) {
    return (
      <WorkoutPage
        plan={workout.plan}
        day={workout.day}
        onExit={() => {
          setWorkout(null);
          void load();
        }}
      />
    );
  }

  const others = older.filter((p) => p.id !== shown?.id);
  const problem = failed || openFailed !== null;

  return (
    <section aria-labelledby="my-plan-title" className="mx-auto flex max-w-md flex-col gap-5">
      <h2 id="my-plan-title" className="text-xl font-semibold text-slate-900">
        {t('plans.my.title')}
      </h2>
      {problem && (
        <div role="alert" className="flex items-center gap-3 text-red-700">
          {t('common.genericError')}
          <button
            type="button"
            onClick={() => void (openFailed ? open(openFailed) : load())}
            className="min-h-11 underline"
          >
            {t('app.retry')}
          </button>
        </div>
      )}
      {active === undefined && !failed && (
        <p role="status" className="text-slate-600">
          {t('app.loading')}
        </p>
      )}
      {opened && (
        <button
          ref={backRef}
          type="button"
          onClick={() => setOpened(null)}
          className="min-h-11 self-start rounded-md border border-slate-400 bg-white px-4 font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {t('plans.my.backToCurrent')}
        </button>
      )}
      {shown && (
        <PlanView
          key={shown.id}
          plan={shown}
          layout="tabs"
          onStartDay={
            shown.id === active?.id && shown.kind === 'interactive'
              ? (day) => setWorkout({ plan: shown, day })
              : undefined
          }
        />
      )}
      {active === null && !opened && !failed && (
        <p className="text-lg text-slate-800">
          {hasTrainer ? t('plans.my.empty') : t('plans.my.emptyNoTrainer')}
        </p>
      )}
      {others.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-white p-3">
          <summary className="min-h-11 cursor-pointer content-center font-medium text-slate-900">
            {t('plans.my.older')}
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {others.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2">
                <span className="mr-auto min-w-0 break-words text-slate-900">{p.title}</span>
                <button
                  type="button"
                  aria-label={t('plans.openNamed', { title: p.title })}
                  onClick={() => void open(p.id)}
                  className="min-h-11 rounded-md border border-slate-400 px-3 text-sm font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                >
                  {t('plans.open')}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
