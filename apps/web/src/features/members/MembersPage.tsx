import { MEMBER_STATUSES, type MemberStatus, type MemberSummary } from '@gym/shared';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { apiFetch } from '../../api/client';
import { formatDate } from '../../lib/format';
import { StatusBadge } from './StatusBadge';

/** Reception and owner: members, newest sign-up first, searchable, filterable by state. */
export function MembersPage() {
  const { t, i18n } = useTranslation();
  const { gymId } = useParams();
  const searchId = useId();
  const statusId = useId();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<MemberStatus | ''>('');
  const [members, setMembers] = useState<MemberSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (status) params.set('status', status);
    const query = params.toString();
    let cancelled = false;
    // A short pause so typing a name doesn't send a request per letter.
    const timer = setTimeout(() => {
      apiFetch<MemberSummary[]>(`/gyms/${gymId}/members${query ? `?${query}` : ''}`)
        .then((list) => {
          if (!cancelled) {
            setMembers(list);
            setFailed(false);
          }
        })
        .catch(() => !cancelled && setFailed(true));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [gymId, q, status]);

  return (
    <section aria-labelledby="members-title" className="flex flex-col gap-4">
      <h2 id="members-title" className="text-xl font-semibold text-slate-900">
        {t('nav.members')}
      </h2>
      <div className="flex flex-wrap gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={searchId} className="text-sm font-medium text-slate-700">
            {t('members.search')}
          </label>
          <input
            id={searchId}
            type="search"
            value={q}
            placeholder={t('members.searchPlaceholder')}
            onChange={(e) => setQ(e.target.value)}
            className="min-h-11 rounded-md border border-slate-500 px-3 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={statusId} className="text-sm font-medium text-slate-700">
            {t('members.status')}
          </label>
          <select
            id={statusId}
            value={status}
            onChange={(e) => setStatus(e.target.value as MemberStatus | '')}
            className="min-h-11 rounded-md border border-slate-500 bg-white px-3 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            <option value="">{t('members.allStatuses')}</option>
            {MEMBER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {failed && (
        <p role="alert" className="text-red-700">
          {t('common.genericError')}
        </p>
      )}
      {!members && !failed && <p className="text-slate-600">{t('app.loading')}</p>}
      <p role="status" className="text-sm text-slate-600">
        {members && members.length > 0 ? t('members.count', { count: members.length }) : ''}
      </p>
      {members?.length === 0 && <p className="text-slate-600">{t('members.empty')}</p>}
      {members && members.length > 0 && (
        <ul className="flex flex-col gap-2">
          {members.map((m) => (
            <li key={m.userId}>
              <Link
                to={m.userId}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              >
                <span className="mr-auto min-w-0">
                  <span className="block font-semibold break-words text-slate-900">
                    {m.firstName} {m.lastName}
                  </span>
                  <span className="block text-sm text-slate-600">
                    {[m.phone, m.email].filter(Boolean).join(' · ')}
                  </span>
                  {!m.emailVerified && (
                    <span className="block text-sm text-amber-900">{t('members.unverified')}</span>
                  )}
                </span>
                <span className="flex flex-col items-end gap-1">
                  <StatusBadge status={m.status} />
                  {m.currentEndsOn && (
                    <span className="text-sm text-slate-600">
                      {t('members.until', { date: formatDate(m.currentEndsOn, i18n.language) })}
                    </span>
                  )}
                  {m.visitsLeft !== null && (
                    <span className="text-sm text-slate-600">
                      {t('my.visits', { count: m.visitsLeft })}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
