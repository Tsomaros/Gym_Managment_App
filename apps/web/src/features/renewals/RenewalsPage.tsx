import type { MemberSummary } from '@gym/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { apiFetch } from '../../api/client';
import { formatDate } from '../../lib/format';
import { Avatar } from '../members/Avatar';
import { SellMembershipDialog } from '../members/SellMembershipDialog';
import { StatusBadge } from '../members/StatusBadge';

/** Reception's renewals list: members about to run out, the soonest end first, to call or sell to. */
export function RenewalsPage() {
  const { t, i18n } = useTranslation();
  const { gymId = '' } = useParams();
  const [members, setMembers] = useState<MemberSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selling, setSelling] = useState<MemberSummary | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    apiFetch<MemberSummary[]>(`/gyms/${gymId}/members?status=expiring&sort=ending`)
      .then(setMembers)
      .catch(() => setFailed(true));
  }, [gymId]);
  useEffect(load, [load]);

  return (
    <section aria-labelledby="renewals-title" className="flex flex-col gap-4">
      <div>
        <h2 id="renewals-title" className="text-xl font-semibold text-slate-900">
          {t('renewals.title')}
        </h2>
        <p className="text-sm text-slate-600">{t('renewals.hint')}</p>
      </div>

      {failed && (
        <div role="alert" className="flex items-center gap-3 text-red-700">
          {t('common.genericError')}
          <button type="button" onClick={load} className="min-h-11 underline">
            {t('app.retry')}
          </button>
        </div>
      )}
      {!members && !failed && <p className="text-slate-600">{t('app.loading')}</p>}
      {members?.length === 0 && <p className="text-slate-700">{t('renewals.empty')}</p>}
      {members && members.length > 0 && (
        <ul className="flex flex-col gap-2">
          {members.map((m) => {
            const name = `${m.firstName} ${m.lastName}`;
            return (
              <li
                key={m.userId}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4"
              >
                <Avatar
                  firstName={m.firstName}
                  lastName={m.lastName}
                  photoUrl={m.photoUrl}
                  size="small"
                  decorative
                />
                <span className="mr-auto min-w-0">
                  <span className="block font-semibold break-words text-slate-900">{name}</span>
                  <span className="block text-sm text-slate-700">
                    {m.currentEndsOn
                      ? t('members.until', { date: formatDate(m.currentEndsOn, i18n.language) })
                      : null}
                    {m.currentEndsOn && m.visitsLeft !== null && ' · '}
                    {m.visitsLeft !== null ? t('my.visits', { count: m.visitsLeft }) : null}
                  </span>
                  {m.phone && (
                    <a
                      href={`tel:${m.phone}`}
                      className="inline-flex min-h-11 items-center text-sm font-medium text-slate-900 underline"
                    >
                      <span className="sr-only">{t('renewals.call', { name })}: </span>
                      {m.phone}
                    </a>
                  )}
                </span>
                <StatusBadge status={m.status} />
                <button
                  type="button"
                  onClick={() => setSelling(m)}
                  aria-label={t('renewals.sellNamed', { name })}
                  className="min-h-11 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                >
                  {t('renewals.sell')}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selling && (
        <SellMembershipDialog
          gymId={gymId}
          memberId={selling.userId}
          memberName={`${selling.firstName} ${selling.lastName}`}
          onClose={() => setSelling(null)}
          onSold={load}
        />
      )}
    </section>
  );
}
