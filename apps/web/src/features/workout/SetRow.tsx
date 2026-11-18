import type { Measure } from '@gym/shared';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatKg } from '../plans/planFormat';
import {
  clamp,
  formatDuration,
  KG_STEP,
  type LogSet,
  MAX_KG,
  MAX_REPS,
  MAX_SECONDS,
  parseDecimal,
  parseDuration,
  SECONDS_STEP,
  toKgStep,
} from './workoutModel';

const stepButton =
  'inline-flex h-11 min-h-11 w-11 min-w-11 shrink-0 items-center justify-center rounded-md border border-slate-500 bg-white text-2xl font-semibold text-slate-900 hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';
const field =
  'min-h-11 w-full min-w-0 rounded-md border border-slate-500 bg-white px-1 text-center text-xl font-semibold tabular-nums text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';

/** A value with big − and + buttons and a field to type in; the typed text may be mid-edit. */
function Stepper({
  label,
  text,
  onText,
  onBlur,
  onStep,
  decLabel,
  incLabel,
  invalid,
  describedBy,
}: {
  label: string;
  text: string;
  onText: (text: string) => void;
  onBlur: () => void;
  onStep: (direction: 1 | -1) => void;
  decLabel: string;
  incLabel: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={decLabel}
          onClick={() => onStep(-1)}
          className={stepButton}
        >
          −
        </button>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => onText(e.target.value)}
          onBlur={onBlur}
          onFocus={(e) => e.target.select()}
          className={field}
        />
        <button
          type="button"
          aria-label={incLabel}
          onClick={() => onStep(1)}
          className={stepButton}
        >
          +
        </button>
      </div>
    </div>
  );
}

/**
 * One set to log: reps and kilos (or seconds) with big steppers, a Greek comma accepted, and a
 * done box at least 44 px square. Made for one hand between sets.
 */
export function SetRow({
  index,
  measure,
  set,
  lang,
  error,
  canRemove,
  onChange,
  onToggleDone,
  onRemove,
}: {
  index: number;
  measure: Measure;
  set: LogSet;
  lang: 'el' | 'en';
  /** The done box was refused (no reps yet). */
  error: boolean;
  canRemove: boolean;
  onChange: (patch: Partial<Pick<LogSet, 'reps' | 'weightKg' | 'durationSeconds'>>) => void;
  onToggleDone: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const errorId = useId();
  const [repsText, setRepsText] = useState(String(set.reps));
  const [kgText, setKgText] = useState(formatKg(set.weightKg, lang));
  const [secText, setSecText] = useState(formatDuration(set.durationSeconds));

  // The row changes from outside too (a stepper, a resumed session): follow it unless the typed
  // text already means the same number.
  useEffect(() => {
    if (Number(repsText) !== set.reps) setRepsText(String(set.reps));
  }, [set.reps]);
  useEffect(() => {
    if (parseDecimal(kgText) !== set.weightKg) setKgText(formatKg(set.weightKg, lang));
  }, [set.weightKg, lang]);
  useEffect(() => {
    if (parseDuration(secText) !== set.durationSeconds)
      setSecText(formatDuration(set.durationSeconds));
  }, [set.durationSeconds]);

  const n = index + 1;
  const reps = (
    <Stepper
      label={t('workout.reps')}
      text={repsText}
      invalid={error}
      describedBy={error ? errorId : undefined}
      decLabel={t('workout.fewerReps', { n })}
      incLabel={t('workout.moreReps', { n })}
      onText={(text) => {
        const digits = text.replace(/\D/g, '').slice(0, 3);
        setRepsText(digits);
        if (digits !== '') onChange({ reps: clamp(Number(digits), 0, MAX_REPS) });
      }}
      onBlur={() => setRepsText(String(set.reps))}
      onStep={(d) => onChange({ reps: clamp(set.reps + d, 0, MAX_REPS) })}
    />
  );
  const kilos = (
    <Stepper
      label={t('workout.kg')}
      text={kgText}
      decLabel={t('workout.lessKg', { n })}
      incLabel={t('workout.moreKg', { n })}
      onText={(text) => {
        setKgText(text);
        const v = parseDecimal(text);
        if (v !== null) onChange({ weightKg: toKgStep(v) });
      }}
      onBlur={() => setKgText(formatKg(set.weightKg, lang))}
      onStep={(d) => onChange({ weightKg: clamp(toKgStep(set.weightKg + d * KG_STEP), 0, MAX_KG) })}
    />
  );
  const time = (
    <Stepper
      label={t('workout.time')}
      text={secText}
      decLabel={t('workout.lessTime', { n })}
      incLabel={t('workout.moreTime', { n })}
      onText={(text) => {
        setSecText(text);
        const v = parseDuration(text);
        if (v !== null) onChange({ durationSeconds: clamp(v, 1, MAX_SECONDS) });
      }}
      onBlur={() => setSecText(formatDuration(set.durationSeconds))}
      onStep={(d) =>
        onChange({ durationSeconds: clamp(set.durationSeconds + d * SECONDS_STEP, 1, MAX_SECONDS) })
      }
    />
  );

  return (
    <li
      className={`flex flex-col gap-2 rounded-xl border p-2 ${
        set.done ? 'border-green-700 bg-green-50' : 'border-slate-300 bg-white'
      }`}
    >
      <div className="flex items-center gap-2">
        <p className="mr-auto text-base font-semibold text-slate-900">{t('workout.set', { n })}</p>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="min-h-11 rounded-md px-3 text-sm font-medium text-red-800 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-slate-900"
          >
            {t('workout.removeSet', { n })}
          </button>
        )}
        <label className="flex min-h-11 items-center gap-2 text-base font-medium text-slate-900">
          <input
            type="checkbox"
            checked={set.done}
            onChange={onToggleDone}
            className="h-11 w-11 min-h-11 min-w-11 accent-green-700"
          />
          <span>{t('workout.done', { n })}</span>
        </label>
      </div>
      <div className="flex gap-3">
        {measure === 'duration' ? (
          time
        ) : measure === 'reps' ? (
          reps
        ) : (
          <>
            {reps}
            {kilos}
          </>
        )}
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-sm font-medium text-red-700">
          {measure === 'duration' ? t('workout.needTime') : t('workout.needReps')}
        </p>
      )}
    </li>
  );
}
