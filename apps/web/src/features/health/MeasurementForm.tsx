import type { MeasurementInput } from '@gym/shared';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiFetch } from '../../api/client';
import { Field } from '../../components/Field';
import { parseDecimal } from '../workout/workoutModel';

/** The device's own calendar day as YYYY-MM-DD (the API refuses tomorrow in the gym's zone). */
export function localToday(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const NUMERIC = [
  'weightKg',
  'bodyFatPct',
  'waistCm',
  'hipsCm',
  'chestCm',
  'armCm',
  'thighCm',
] as const;
type Key = (typeof NUMERIC)[number];
type Values = Record<Key, string>;
const EMPTY: Values = {
  weightKg: '',
  bodyFatPct: '',
  waistCm: '',
  hipsCm: '',
  chestCm: '',
  armCm: '',
  thighCm: '',
};
/** Allowed range and decimals of each value, as the API checks them. */
const LIMITS: Record<Key, { min: number; max: number; decimals: number }> = {
  weightKg: { min: 20, max: 400, decimals: 2 },
  bodyFatPct: { min: 2, max: 70, decimals: 1 },
  waistCm: { min: 10, max: 300, decimals: 1 },
  hipsCm: { min: 10, max: 300, decimals: 1 },
  chestCm: { min: 10, max: 300, decimals: 1 },
  armCm: { min: 10, max: 300, decimals: 1 },
  thighCm: { min: 10, max: 300, decimals: 1 },
};

/**
 * The primary trainer records a measurement: day, weight, body fat and, under "More", the
 * circumferences. Without the member's consent the form is off and says why. A Greek comma is
 * read as a decimal point.
 */
export function MeasurementForm({
  gymId,
  memberId,
  consentGranted,
  onSaved,
}: {
  gymId: string;
  memberId: string;
  consentGranted: boolean;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [day, setDay] = useState(() => localToday());
  const [values, setValues] = useState<Values>(EMPTY);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Key | 'form', string>>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const label: Record<Key, string> = {
    weightKg: t('health.measure.weight'),
    bodyFatPct: t('health.measure.bodyFat'),
    waistCm: t('health.measure.waist'),
    hipsCm: t('health.measure.hips'),
    chestCm: t('health.measure.chest'),
    armCm: t('health.measure.arm'),
    thighCm: t('health.measure.thigh'),
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!consentGranted || busy) return;
    setSaved(false);
    const next: typeof errors = {};
    const body: Record<string, unknown> = { measuredOn: day };
    let any = false;
    for (const key of NUMERIC) {
      const text = values[key].trim();
      if (!text) continue;
      const n = parseDecimal(text);
      const { min, max, decimals } = LIMITS[key];
      const f = 10 ** decimals;
      if (n === null || n < min || n > max || Math.abs(n * f - Math.round(n * f)) > 1e-6) {
        next[key] = t('health.measure.range', { min, max });
      } else {
        body[key] = n;
        any = true;
      }
    }
    if (!any && Object.keys(next).length === 0) next.form = t('health.measure.atLeastOne');
    if (notes.trim()) body.notes = notes.trim();
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    try {
      await apiFetch(`/gyms/${gymId}/members/${memberId}/measurements`, {
        method: 'POST',
        body: JSON.stringify(body as MeasurementInput),
      });
      setValues(EMPTY);
      setNotes('');
      setSaved(true);
      onSaved();
    } catch (err) {
      setErrors({
        form:
          err instanceof ApiError && err.status === 409
            ? t('health.measure.noConsent')
            : err instanceof ApiError && err.status === 400
              ? t('common.checkFields')
              : t('common.genericError'),
      });
    } finally {
      setBusy(false);
    }
  }

  const set = (key: Key) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));
  const field = (key: Key) => (
    <Field
      key={key}
      label={label[key]}
      inputMode="decimal"
      autoComplete="off"
      value={values[key]}
      onChange={set(key)}
      error={errors[key]}
      disabled={!consentGranted}
    />
  );

  return (
    <form
      onSubmit={(e) => void submit(e)}
      noValidate
      aria-label={t('health.measure.formTitle')}
      className="flex flex-col gap-3 rounded-2xl border border-slate-300 bg-white p-4"
    >
      <h3 className="text-lg font-semibold text-slate-900">{t('health.measure.formTitle')}</h3>
      {!consentGranted && (
        <p className="rounded-md border border-amber-700 bg-amber-50 p-3 font-medium text-amber-950">
          {t('health.measure.noConsent')}
        </p>
      )}
      <Field
        label={t('health.measure.day')}
        type="date"
        value={day}
        max={localToday()}
        onChange={(e) => setDay(e.target.value)}
        disabled={!consentGranted}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {field('weightKg')}
        {field('bodyFatPct')}
      </div>
      <details>
        <summary className="flex min-h-11 cursor-pointer items-center font-medium text-slate-900 underline">
          {t('health.measure.more')}
        </summary>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(['waistCm', 'hipsCm', 'chestCm', 'armCm', 'thighCm'] as const).map(field)}
          <Field
            label={t('health.measure.notes')}
            value={notes}
            maxLength={300}
            onChange={(e) => setNotes(e.target.value)}
            disabled={!consentGranted}
          />
        </div>
      </details>
      {errors.form && (
        <p role="alert" className="text-red-700">
          {errors.form}
        </p>
      )}
      {saved && (
        <p role="status" className="text-green-800">
          ✓ {t('health.measure.saved')}
        </p>
      )}
      <button
        type="submit"
        disabled={!consentGranted}
        aria-disabled={busy || undefined}
        className="min-h-11 self-start rounded-md bg-slate-900 px-5 font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-50 aria-disabled:opacity-60"
      >
        {busy ? t('common.working') : t('health.measure.save')}
      </button>
    </form>
  );
}
