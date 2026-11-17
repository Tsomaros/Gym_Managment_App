import {
  type Exercise,
  type ExerciseInput,
  MEASURES,
  MUSCLE_GROUPS,
  type Measure,
  type MuscleGroup,
} from '@gym/shared';
import { type FormEvent, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiFetch } from '../../api/client';
import { Dialog } from '../../components/Dialog';
import { Field, FormError, SubmitButton } from '../../components/Field';

const selectClass =
  'min-h-11 rounded-md border border-slate-500 bg-white px-3 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';

/** Adds an exercise to the library, or edits one (trainers and the owner). */
export function ExerciseForm({
  gymId,
  exercise,
  onSaved,
  onClose,
}: {
  gymId: string;
  /** Present when editing. */
  exercise?: Exercise;
  onSaved: (saved: Exercise) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [nameEl, setNameEl] = useState(exercise?.nameEl ?? '');
  const [nameEn, setNameEn] = useState(exercise?.nameEn ?? '');
  const [muscleGroup, setMuscleGroup] = useState<MuscleGroup>(exercise?.muscleGroup ?? 'chest');
  const [measure, setMeasure] = useState<Measure>(exercise?.measure ?? 'weight_reps');
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const groupId = useId();
  const measureId = useId();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setFormError(null);
    if (!nameEl.trim()) {
      setNameError(t('common.required'));
      nameRef.current?.focus();
      return;
    }
    setNameError(null);
    setBusy(true);
    try {
      const body: ExerciseInput = {
        nameEl: nameEl.trim(),
        nameEn: nameEn.trim() || null,
        muscleGroup,
        measure,
      };
      const saved = exercise
        ? await apiFetch<Exercise>(`/gyms/${gymId}/exercises/${exercise.id}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
          })
        : await apiFetch<Exercise>(`/gyms/${gymId}/exercises`, {
            method: 'POST',
            body: JSON.stringify(body),
          });
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setNameError(t('exercises.duplicate'));
        nameRef.current?.focus();
      } else {
        setFormError(t('common.genericError'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={exercise ? t('exercises.editTitle') : t('exercises.new')}
      closeLabel={t('common.close')}
      onClose={onClose}
    >
      <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
        <Field
          ref={nameRef}
          label={t('exercises.nameEl')}
          value={nameEl}
          maxLength={80}
          required
          error={nameError}
          onChange={(e) => {
            setNameEl(e.target.value);
            setNameError(null);
          }}
        />
        <Field
          label={t('exercises.nameEn')}
          hint={t('exercises.nameEnHint')}
          value={nameEn}
          maxLength={80}
          onChange={(e) => setNameEn(e.target.value)}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor={groupId} className="text-sm font-medium text-slate-700">
            {t('exercises.muscleGroup')}
          </label>
          <select
            id={groupId}
            value={muscleGroup}
            onChange={(e) => setMuscleGroup(e.target.value as MuscleGroup)}
            className={selectClass}
          >
            {MUSCLE_GROUPS.map((g) => (
              <option key={g} value={g}>
                {t(`exercises.groups.${g}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={measureId} className="text-sm font-medium text-slate-700">
            {t('exercises.measure')}
          </label>
          <select
            id={measureId}
            value={measure}
            onChange={(e) => setMeasure(e.target.value as Measure)}
            className={selectClass}
          >
            {MEASURES.map((m) => (
              <option key={m} value={m}>
                {t(`exercises.measures.${m}`)}
              </option>
            ))}
          </select>
        </div>
        <FormError message={formError} />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-md border border-slate-300 px-4 font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            {t('common.cancel')}
          </button>
          <SubmitButton busy={busy}>{busy ? t('common.working') : t('common.save')}</SubmitButton>
        </div>
      </form>
    </Dialog>
  );
}
