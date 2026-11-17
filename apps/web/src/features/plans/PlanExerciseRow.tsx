import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { exerciseName, viewerLanguage } from '../exercises/exerciseName';
import type { DraftExercise } from './planState';

const input =
  'min-h-11 w-full rounded-md border border-slate-500 bg-white px-3 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:bg-slate-100 disabled:text-slate-500';
const iconButton =
  'min-h-11 min-w-11 rounded-md border border-slate-300 px-2 text-lg font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 aria-disabled:cursor-not-allowed aria-disabled:opacity-40';

/** Empty text is "no value"; a comma works as the decimal point (Greek keyboards). */
function toNumber(text: string): number | null {
  const clean = text.trim().replace(',', '.');
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

function NumberField({
  label,
  value,
  onChange,
  disabled,
  ...rest
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
  inputMode?: 'numeric' | 'decimal';
}) {
  const id = useId();
  return (
    <div className="flex min-w-24 flex-1 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        value={value ?? ''}
        disabled={disabled}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => onChange(toNumber(e.target.value))}
        className={input}
        {...rest}
      />
    </div>
  );
}

/** One exercise of a day with its targets. The fields follow how the exercise is measured. */
export function PlanExerciseRow({
  exercise,
  first,
  last,
  onChange,
  onMove,
  onRemove,
}: {
  exercise: DraftExercise;
  first: boolean;
  last: boolean;
  onChange: (patch: Partial<DraftExercise>) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t, i18n } = useTranslation();
  const name = exerciseName(exercise.exercise, viewerLanguage(i18n.language));
  const timed = exercise.exercise.measure === 'duration';
  const failureId = useId();
  const notesId = useId();

  return (
    <div
      role="group"
      aria-label={t('plans.editor.exerciseHeading', { name })}
      className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3"
    >
      <div className="flex items-center gap-2">
        <p className="mr-auto min-w-0 font-semibold break-words text-slate-900">{name}</p>
        <button
          type="button"
          className={iconButton}
          aria-disabled={first || undefined}
          aria-label={t('plans.editor.moveUp', { name })}
          onClick={() => !first && onMove(-1)}
        >
          <span aria-hidden="true">↑</span>
        </button>
        <button
          type="button"
          className={iconButton}
          aria-disabled={last || undefined}
          aria-label={t('plans.editor.moveDown', { name })}
          onClick={() => !last && onMove(1)}
        >
          <span aria-hidden="true">↓</span>
        </button>
        <button
          type="button"
          className={`${iconButton} text-red-800`}
          aria-label={t('plans.editor.removeExercise', { name })}
          onClick={onRemove}
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>
      {exercise.exercise.archived && (
        <p className="text-sm text-slate-700">{t('plans.editor.archivedExercise')}</p>
      )}
      <div className="flex flex-wrap gap-3">
        <NumberField
          label={t('plans.editor.sets')}
          value={exercise.sets}
          min={1}
          max={20}
          onChange={(v) => onChange({ sets: v })}
        />
        {timed ? (
          <NumberField
            label={t('plans.editor.duration')}
            value={exercise.durationSeconds}
            min={1}
            max={7200}
            onChange={(v) => onChange({ durationSeconds: v })}
          />
        ) : (
          <>
            <NumberField
              label={t('plans.editor.repsMin')}
              value={exercise.repsMin}
              min={1}
              max={100}
              disabled={exercise.toFailure}
              onChange={(v) => onChange({ repsMin: v })}
            />
            <NumberField
              label={t('plans.editor.repsMax')}
              value={exercise.repsMax}
              min={1}
              max={100}
              disabled={exercise.toFailure}
              onChange={(v) => onChange({ repsMax: v })}
            />
            <NumberField
              label={t('plans.editor.weight')}
              value={exercise.weightKg}
              min={0}
              max={999.75}
              step={0.25}
              inputMode="decimal"
              onChange={(v) => onChange({ weightKg: v })}
            />
          </>
        )}
        <NumberField
          label={t('plans.editor.rest')}
          value={exercise.restSeconds}
          min={0}
          max={900}
          step={5}
          onChange={(v) => onChange({ restSeconds: v })}
        />
      </div>
      {!timed && (
        <div className="flex min-h-11 items-center gap-2">
          <input
            id={failureId}
            type="checkbox"
            checked={exercise.toFailure}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? { toFailure: true, repsMin: null, repsMax: null }
                  : { toFailure: false },
              )
            }
            className="size-6 accent-slate-900"
          />
          <label htmlFor={failureId} className="text-base text-slate-900">
            {t('plans.editor.toFailure')}
          </label>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor={notesId} className="text-sm font-medium text-slate-700">
          {t('plans.editor.exerciseNotes')}
        </label>
        <input
          id={notesId}
          type="text"
          maxLength={300}
          value={exercise.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          className={input}
        />
      </div>
    </div>
  );
}
