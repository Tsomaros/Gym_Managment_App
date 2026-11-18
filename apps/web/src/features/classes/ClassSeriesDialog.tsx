import type { ClassTypeView } from '@gym/shared';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../api/client';
import { Field } from '../../components/Field';
import { Dialog } from '../../components/Dialog';
import { addDays, isoWeekday } from '../schedule/dates';
import {
  type ClassFormErrors,
  type ClassFormValues,
  ClassSessionForm,
  validateClassForm,
} from './ClassSessionForm';
import { endsBeforeMidnight, plainClass, primaryClass, type TrainerOption } from './shared';

/** The current weekly class a change starts from: it ends the day before `from`. */
export interface SeriesChange {
  seriesId: string;
  /** The day the change starts (a day the series runs). */
  from: string;
  values: ClassFormValues;
}

/**
 * Owner: starts a weekly class, or changes one "from this day on": the old series ends the day
 * before and a new one starts, so earlier days never change.
 */
export function ClassSeriesDialog({
  gymId,
  types,
  trainers,
  today,
  change,
  onClose,
  onSaved,
}: {
  gymId: string;
  types: readonly ClassTypeView[];
  trainers: readonly TrainerOption[];
  today: string;
  change?: SeriesChange;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, i18n } = useTranslation();
  const tag = i18n.language === 'en' ? 'en-GB' : 'el-GR';
  const [values, setValues] = useState<ClassFormValues>(
    change?.values ?? {
      classTypeId: '',
      startsAt: '18:00',
      duration: '45',
      capacity: '12',
      trainerId: '',
      room: '',
    },
  );
  const [validFrom, setValidFrom] = useState(change?.from ?? today);
  const [errors, setErrors] = useState<ClassFormErrors & { validFrom?: string }>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<'none' | 'failed' | 'endedOnly'>('none');
  const [ended, setEnded] = useState(false);

  const weekday = isoWeekday(validFrom || today);
  const weekdayName = new Intl.DateTimeFormat(tag, { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(`${validFrom || today}T00:00:00Z`),
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const found: ClassFormErrors & { validFrom?: string } = validateClassForm(
      values,
      t,
      endsBeforeMidnight,
    );
    if (!change && (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom) || validFrom < today)) {
      found.validFrom = t('classes.form.fromError');
    }
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setFailed('none');
    try {
      if (change && !ended) {
        await apiFetch(`/gyms/${gymId}/class-series/${change.seriesId}/end`, {
          method: 'POST',
          body: JSON.stringify({ lastDate: addDays(change.from, -1) }),
        });
        setEnded(true);
      }
      try {
        await apiFetch(`/gyms/${gymId}/class-series`, {
          method: 'POST',
          body: JSON.stringify({
            classTypeId: values.classTypeId,
            weekday,
            startsAt: values.startsAt,
            durationMinutes: Number(values.duration),
            capacity: Number(values.capacity),
            trainerId: values.trainerId || null,
            room: values.room.trim() || null,
            validFrom,
          }),
        });
      } catch (err) {
        // The old series is already ended: a retry only has to start the new one.
        if (change) {
          setEnded(true);
          setFailed('endedOnly');
          return;
        }
        throw err;
      }
      onSaved();
    } catch {
      setFailed('failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={change ? t('classes.series.changeTitle') : t('classes.series.newTitle')}
      closeLabel={t('common.close')}
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {change ? (
          <p className="text-slate-700">
            {t('classes.series.fromDay', {
              day: new Intl.DateTimeFormat(tag, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                timeZone: 'UTC',
              }).format(new Date(`${change.from}T00:00:00Z`)),
            })}
          </p>
        ) : (
          <>
            <Field
              label={t('classes.series.startsOn')}
              type="date"
              min={today}
              value={validFrom}
              error={errors.validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
            />
            <p className="text-sm text-slate-700">{t('classes.series.repeats', { day: weekdayName })}</p>
          </>
        )}

        <ClassSessionForm
          idPrefix="series"
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
          {failed === 'failed' && t('common.genericError')}
          {failed === 'endedOnly' && t('classes.series.endedOnly')}
        </div>
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" onClick={onClose} className={plainClass}>
            {t('common.cancel')}
          </button>
          <button type="submit" aria-disabled={busy || undefined} className={primaryClass}>
            {change ? t('classes.series.saveChange') : t('classes.series.save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
