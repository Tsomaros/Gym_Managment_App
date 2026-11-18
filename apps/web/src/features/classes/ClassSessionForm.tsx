import type { ClassTypeView } from '@gym/shared';
import { useTranslation } from 'react-i18next';
import { Field } from '../../components/Field';
import { activeTypes, inputClass, type TrainerOption, typeName } from './shared';

export interface ClassFormValues {
  classTypeId: string;
  startsAt: string;
  duration: string;
  capacity: string;
  trainerId: string;
  room: string;
}

export type ClassFormErrors = Partial<Record<keyof ClassFormValues, string>>;

/** The fields a weekly class and a one-off class share (the dialogs add their own dates). */
export function ClassSessionForm({
  idPrefix,
  values,
  errors,
  types,
  trainers,
  onChange,
  onTypeChosen,
}: {
  idPrefix: string;
  values: ClassFormValues;
  errors: ClassFormErrors;
  types: readonly ClassTypeView[];
  trainers: readonly TrainerOption[];
  onChange: (patch: Partial<ClassFormValues>) => void;
  /** A new type was picked: the dialog may fill capacity and length from its defaults. */
  onTypeChosen?: (type: ClassTypeView) => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-type`} className="text-sm font-medium text-slate-700">
          {t('classes.form.type')}
        </label>
        <select
          id={`${idPrefix}-type`}
          value={values.classTypeId}
          aria-invalid={errors.classTypeId ? true : undefined}
          aria-describedby={errors.classTypeId ? `${idPrefix}-type-err` : undefined}
          onChange={(e) => {
            onChange({ classTypeId: e.target.value });
            const picked = types.find((x) => x.id === e.target.value);
            if (picked) onTypeChosen?.(picked);
          }}
          className={inputClass}
        >
          <option value="">{t('classes.form.chooseType')}</option>
          {activeTypes(types).map((x) => (
            <option key={x.id} value={x.id}>
              {typeName(x, i18n.language)}
            </option>
          ))}
        </select>
        {errors.classTypeId && (
          <p id={`${idPrefix}-type-err`} className="text-sm text-red-700">
            {errors.classTypeId}
          </p>
        )}
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <Field
            label={t('classes.form.startsAt')}
            type="time"
            step={300}
            value={values.startsAt}
            error={errors.startsAt}
            onChange={(e) => onChange({ startsAt: e.target.value })}
          />
        </div>
        <div className="flex-1">
          <Field
            label={t('classes.form.duration')}
            type="number"
            inputMode="numeric"
            min={15}
            max={240}
            step={5}
            value={values.duration}
            error={errors.duration}
            onChange={(e) => onChange({ duration: e.target.value })}
          />
        </div>
      </div>

      <Field
        label={t('classes.form.capacity')}
        type="number"
        inputMode="numeric"
        min={1}
        max={200}
        step={1}
        value={values.capacity}
        error={errors.capacity}
        onChange={(e) => onChange({ capacity: e.target.value })}
      />

      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-trainer`} className="text-sm font-medium text-slate-700">
          {t('classes.form.trainer')}
        </label>
        <select
          id={`${idPrefix}-trainer`}
          value={values.trainerId}
          onChange={(e) => onChange({ trainerId: e.target.value })}
          className={inputClass}
        >
          <option value="">{t('classes.noTrainer')}</option>
          {trainers.map((x) => (
            <option key={x.userId} value={x.userId}>
              {x.firstName} {x.lastName}
            </option>
          ))}
        </select>
      </div>

      <Field
        label={t('classes.form.room')}
        maxLength={40}
        value={values.room}
        error={errors.room}
        onChange={(e) => onChange({ room: e.target.value })}
      />
    </>
  );
}

/** Validates the shared fields; returns the errors (empty when fine). */
export function validateClassForm(
  v: ClassFormValues,
  t: (key: string) => string,
  endsBeforeMidnight: (start: string, minutes: number) => boolean,
): ClassFormErrors {
  const e: ClassFormErrors = {};
  const duration = Number(v.duration);
  const capacity = Number(v.capacity);
  if (!v.classTypeId) e.classTypeId = t('classes.form.chooseTypeError');
  if (!/^\d{2}:\d{2}$/.test(v.startsAt)) e.startsAt = t('classes.form.startsAtError');
  if (!Number.isInteger(duration) || duration < 15 || duration > 240) {
    e.duration = t('classes.form.durationError');
  } else if (!e.startsAt && !endsBeforeMidnight(v.startsAt, duration)) {
    e.duration = t('classes.form.midnightError');
  }
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 200) {
    e.capacity = t('classes.form.capacityError');
  }
  return e;
}
