import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDuration } from './workoutModel';

/**
 * The rest between sets: a visible countdown that starts again whenever `startedAt` changes and
 * buzzes (where the phone allows it) when it reaches zero. The screen reader hears the start and
 * the end, not every second.
 */
export function RestTimer({
  seconds,
  startedAt,
  onSkip,
}: {
  seconds: number;
  /** A new value (e.g. a timestamp) restarts the countdown. */
  startedAt: number;
  onSkip: () => void;
}) {
  const { t } = useTranslation();
  const [left, setLeft] = useState(seconds);

  useEffect(() => {
    const endAt = Date.now() + seconds * 1000;
    setLeft(seconds);
    let buzzed = false;
    const tick = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      setLeft(remaining);
      if (remaining === 0 && !buzzed) {
        buzzed = true;
        clearInterval(tick);
        navigator.vibrate?.([200, 100, 200]);
      }
    }, 250);
    return () => clearInterval(tick);
  }, [seconds, startedAt]);

  const over = left === 0;
  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-xl border-2 px-4 py-2 ${
        over ? 'border-green-700 bg-green-50' : 'border-slate-900 bg-white'
      }`}
    >
      <div className="mr-auto">
        <p className="text-sm font-medium text-slate-700">{t('workout.rest')}</p>
        <p
          role="timer"
          aria-label={t('workout.rest')}
          className="text-3xl font-bold tabular-nums text-slate-900"
        >
          {formatDuration(left)}
        </p>
      </div>
      <p role="status" className="sr-only">
        {over ? t('workout.restDone') : t('workout.restStarted', { seconds })}
      </p>
      {over && (
        <p aria-hidden className="text-lg font-semibold text-green-800">
          {t('workout.restDone')}
        </p>
      )}
      <button
        type="button"
        onClick={onSkip}
        className="min-h-11 rounded-md border border-slate-500 px-4 font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
      >
        {over ? t('common.close') : t('workout.skipRest')}
      </button>
    </div>
  );
}
