import type { Exercise } from '@gym/shared';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExercisePicker } from '../exercises/ExercisePicker';

/** "Add exercise" for a free workout: opens the library picker and hands back the choice. */
export function FreeWorkoutPicker({
  gymId,
  onPick,
}: {
  gymId: string;
  onPick: (exercise: Exercise) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={opener}
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-12 rounded-md border-2 border-slate-900 bg-white px-4 text-lg font-semibold text-slate-900 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
      >
        {t('workout.addExercise')}
      </button>
      {open && (
        <ExercisePicker
          gymId={gymId}
          onPick={(exercise) => {
            setOpen(false);
            onPick(exercise);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
