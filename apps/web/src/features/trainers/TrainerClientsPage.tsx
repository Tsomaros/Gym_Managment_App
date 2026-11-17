import type { TrainerClient } from '@gym/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { apiFetch } from '../../api/client';
import { Avatar } from '../members/Avatar';
import { StatusBadge } from '../members/StatusBadge';

function ClientCard({ c }: { c: TrainerClient }) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <Avatar firstName={c.firstName} lastName={c.lastName} photoUrl={c.photoUrl} decorative />
      <span className="mr-auto min-w-0 font-semibold break-words text-slate-900">
        {c.firstName} {c.lastName}
      </span>
      {c.paused && (
        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-sm font-semibold text-amber-950 ring-1 ring-amber-700">
          <span aria-hidden="true">⏸ </span>
          {t('trainers.paused')}
        </span>
      )}
      <StatusBadge status={c.membershipStatus} />
    </li>
  );
}

/** A trainer's own clients (paused ones last) and the members they cover for today. */
export function TrainerClientsPage() {
  const { t } = useTranslation();
  const { gymId = '' } = useParams();
  const [clients, setClients] = useState<TrainerClient[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    apiFetch<TrainerClient[]>(`/gyms/${gymId}/trainer/clients`)
      .then(setClients)
      .catch(() => setFailed(true));
  }, [gymId]);
  useEffect(load, [load]);

  const own = clients?.filter((c) => !c.cover) ?? [];
  const covers = clients?.filter((c) => c.cover) ?? [];

  return (
    <section aria-labelledby="clients-title" className="flex flex-col gap-6">
      <h2 id="clients-title" className="text-xl font-semibold text-slate-900">
        {t('trainers.clients')}
      </h2>
      {failed && (
        <div role="alert" className="flex items-center gap-3 text-red-700">
          {t('common.genericError')}
          <button type="button" onClick={load} className="min-h-11 underline">
            {t('app.retry')}
          </button>
        </div>
      )}
      {!clients && !failed && (
        <p role="status" className="text-slate-600">
          {t('app.loading')}
        </p>
      )}
      {clients && own.length === 0 && <p className="text-slate-700">{t('trainers.noClients')}</p>}
      {own.length > 0 && (
        <ul className="flex flex-col gap-2" aria-labelledby="clients-title">
          {own.map((c) => (
            <ClientCard key={c.memberId} c={c} />
          ))}
        </ul>
      )}
      {covers.length > 0 && (
        <section aria-labelledby="covers-title" className="flex flex-col gap-2">
          <h3 id="covers-title" className="text-lg font-semibold text-slate-900">
            {t('trainers.coversToday')}
          </h3>
          <ul className="flex flex-col gap-2">
            {covers.map((c) => (
              <ClientCard key={c.memberId} c={c} />
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
