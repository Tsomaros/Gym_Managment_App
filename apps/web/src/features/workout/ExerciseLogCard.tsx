import { useTranslation } from 'react-i18next';
import { exerciseName, viewerLanguage } from '../exercises/exerciseName';
import { SetRow } from './SetRow';
import { formatLast, type LogCard, type LogSet } from './workoutModel';

/** One exercise of the workout: its target, what happened last time and a row per set. */
export function ExerciseLogCard({
  card,
  refusedSetId,
  onChange,
  onToggleDone,
  onAddSet,
  onRemoveSet,
}: {
  card: LogCard;
  /** The set whose done box was just refused. */
  refusedSetId: string | null;
  onChange: (index: number, patch: Partial<LogSet>) => void;
  onToggleDone: (index: number) => void;
  onAddSet: () => void;
  onRemoveSet: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = viewerLanguage(i18n.language);
  const doneCount = card.sets.filter((s) => s.done).length;
  return (
    <section
      aria-label={exerciseName(card.name, lang)}
      className="flex flex-col gap-3 rounded-2xl border border-slate-300 bg-white p-3"
    >
      <header>
        <h3 className="text-lg font-semibold break-words text-slate-900">
          {exerciseName(card.name, lang)}
        </h3>
        {card.target && (
          <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{card.target}</p>
        )}
        {card.last && (
          <p className="mt-1 text-sm text-slate-700">
            {t('workout.lastTime', { text: formatLast(card.last, card.measure, lang) })}
          </p>
        )}
        <p className="text-sm text-slate-600">
          {t('workout.progress', { done: doneCount, total: card.sets.length })}
        </p>
      </header>
      <ol className="flex flex-col gap-2">
        {card.sets.map((s, i) => (
          <SetRow
            key={s.id}
            index={i}
            measure={card.measure}
            set={s}
            lang={lang}
            error={refusedSetId === s.id}
            canRemove={i === card.sets.length - 1 && card.sets.length > 1}
            onChange={(patch) => onChange(i, patch)}
            onToggleDone={() => onToggleDone(i)}
            onRemove={onRemoveSet}
          />
        ))}
      </ol>
      <button
        type="button"
        onClick={onAddSet}
        className="min-h-11 rounded-md border border-slate-500 bg-white px-4 font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
      >
        {t('workout.addSet')}
      </button>
    </section>
  );
}
