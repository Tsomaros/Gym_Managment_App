import type { Plan, PlanDay } from '@gym/shared';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { formatKg } from '../plans/planFormat';
import { viewerLanguage } from '../exercises/exerciseName';
import { ExerciseLogCard } from './ExerciseLogCard';
import { FreeWorkoutPicker } from './FreeWorkoutPicker';
import { RestTimer } from './RestTimer';
import { useWorkoutSession } from './useWorkoutSession';

/** "Saved" or "Offline — will be saved (n)": never leaves the member guessing. */
function SaveStatus({ queued, online }: { queued: number; online: boolean }) {
  const { t } = useTranslation();
  const pending = queued > 0;
  return (
    <p
      role="status"
      className={`text-sm font-medium ${pending ? 'text-amber-900' : 'text-green-800'}`}
    >
      {pending
        ? online
          ? t('workout.saving', { count: queued })
          : t('workout.queued', { count: queued })
        : t('workout.saved')}
    </p>
  );
}

/**
 * Logging a workout: one card per exercise with a row per set, a rest timer, a status line that
 * says whether everything is saved, and "Finish workout". The session starts when this mounts.
 */
export function WorkoutPage({
  plan,
  day,
  onExit,
}: {
  plan?: Plan;
  day?: PlanDay;
  onExit?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = viewerLanguage(i18n.language);
  const { gymId = '' } = useParams();
  const w = useWorkoutSession({ gymId, plan, day });
  const [confirmFinish, setConfirmFinish] = useState(false);
  const finishRef = useRef<HTMLButtonElement>(null);
  const free = !day;

  const title = day ? t('workout.dayTitle', { day: day.title }) : t('workout.freeTitle');

  if (w.status === 'loading') {
    return (
      <p role="status" className="text-slate-700">
        {t('app.loading')}
      </p>
    );
  }
  if (w.status === 'error') {
    return (
      <p role="alert" className="text-red-700">
        {t('common.genericError')}
      </p>
    );
  }
  if (w.status === 'finished' && w.summary) {
    return (
      <section aria-labelledby="workout-done" className="mx-auto flex max-w-md flex-col gap-4">
        <h2 id="workout-done" tabIndex={-1} className="text-xl font-semibold text-slate-900">
          {t('workout.finishedTitle')}
        </h2>
        <dl className="grid grid-cols-3 gap-2 text-center">
          {[
            [t('workout.sumExercises'), String(w.summary.exercises)],
            [t('workout.sumSets'), String(w.summary.sets)],
            [t('workout.sumVolume'), `${formatKg(w.summary.volumeKg, lang)} kg`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-slate-300 bg-white p-3">
              <dt className="text-sm text-slate-700">{label}</dt>
              <dd className="text-2xl font-bold tabular-nums text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>
        <SaveStatus queued={w.queued} online={w.online} />
        {onExit && (
          <button
            type="button"
            onClick={onExit}
            className="min-h-12 rounded-md bg-slate-900 px-6 text-lg font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            {t('workout.back')}
          </button>
        )}
      </section>
    );
  }

  return (
    <section aria-labelledby="workout-title" className="mx-auto flex max-w-md flex-col gap-4 pb-28">
      <div className="flex flex-wrap items-baseline gap-x-4">
        <h2 id="workout-title" className="mr-auto text-xl font-semibold break-words text-slate-900">
          {title}
        </h2>
        <SaveStatus queued={w.queued} online={w.online} />
      </div>
      {w.dropped && (
        <p role="alert" className="text-red-700">
          {t('workout.dropped')}
        </p>
      )}
      {free && w.cards.length === 0 && (
        <p className="text-lg text-slate-800">{t('workout.emptyFree')}</p>
      )}
      {w.cards.map((card) => (
        <ExerciseLogCard
          key={card.key}
          card={card}
          refusedSetId={w.refusedSetId}
          onChange={(i, patch) => w.change(card.key, i, patch)}
          onToggleDone={(i) => w.toggleDone(card.key, i)}
          onAddSet={() => w.addSet(card.key)}
          onRemoveSet={() => w.removeLastSet(card.key)}
        />
      ))}
      {free && <FreeWorkoutPicker gymId={gymId} onPick={(e) => void w.addExercise(e)} />}
      {confirmFinish ? (
        <div
          className="flex flex-col gap-2 rounded-xl border-2 border-slate-900 bg-white p-3"
          role="group"
          aria-label={t('workout.finish')}
        >
          <p className="font-medium text-slate-900">{t('workout.confirmFinish')}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={w.finish}
              className="min-h-12 flex-1 rounded-md bg-slate-900 px-4 font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              {t('workout.finish')}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmFinish(false);
                requestAnimationFrame(() => finishRef.current?.focus());
              }}
              className="min-h-12 rounded-md border border-slate-500 px-4 font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              {t('workout.keepGoing')}
            </button>
          </div>
        </div>
      ) : (
        <button
          ref={finishRef}
          type="button"
          onClick={() => setConfirmFinish(true)}
          className="min-h-12 rounded-md bg-slate-900 px-6 text-lg font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {t('workout.finish')}
        </button>
      )}
      {w.rest && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-300 bg-white/95 p-3">
          <div className="mx-auto max-w-md">
            <RestTimer seconds={w.rest.seconds} startedAt={w.rest.at} onSkip={w.clearRest} />
          </div>
        </div>
      )}
    </section>
  );
}

/** The free workout: a start button first, so merely opening the page never creates a session. */
export function FreeWorkoutPage() {
  const { t } = useTranslation();
  const [started, setStarted] = useState(false);
  if (started) return <WorkoutPage onExit={() => setStarted(false)} />;
  return (
    <section aria-labelledby="free-title" className="mx-auto flex max-w-md flex-col gap-4">
      <h2 id="free-title" className="text-xl font-semibold text-slate-900">
        {t('workout.freeTitle')}
      </h2>
      <p className="text-slate-800">{t('workout.freeIntro')}</p>
      <button
        type="button"
        onClick={() => setStarted(true)}
        className="min-h-14 rounded-md bg-slate-900 px-6 text-lg font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
      >
        {t('workout.startFree')}
      </button>
    </section>
  );
}
