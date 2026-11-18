import type {
  AttendancePoint,
  ConsentState,
  ExerciseProgress,
  Measurement,
  ProgressExerciseOption,
  VolumePoint,
} from '@gym/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { ApiError, apiFetch } from '../../api/client';
import { exerciseName, viewerLanguage } from '../exercises/exerciseName';
import { ConsentCard } from '../health/ConsentCard';
import { MeasurementsList } from '../health/MeasurementsList';
import { ProgressPhotos } from '../health/ProgressPhotos';
import { AttendanceChart, ExerciseChart, MeasurementsChart, VolumeChart } from './charts';
import { DEFAULT_WEEKS, RANGES } from './chartTheme';

/** Only "not found" means "none"; any other failure is a failure to show, never an empty chart. */
const orNull = <T,>(promise: Promise<T>): Promise<T | null> =>
  promise.catch((err: unknown) => {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  });

/**
 * Progress charts: for the signed-in member (no `memberId`, the /me routes) or, for a trainer,
 * one of their clients (remount with `key` when the client changes). Exercise, weekly volume,
 * attendance and, only with the member's consent and data, body measurements. A member also
 * finds here the consent for body data, their measurements and their progress photos.
 * Every answer remembers the range it was fetched for: a chart never carries the label of a
 * range it does not show.
 */
export function ProgressPage({ memberId }: { memberId?: string }) {
  const { t, i18n } = useTranslation();
  const lang = viewerLanguage(i18n.language);
  const { gymId = '' } = useParams();
  const base = `/gyms/${gymId}/${memberId ? `members/${memberId}` : 'me'}`;
  const own = !memberId;
  const [weeks, setWeeks] = useState<number>(DEFAULT_WEEKS);
  const [options, setOptions] = useState<ProgressExerciseOption[] | null>(null);
  const [exerciseId, setExerciseId] = useState<string | null>(null);
  const [data, setData] = useState<{
    weeks: number;
    volume: VolumePoint[];
    attendance: AttendancePoint[];
  } | null>(null);
  const [exercise, setExercise] = useState<{ weeks: number; progress: ExerciseProgress } | null>(
    null,
  );
  const [consents, setConsents] = useState<ConsentState | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // What does not depend on the range: which exercises there are, the consent, the measurements.
  useEffect(() => {
    let current = true;
    setFailed(false);
    (async () => {
      const [opts, consent] = await Promise.all([
        apiFetch<ProgressExerciseOption[]>(`${base}/progress/exercises`),
        orNull(apiFetch<ConsentState>(`${base}/consents`)),
      ]);
      const list =
        consent?.measurements.granted === true
          ? ((await orNull(apiFetch<Measurement[]>(`${base}/measurements`))) ?? [])
          : [];
      if (!current) return;
      setOptions(opts);
      // keep the choice while it still exists, else the first exercise
      setExerciseId((cur) =>
        cur && opts.some((o) => o.exerciseId === cur) ? cur : (opts[0]?.exerciseId ?? null),
      );
      setConsents(consent);
      setMeasurements(list);
    })().catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [base, attempt]);

  // What follows the range.
  useEffect(() => {
    let current = true;
    setFailed(false);
    Promise.all([
      apiFetch<VolumePoint[]>(`${base}/progress/volume?weeks=${weeks}`),
      apiFetch<AttendancePoint[]>(`${base}/progress/attendance?weeks=${weeks}`),
    ])
      .then(([volume, attendance]) => current && setData({ weeks, volume, attendance }))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [base, weeks, attempt]);

  useEffect(() => {
    if (!exerciseId) {
      setExercise(null);
      return;
    }
    let current = true;
    setFailed(false);
    apiFetch<ExerciseProgress>(`${base}/progress/exercises/${exerciseId}?weeks=${weeks}`)
      .then((progress) => current && setExercise({ weeks, progress }))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [base, exerciseId, weeks, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const chosen = options?.find((o) => o.exerciseId === exerciseId);
  // The chart answers the exercise and the range on screen: nothing else is ever shown under them.
  const exerciseReady =
    exercise !== null && exercise.progress.exerciseId === exerciseId && exercise.weeks === weeks;
  const dataReady = data !== null && data.weeks === weeks;
  // The measurements chart starts where the other charts do: at the first week they show.
  const cutoff = data?.volume[0]?.weekStart ?? '';
  const shownMeasurements = measurements.filter((m) => m.measuredOn >= cutoff);

  return (
    <section aria-labelledby="progress-title" className="mx-auto flex max-w-2xl flex-col gap-4">
      <h2 id="progress-title" className="text-xl font-semibold text-slate-900">
        {t('progress.title')}
      </h2>
      {failed && (
        <div role="alert" className="flex items-center gap-3 text-red-700">
          {t('common.genericError')}
          <button type="button" onClick={retry} className="min-h-11 underline">
            {t('app.retry')}
          </button>
        </div>
      )}
      <div role="group" aria-label={t('progress.range')} className="flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button
            key={r.weeks}
            type="button"
            aria-pressed={weeks === r.weeks}
            onClick={() => setWeeks(r.weeks)}
            className={`min-h-11 rounded-full border px-4 text-base font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${
              weeks === r.weeks
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-500 bg-white text-slate-800 hover:bg-slate-50'
            }`}
          >
            {t('progress.months', { count: r.months })}
          </button>
        ))}
      </div>

      {options === null && !failed && (
        <p role="status" className="text-slate-700">
          {t('app.loading')}
        </p>
      )}

      {options && options.length > 0 && (
        <div className="flex flex-col gap-1">
          <label htmlFor="progress-exercise" className="text-sm font-medium text-slate-700">
            {t('progress.exercise')}
          </label>
          <select
            id="progress-exercise"
            value={exerciseId ?? ''}
            onChange={(e) => setExerciseId(e.target.value)}
            className="min-h-11 rounded-md border border-slate-500 bg-white px-2 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            {options.map((o) => (
              <option key={o.exerciseId} value={o.exerciseId}>
                {exerciseName(o, lang)}
              </option>
            ))}
          </select>
        </div>
      )}
      {options && options.length > 0 && chosen && (
        <ExerciseChart
          points={exerciseReady ? exercise.progress.points : []}
          loading={!exerciseReady && !failed}
          weeks={weeks}
          name={exerciseName(chosen, lang)}
        />
      )}
      {options && (
        <VolumeChart
          points={dataReady ? data.volume : []}
          loading={!dataReady && !failed}
          weeks={weeks}
        />
      )}
      {options && (
        <AttendanceChart
          points={dataReady ? data.attendance : []}
          loading={!dataReady && !failed}
          weeks={weeks}
        />
      )}
      {consents?.measurements.granted && shownMeasurements.length > 0 && (
        <MeasurementsChart measurements={shownMeasurements} />
      )}

      {own && consents && (
        <>
          {consents.measurements.granted ? (
            <MeasurementsList
              gymId={gymId}
              measurements={measurements}
              canDelete={false}
              onChanged={retry}
            />
          ) : (
            <ConsentCard
              gymId={gymId}
              kind="measurements"
              state={consents.measurements}
              itemCount={0}
              onChanged={retry}
            />
          )}
          {consents.photos.granted ? (
            <ProgressPhotos gymId={gymId} canWrite consentGranted />
          ) : (
            <ConsentCard
              gymId={gymId}
              kind="photos"
              state={consents.photos}
              itemCount={0}
              onChanged={retry}
            />
          )}
        </>
      )}
    </section>
  );
}
