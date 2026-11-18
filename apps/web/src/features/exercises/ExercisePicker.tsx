import { type Exercise, MUSCLE_GROUPS, type MuscleGroup } from '@gym/shared';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { exerciseName, viewerLanguage } from './exerciseName';
import { MAX_QUERY_LENGTH, useExercises } from './useExercises';

/**
 * Choose one exercise from the library (used by the plan editor): search by name in either
 * language, filter by muscle group, arrows move and Enter picks. Archived exercises are never
 * offered (the list never asks for them). Enter does nothing while the list on screen is out of
 * date, so a quick "type, Enter" never picks from the previous results.
 */
export function ExercisePicker({
  gymId,
  onPick,
  onClose,
}: {
  gymId: string;
  onPick: (exercise: Exercise) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = viewerLanguage(i18n.language);
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<MuscleGroup | undefined>(undefined);
  const [active, setActive] = useState(0);
  const { items, failed, reload, stale } = useExercises(gymId, q, group);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);

  useEffect(() => inputRef.current?.focus(), []);
  // A new list starts at its first row.
  useEffect(() => setActive(0), [items]);
  useEffect(() => activeRef.current?.scrollIntoView?.({ block: 'nearest' }), [active]);

  const list = items ?? [];
  const optionId = (i: number) => `${listId}-${i}`;

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.max(0, Math.min(i + 1, list.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = stale ? undefined : list[active];
      if (chosen) onPick(chosen);
    }
  }

  const status = failed
    ? ''
    : stale
      ? t('app.loading')
      : list.length
        ? t('exercises.results', { count: list.length })
        : t('exercises.noMatch');

  return (
    <Dialog title={t('exercises.pickTitle')} closeLabel={t('common.close')} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label={t('exercises.searchExercise')}
          aria-expanded={list.length > 0}
          aria-controls={list.length > 0 ? listId : undefined}
          aria-activedescendant={list.length ? optionId(active) : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          maxLength={MAX_QUERY_LENGTH}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          className="min-h-11 rounded-md border border-slate-500 px-3 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        />
        {/* One row that scrolls sideways: ten wrapping chips would fill a phone screen. */}
        <div
          role="group"
          aria-label={t('exercises.filterGroups')}
          className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
        >
          {MUSCLE_GROUPS.map((g) => {
            const on = group === g;
            return (
              <button
                key={g}
                type="button"
                aria-pressed={on}
                onClick={() => setGroup(on ? undefined : g)}
                className={`min-h-11 shrink-0 rounded-full border px-3 text-sm font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${
                  on
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-500 bg-white text-slate-800 hover:bg-slate-50'
                }`}
              >
                {on && <span aria-hidden="true">✓ </span>}
                {t(`exercises.groups.${g}`)}
              </button>
            );
          })}
        </div>
        {/* The one announcement for screen readers: loading, how many, or none. */}
        <p role="status" className="sr-only">
          {status}
        </p>
        {failed && (
          <div role="alert" className="flex items-center gap-3 text-red-700">
            {t('common.genericError')}
            <button type="button" onClick={reload} className="min-h-11 underline">
              {t('app.retry')}
            </button>
          </div>
        )}
        {!items && !failed && (
          <p className="text-slate-600" aria-hidden="true">
            {t('app.loading')}
          </p>
        )}
        {items && list.length === 0 && !stale && (
          <p className="text-slate-700" aria-hidden="true">
            {t('exercises.noMatch')}
          </p>
        )}
        {list.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            aria-label={t('exercises.pickTitle')}
            aria-busy={stale}
            className={`max-h-[50dvh] overflow-y-auto rounded-md border border-slate-200 ${stale ? 'opacity-60' : ''}`}
          >
            {list.map((e, i) => (
              <li
                key={e.id}
                id={optionId(i)}
                ref={i === active ? activeRef : undefined}
                role="option"
                aria-selected={i === active}
                onClick={() => !stale && onPick(e)}
                onMouseMove={() => i !== active && setActive(i)}
                className={`flex min-h-11 cursor-pointer flex-wrap items-center gap-x-2 px-3 py-2 ${
                  i === active ? 'bg-slate-900 text-white' : 'text-slate-900 hover:bg-slate-50'
                }`}
              >
                <span className="font-medium break-words">{exerciseName(e, lang)}</span>
                <span className={`text-sm ${i === active ? 'text-slate-200' : 'text-slate-600'}`}>
                  {t(`exercises.groups.${e.muscleGroup}`)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
