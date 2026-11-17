import type { OnDutyPerson } from '@gym/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { apiFetch } from '../../api/client';

/** Who is on a shift right now, refreshed every minute (shifts start and end on the clock). */
export function OnDutyPanel({ reloadMs = 60_000 }: { reloadMs?: number } = {}) {
  const { t } = useTranslation();
  const { gymId = '' } = useParams();
  const [people, setPeople] = useState<OnDutyPerson[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    apiFetch<OnDutyPerson[]>(`/gyms/${gymId}/on-duty`)
      .then((list) => {
        setPeople(list);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [gymId]);
  useEffect(() => {
    load();
    const timer = setInterval(load, reloadMs);
    return () => clearInterval(timer);
  }, [load, reloadMs]);

  return (
    <section
      aria-labelledby="on-duty-title"
      className="rounded-xl border border-slate-200 bg-white p-4"
    >
      <h2 id="on-duty-title" className="mb-2 text-lg font-semibold text-slate-900">
        {t('schedule.onDuty')}
      </h2>
      {!people && !failed && (
        <p role="status" className="text-slate-600">
          {t('app.loading')}
        </p>
      )}
      {failed && !people && <p className="text-slate-700">{t('schedule.onDutyFailed')}</p>}
      {failed && people && (
        <p className="mb-2 text-sm text-amber-900">{t('schedule.onDutyStale')}</p>
      )}
      {people && people.length === 0 && (
        <p className="text-slate-700">{t('schedule.nobodyOnDuty')}</p>
      )}
      {people && people.length > 0 && (
        <ul className="flex flex-col gap-2">
          {people.map((p) => (
            <li key={p.userId} className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-semibold text-slate-900">
                {p.firstName} {p.lastName}
              </span>
              <span className="text-sm text-slate-700">
                {p.roles.map((r) => t(`roles.${r}`)).join(', ')} ·{' '}
                {t('schedule.until', { time: p.until })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
