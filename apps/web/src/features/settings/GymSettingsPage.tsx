import {
  AUTO_CHECKOUT_MAX,
  AUTO_CHECKOUT_MIN,
  CAPACITY_MAX,
  CAPACITY_MIN,
  type GymSettings,
  REMINDER_DAYS_MAX,
  REMINDER_DAYS_MIN,
  UpdateGymSettingsSchema,
} from '@gym/shared';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { apiFetch } from '../../api/client';
import { Field } from '../../components/Field';

/** Owner: the gym's settings. For now, how long after coming in someone counts as having left. */
export function GymSettingsPage() {
  const { t } = useTranslation();
  const { gymId = '' } = useParams();
  const [loaded, setLoaded] = useState<GymSettings | null>(null);
  const [minutes, setMinutes] = useState('');
  const [shiftsFailed, setShiftsFailed] = useState(false);
  const [shiftsState, setShiftsState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [reminder, setReminder] = useState('');
  const [capacity, setCapacity] = useState('');
  const [countState, setCountState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [countFailed, setCountFailed] = useState(false);
  const minutesRef = useRef<HTMLInputElement>(null);
  const reminderRef = useRef<HTMLInputElement>(null);
  const capacityRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<{ minutes?: string; reminder?: string; capacity?: string }>(
    {},
  );
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed' | 'loadFailed'>('idle');

  const load = useCallback(() => {
    setState('idle');
    apiFetch<GymSettings>(`/gyms/${gymId}/settings`)
      .then((s) => {
        setLoaded(s);
        setMinutes(String(s.autoCheckoutMinutes));
        setReminder(String(s.reminderDays));
        setCapacity(s.capacity === null ? '' : String(s.capacity));
      })
      .catch(() => setState('loadFailed'));
  }, [gymId]);
  useEffect(load, [load]);

  /** The reception switch saves at once, on its own: it is a yes/no, not part of the minutes form. */
  async function toggleShifts(allowed: boolean) {
    if (shiftsState === 'saving') return;
    setShiftsFailed(false);
    setShiftsState('saving');
    try {
      const updated = await apiFetch<GymSettings>(`/gyms/${gymId}/settings`, {
        method: 'PATCH',
        body: JSON.stringify({ receptionCanEditShifts: allowed }),
      });
      setLoaded(updated);
      setShiftsState('saved');
    } catch {
      setShiftsFailed(true);
      setShiftsState('idle');
    }
  }

  /** The yes/no for members seeing the number saves at once, like the reception switch. */
  async function toggleCount(show: boolean) {
    if (countState === 'saving') return;
    setCountFailed(false);
    setCountState('saving');
    try {
      const updated = await apiFetch<GymSettings>(`/gyms/${gymId}/settings`, {
        method: 'PATCH',
        body: JSON.stringify({ showOccupancyCount: show }),
      });
      setLoaded(updated);
      setCountState('saved');
    } catch {
      setCountFailed(true);
      setCountState('idle');
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (state === 'saving' || !loaded) return; // a second Enter must not send a second request
    const typed = {
      autoCheckoutMinutes: minutes.trim() === '' ? NaN : Number(minutes),
      reminderDays: reminder.trim() === '' ? NaN : Number(reminder),
      // Empty means "no capacity": the indicator is off for members.
      capacity: capacity.trim() === '' ? null : Number(capacity),
    };
    const invalid = (key: keyof typeof typed) =>
      !UpdateGymSettingsSchema.safeParse({ [key]: typed[key] }).success;
    const found = {
      minutes: invalid('autoCheckoutMinutes') ? t('settings.invalid') : undefined,
      reminder: invalid('reminderDays') ? t('settings.reminderInvalid') : undefined,
      capacity: invalid('capacity') ? t('settings.capacityInvalid') : undefined,
    };
    setErrors(found);
    if (found.minutes || found.reminder || found.capacity) {
      // The error is read when the field takes focus (it is the field's description).
      (found.minutes ? minutesRef : found.reminder ? reminderRef : capacityRef).current?.focus();
      setState('idle');
      return;
    }
    // Only what changed is sent, so saving one field never overwrites another with a stale value.
    const changes: Partial<typeof typed> = {};
    if (typed.autoCheckoutMinutes !== loaded.autoCheckoutMinutes) {
      changes.autoCheckoutMinutes = typed.autoCheckoutMinutes;
    }
    if (typed.reminderDays !== loaded.reminderDays) changes.reminderDays = typed.reminderDays;
    if (typed.capacity !== loaded.capacity) changes.capacity = typed.capacity;
    if (Object.keys(changes).length === 0) {
      setState('saved'); // already true on the server
      return;
    }
    setState('saving');
    try {
      const updated = await apiFetch<GymSettings>(`/gyms/${gymId}/settings`, {
        method: 'PATCH',
        body: JSON.stringify(changes),
      });
      setLoaded(updated);
      setMinutes(String(updated.autoCheckoutMinutes));
      setReminder(String(updated.reminderDays));
      setCapacity(updated.capacity === null ? '' : String(updated.capacity));
      setState('saved');
    } catch {
      setState('failed');
    }
  }

  return (
    <section aria-labelledby="settings-title" className="flex max-w-md flex-col gap-4">
      <h2 id="settings-title" className="text-xl font-semibold text-slate-900">
        {t('settings.title')}
      </h2>

      {state === 'loadFailed' && (
        <div role="alert" className="flex items-center gap-3 text-red-700">
          {t('common.genericError')}
          <button type="button" onClick={load} className="min-h-11 underline">
            {t('app.retry')}
          </button>
        </div>
      )}
      {!loaded && state !== 'loadFailed' && <p className="text-slate-600">{t('app.loading')}</p>}
      {loaded && (
        <form onSubmit={(e) => void save(e)} noValidate className="flex flex-col gap-4">
          <Field
            label={t('settings.autoCheckout')}
            type="number"
            inputMode="numeric"
            min={AUTO_CHECKOUT_MIN}
            max={AUTO_CHECKOUT_MAX}
            step={1}
            ref={minutesRef}
            value={minutes}
            onChange={(e) => {
              setMinutes(e.target.value);
              setErrors((p) => ({ ...p, minutes: undefined }));
              setState('idle');
            }}
            hint={t('settings.hint')}
            error={errors.minutes ?? null}
          />
          <Field
            label={t('settings.reminderDays')}
            type="number"
            inputMode="numeric"
            min={REMINDER_DAYS_MIN}
            max={REMINDER_DAYS_MAX}
            step={1}
            ref={reminderRef}
            value={reminder}
            onChange={(e) => {
              setReminder(e.target.value);
              setErrors((p) => ({ ...p, reminder: undefined }));
              setState('idle');
            }}
            hint={t('settings.reminderHint')}
            error={errors.reminder ?? null}
          />
          <Field
            label={t('settings.capacity')}
            type="number"
            inputMode="numeric"
            min={CAPACITY_MIN}
            max={CAPACITY_MAX}
            step={1}
            ref={capacityRef}
            value={capacity}
            onChange={(e) => {
              setCapacity(e.target.value);
              setErrors((p) => ({ ...p, capacity: undefined }));
              setState('idle');
            }}
            hint={t('settings.capacityHint')}
            error={errors.capacity ?? null}
          />
          {state === 'failed' && (
            <p role="alert" className="text-red-700">
              {t('common.genericError')}
            </p>
          )}
          {state === 'saved' && (
            <p role="status" className="text-green-800">
              ✓ {t('settings.saved')}
            </p>
          )}
          <div>
            <button
              type="submit"
              aria-disabled={state === 'saving' || undefined}
              className="min-h-11 rounded-md bg-slate-900 px-4 font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 aria-disabled:opacity-60"
            >
              {state === 'saving' ? t('common.working') : t('common.save')}
            </button>
          </div>
        </form>
      )}
      {loaded && (
        <div className="flex flex-col gap-1">
          <label className="flex min-h-11 items-center gap-3 font-medium text-slate-900">
            <input
              type="checkbox"
              checked={loaded.showOccupancyCount}
              aria-disabled={countState === 'saving' || undefined}
              onChange={(e) => void toggleCount(e.target.checked)}
              aria-describedby="count-hint"
              className="size-5"
            />
            {t('settings.showCount')}
          </label>
          <p id="count-hint" className="text-sm text-slate-600">
            {t('settings.showCountHint')}
          </p>
          {countState === 'saved' && (
            <p role="status" className="text-green-800">
              ✓ {t('settings.saved')}
            </p>
          )}
          {countFailed && (
            <p role="alert" className="text-red-700">
              {t('common.genericError')}
            </p>
          )}
        </div>
      )}
      {loaded && (
        <div className="flex flex-col gap-1">
          <label className="flex min-h-11 items-center gap-3 font-medium text-slate-900">
            <input
              type="checkbox"
              checked={loaded.receptionCanEditShifts}
              aria-disabled={shiftsState === 'saving' || undefined}
              onChange={(e) => void toggleShifts(e.target.checked)}
              aria-describedby="shifts-hint"
              className="size-5"
            />
            {t('settings.receptionShifts')}
          </label>
          <p id="shifts-hint" className="text-sm text-slate-600">
            {t('settings.receptionShiftsHint')}
          </p>
          {shiftsState === 'saved' && (
            <p role="status" className="text-green-800">
              ✓ {t('settings.saved')}
            </p>
          )}
          {shiftsFailed && (
            <p role="alert" className="text-red-700">
              {t('common.genericError')}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
