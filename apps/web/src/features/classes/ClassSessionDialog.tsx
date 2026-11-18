import type { ClassTypeView } from '@gym/shared';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../api/client';
import { Dialog } from '../../components/Dialog';
import { Field } from '../../components/Field';
import {
  type ClassFormErrors,
  type ClassFormValues,
  ClassSessionForm,
  validateClassForm,
} from './ClassSessionForm';
import { endsBeforeMidnight, plainClass, primaryClass, type TrainerOption } from './shared';

/** Owner: adds a single class on one day (a holiday special, a workshop). */
export function ClassSessionDialog({
  gymId,
  types,
  trainers,
  today,
  date: initialDate,
  onClose,
  onSaved,
}: {
  gymId: string;
  types: readonly ClassTypeView[];
  trainers: readonly TrainerOption[];
  today: string;
  date: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [date, setDate] = useState(initialDate < today ? today : initialDate);
  const [values, setValues] = useState<ClassFormValues>({
    classTypeId: '',
    startsAt: '18:00',
    duration: '45',
    capacity: '12',
    trainerId: '',
    room: '',
  });
  const [errors, setErrors] = useState<ClassFormErrors & { date?: string }>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const form = e.currentTarget;
    if (busy) return;
    const found: ClassFormErrors & { date?: string } = validateClassForm(
      values,
      t,
      endsBeforeMidnight,
    );
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today) found.date = t('classes.form.dateError');
    setErrors(found);
    if (Object.keys(found).length) {
      // The first invalid field takes focus: its error is its description.
      setTimeout(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0);
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      await apiFetch(`/gyms/${gymId}/class-sessions`, {
        method: 'POST',
        body: JSON.stringify({
          classTypeId: values.classTypeId,
          date,
          startsAt: values.startsAt,
          durationMinutes: Number(values.duration),
          capacity: Number(values.capacity),
          trainerId: values.trainerId || null,
          room: values.room.trim() || null,
        }),
      });
      onSaved();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={t('classes.oneOff.title')} closeLabel={t('common.close')} onClose={onClose}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field
          label={t('classes.oneOff.date')}
          type="date"
          min={today}
          value={date}
          error={errors.date}
          onChange={(e) => setDate(e.target.value)}
        />
        <ClassSessionForm
          idPrefix="oneoff"
          values={values}
          errors={errors}
          types={types}
          trainers={trainers}
          onChange={(patch) => setValues((v) => ({ ...v, ...patch }))}
          onTypeChosen={(picked) =>
            setValues((v) => ({
              ...v,
              capacity: String(picked.defaultCapacity),
              duration: String(picked.defaultDurationMinutes),
            }))
          }
        />
        <div role="alert" className="min-h-5 text-sm text-red-700">
          {failed && t('common.genericError')}
        </div>
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" onClick={onClose} className={plainClass}>
            {t('common.cancel')}
          </button>
          <button type="submit" aria-disabled={busy || undefined} className={primaryClass}>
            {t('classes.oneOff.save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
