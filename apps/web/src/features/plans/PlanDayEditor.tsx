import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PlanExerciseRow } from './PlanExerciseRow';
import { type DraftDay, type DraftExercise, moveItem } from './planState';

const iconButton =
  'min-h-11 min-w-11 rounded-md border border-slate-300 px-2 text-lg font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 aria-disabled:cursor-not-allowed aria-disabled:opacity-40';

/** One day of the plan: its name, its exercises in order, and moving or removing the day. */
export function PlanDayEditor({
  day,
  first,
  last,
  onChange,
  onMove,
  onRemove,
  onAddExercise,
  titleInvalid,
}: {
  day: DraftDay;
  first: boolean;
  last: boolean;
  onChange: (next: DraftDay) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onAddExercise: () => void;
  /** The day name is missing: marked invalid for assistive technology. */
  titleInvalid?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const titleId = `day-title-${day.key}`;
  const bodyId = useId();
  const name = day.title.trim() || t('plans.editor.day');

  function patchExercise(key: string, patch: Partial<DraftExercise>) {
    onChange({
      ...day,
      exercises: day.exercises.map((e) => (e.key === key ? { ...e, ...patch } : e)),
    });
  }

  return (
    <section
      aria-label={name}
      className="flex flex-col gap-3 rounded-xl border border-slate-300 bg-slate-50 p-3"
    >
      <div className="flex items-end gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={t(open ? 'plans.editor.collapseDay' : 'plans.editor.expandDay', { name })}
          onClick={() => setOpen(!open)}
          className={iconButton}
        >
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={titleId} className="text-sm font-medium text-slate-700">
            {t('plans.editor.dayTitle')}
          </label>
          <input
            id={titleId}
            type="text"
            maxLength={80}
            value={day.title}
            aria-invalid={titleInvalid || undefined}
            onChange={(e) => onChange({ ...day, title: e.target.value })}
            className="min-h-11 w-full rounded-md border border-slate-500 bg-white px-3 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          />
        </div>
        <button
          type="button"
          className={iconButton}
          aria-disabled={first || undefined}
          aria-label={t('plans.editor.moveDayUp', { name })}
          onClick={() => !first && onMove(-1)}
        >
          <span aria-hidden="true">↑</span>
        </button>
        <button
          type="button"
          className={iconButton}
          aria-disabled={last || undefined}
          aria-label={t('plans.editor.moveDayDown', { name })}
          onClick={() => !last && onMove(1)}
        >
          <span aria-hidden="true">↓</span>
        </button>
        <button
          type="button"
          className={`${iconButton} text-red-800`}
          aria-label={t('plans.editor.removeDayNamed', { name })}
          onClick={onRemove}
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>
      <div id={bodyId} hidden={!open} className="flex flex-col gap-3">
        {day.exercises.length === 0 && (
          <p className="text-slate-700">{t('plans.editor.noExercises')}</p>
        )}
        {day.exercises.map((e, i) => (
          <PlanExerciseRow
            key={e.key}
            exercise={e}
            first={i === 0}
            last={i === day.exercises.length - 1}
            onChange={(patch) => patchExercise(e.key, patch)}
            onMove={(delta) => onChange({ ...day, exercises: moveItem(day.exercises, i, delta) })}
            onRemove={() =>
              onChange({ ...day, exercises: day.exercises.filter((x) => x.key !== e.key) })
            }
          />
        ))}
        <button
          type="button"
          onClick={onAddExercise}
          aria-label={t('plans.editor.addExerciseTo', { name })}
          className="min-h-11 self-start rounded-md border border-slate-400 bg-white px-4 font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          <span aria-hidden="true">+ </span>
          {t('plans.editor.addExercise')}
        </button>
      </div>
    </section>
  );
}
