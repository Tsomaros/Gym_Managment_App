import type { Exercise, WorkoutSession } from '@gym/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { apiFetch } from '../../api/client';
import { exerciseName, viewerLanguage } from '../exercises/exerciseName';
import { formatKg } from '../plans/planFormat';

const PAGE = 20;

function dateLabel(iso: string, lang: 'el' | 'en'): string {
  return new Intl.DateTimeFormat(lang === 'el' ? 'el-GR' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

/** The member's past workouts, newest first: when, plan or free, and what was lifted. */
export function WorkoutHistoryPage() {
  const { t, i18n } = useTranslation();
  const lang = viewerLanguage(i18n.language);
  const { gymId = '' } = useParams();
  const [sessions, setSessions] = useState<WorkoutSession[] | null>(null);
  const [more, setMore] = useState(false);
  const [names, setNames] = useState<Map<string, Exercise>>(new Map());
  const [failed, setFailed] = useState(false);

  const load = useCallback(
    async (before?: string) => {
      setFailed(false);
      try {
        const q = new URLSearchParams({ limit: String(PAGE) });
        if (before) q.set('before', before);
        const page = await apiFetch<WorkoutSession[]>(`/gyms/${gymId}/me/sessions?${q}`);
        setSessions((cur) => (before ? [...(cur ?? []), ...page] : page));
        setMore(page.length === PAGE);
      } catch {
        setFailed(true);
      }
    },
    [gymId],
  );
  useEffect(() => {
    void load();
    // names are an extra: the list works without them
    apiFetch<Exercise[]>(`/gyms/${gymId}/exercises`)
      .then((list) => setNames(new Map(list.map((e) => [e.id, e]))))
      .catch(() => undefined);
  }, [gymId, load]);

  return (
    <section aria-labelledby="history-title" className="mx-auto flex max-w-md flex-col gap-4">
      <h2 id="history-title" className="text-xl font-semibold text-slate-900">
        {t('workout.historyTitle')}
      </h2>
      {failed && (
        <div role="alert" className="flex items-center gap-3 text-red-700">
          {t('common.genericError')}
          <button
            type="button"
            onClick={() => void load(more ? sessions?.at(-1)?.startedAt : undefined)}
            className="min-h-11 underline"
          >
            {t('app.retry')}
          </button>
        </div>
      )}
      {sessions === null && !failed && (
        <p role="status" className="text-slate-700">
          {t('app.loading')}
        </p>
      )}
      {sessions?.length === 0 && (
        <p className="text-lg text-slate-800">{t('workout.historyEmpty')}</p>
      )}
      <ul className="flex flex-col gap-3">
        {sessions?.map((s) => {
          const done = s.sets.filter((x) => x.done);
          const byExercise = [...new Set(done.map((x) => x.exerciseId))];
          return (
            <li key={s.id} className="rounded-xl border border-slate-300 bg-white p-3">
              <p className="font-semibold text-slate-900">
                {dateLabel(s.startedAt, lang)}
                <span className="ml-2 font-normal text-slate-700">
                  {s.planDayId || s.planId ? t('workout.fromPlan') : t('workout.free')}
                </span>
              </p>
              {done.length === 0 ? (
                <p className="text-sm text-slate-600">{t('workout.noSets')}</p>
              ) : (
                <ul className="mt-1 flex flex-col gap-1 text-slate-800">
                  {byExercise.map((id) => {
                    const sets = done.filter((x) => x.exerciseId === id);
                    const ex = names.get(id);
                    return (
                      <li key={id} className="break-words">
                        <span className="font-medium">
                          {ex ? exerciseName(ex, lang) : t('workout.unknownExercise')}
                        </span>
                        {': '}
                        <span className="tabular-nums">
                          {sets
                            .map((x) =>
                              x.measure === 'duration'
                                ? `${x.durationSeconds}″`
                                : x.measure === 'reps'
                                  ? `${x.reps}`
                                  : `${formatKg(x.weightKg ?? 0, lang)}×${x.reps}`,
                            )
                            .join(', ')}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {more && (
        <button
          type="button"
          onClick={() => void load(sessions?.at(-1)?.startedAt)}
          className="min-h-11 rounded-md border border-slate-500 bg-white px-4 font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {t('workout.loadMore')}
        </button>
      )}
    </section>
  );
}
