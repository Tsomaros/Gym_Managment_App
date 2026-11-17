import {
  AUTO_CHECKOUT_MAX,
  AUTO_CHECKOUT_MIN,
  type GymSettings,
  UpdateGymSettingsSchema,
} from '@gym/shared';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
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
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed' | 'loadFailed'>('idle');

  const load = useCallback(() => {
    setState('idle');
    apiFetch<GymSettings>(`/gyms/${gymId}/settings`)
      .then((s) => {
        setLoaded(s);
        setMinutes(String(s.autoCheckoutMinutes));
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

  async function save(e: FormEvent) {
    e.preventDefault();
    if (state === 'saving') return; // a second Enter must not send a second request
    const parsed = UpdateGymSettingsSchema.safeParse({
      autoCheckoutMinutes: minutes.trim() === '' ? NaN : Number(minutes),
    });
    if (!parsed.success) {
      setFieldError(t('settings.invalid'));
      setState('idle');
      return;
    }
    setFieldError(null);
    setState('saving');
    try {
      const updated = await apiFetch<GymSettings>(`/gyms/${gymId}/settings`, {
        method: 'PATCH',
        body: JSON.stringify(parsed.data),
      });
      setLoaded(updated);
      setMinutes(String(updated.autoCheckoutMinutes));
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
            value={minutes}
            onChange={(e) => {
              setMinutes(e.target.value);
              setState('idle');
            }}
            hint={t('settings.hint')}
            error={fieldError}
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
              checked={loaded.receptionCanEditShifts}
              disabled={shiftsState === 'saving'}
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
