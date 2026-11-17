import type { ExpandedShift } from '@gym/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { apiFetch } from '../../api/client';
import { addDays, todayIn } from './dates';

const DAYS_AHEAD = 14;

/**
 * The caller's own shifts for the next 14 days, today highlighted. Trainers can't read the gym's
 * settings, so "today" is the device's calendar day (the gym and its staff share a time zone).
 */
export function MySchedulePage({ now = () => new Date() }: { now?: () => Date } = {}) {
  const { t, i18n } = useTranslation();
  const { gymId = '' } = useParams();
  const [shifts, setShifts] = useState<ExpandedShift[] | null>(null);
  const [failed, setFailed] = useState(false);
  const today = todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone, now());

  const load = useCallback(() => {
    setFailed(false);
    apiFetch<ExpandedShift[]>(
      `/gyms/${gymId}/me/schedule?from=${today}&to=${addDays(today, DAYS_AHEAD - 1)}`,
    )
      .then(setShifts)
      .catch(() => setFailed(true));
  }, [gymId, today]);
  useEffect(load, [load]);

  const label = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-GB' : 'el-GR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(new Date(`${iso}T00:00:00Z`));

  return (
    <section aria-labelledby="my-schedule-title">
      <h2 id="my-schedule-title" className="mb-3 text-xl font-semibold text-slate-900">
        {t('schedule.mine')}
      </h2>
      {failed && (
        <div role="alert" className="mb-4 flex items-center gap-3 text-red-700">
          {t('common.genericError')}
          <button type="button" onClick={load} className="min-h-11 underline">
            {t('app.retry')}
          </button>
        </div>
      )}
      {!shifts && !failed && (
        <p role="status" className="text-slate-600">
          {t('app.loading')}
        </p>
      )}
      {shifts && shifts.length === 0 && (
        <p className="text-slate-700">{t('schedule.mineEmpty', { days: DAYS_AHEAD })}</p>
      )}
      {shifts && shifts.length > 0 && (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {shifts.map((s) => (
            <li
              key={`${s.date}${s.startsAt}`}
              aria-current={s.date === today ? 'date' : undefined}
              className={`flex flex-wrap items-center gap-3 p-4 ${
                s.date === today ? 'bg-slate-900 text-white' : 'text-slate-900'
              }`}
            >
              <span className="mr-auto font-semibold">
                {label(s.date)}
                {s.date === today && <span className="font-normal"> · {t('schedule.today')}</span>}
              </span>
              <span className="font-medium">
                {s.startsAt}–{s.endsAt}
              </span>
              {s.note && <span className="w-full text-sm opacity-90">{s.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
