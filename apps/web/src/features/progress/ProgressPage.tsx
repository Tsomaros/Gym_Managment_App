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
import { apiFetch } from '../../api/client';
import { exerciseName, viewerLanguage } from '../exercises/exerciseName';
import { AttendanceChart, ExerciseChart, MeasurementsChart, VolumeChart } from './charts';
import { DEFAULT_WEEKS, RANGES } from './chartTheme';

interface Data {
  options: ProgressExerciseOption[];
  volume: VolumePoint[];
  attendance: AttendancePoint[];
}

/**
 * Progress charts: for the signed-in member (no `memberId`, the /me routes) or, for a trainer,
 * one of their clients. Exercise, weekly volume, attendance and, only with the member's
 * consent and data, body measurements. The same page serves both, so they see the same charts.
 */
export function ProgressPage({ memberId }: { memberId?: string }) {
  const { t, i18n } = useTranslation();
  const lang = viewerLanguage(i18n.language);
  const { gymId = '' } = useParams();
  const base = `/gyms/${gymId}/${memberId ? `members/${memberId}` : 'me'}`;
  const [weeks, setWeeks] = useState<number>(DEFAULT_WEEKS);
  const [options, setOptions] = useState<ProgressExerciseOption[] | null>(null);
  const [exerciseId, setExerciseId] = useState<string | null>(null);
  const [data, setData] = useState<Omit<Data, 'options'> | null>(null);
  const [exercise, setExercise] = useState<ExerciseProgress | null>(null);
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
        apiFetch<ConsentState>(`${base}/consents`).catch(() => null),
      ]);
      const list =
        consent?.measurements.granted === true
          ? await apiFetch<Measurement[]>(`${base}/measurements`).catch(() => [])
          : [];
      if (!current) return;
      setOptions(opts);
      setExerciseId((cur) => cur ?? opts[0]?.exerciseId ?? null);
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
    Promise.all([
      apiFetch<VolumePoint[]>(`${base}/progress/volume?weeks=${weeks}`),
      apiFetch<AttendancePoint[]>(`${base}/progress/attendance?weeks=${weeks}`),
    ])
      .then(([volume, attendance]) => current && setData({ volume, attendance }))
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
    apiFetch<ExerciseProgress>(`${base}/progress/exercises/${exerciseId}?weeks=${weeks}`)
      .then((e) => current && setExercise(e))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [base, exerciseId, weeks, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const chosen = options?.find((o) => o.exerciseId === exerciseId);
  // The chart answers the exercise on screen: never show one exercise's points under another's name.
  const exerciseReady = exercise !== null && exercise.exerciseId === exerciseId;
  const cutoff = new Date(Date.now() - weeks * 7 * 86_400_000).toISOString().slice(0, 10);
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
      {options && (
        <ExerciseChart
          points={exerciseReady ? exercise.points : []}
          weeks={weeks}
          name={chosen ? exerciseName(chosen, lang) : ''}
        />
      )}
      {data && <VolumeChart points={data.volume} weeks={weeks} />}
      {data && <AttendanceChart points={data.attendance} weeks={weeks} />}
      {consents?.measurements.granted && shownMeasurements.length > 0 && (
        <MeasurementsChart measurements={shownMeasurements} />
      )}
    </section>
  );
}
