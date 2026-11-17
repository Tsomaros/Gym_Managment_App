import type { PendingInvitation, StaffList, StaffMember, StaffRole } from '@gym/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { apiFetch } from '../../api/client';
import { InviteStaffDialog } from './InviteStaffDialog';
import { RemoveRoleDialog } from './RemoveRoleDialog';

const button =
  'min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';
const primary =
  'min-h-11 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';

/**
 * Staff of the gym with their roles and contact details. The owner (`canManage`) also invites
 * people, sees and cancels pending invitations, and removes roles; reception just reads.
 */
export function StaffPage({ canManage }: { canManage: boolean }) {
  const { t, i18n } = useTranslation();
  const { gymId = '' } = useParams();
  const [data, setData] = useState<StaffList | null>(null);
  const [failed, setFailed] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<{ member: StaffMember; role: StaffRole } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionFailed, setActionFailed] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(() => {
    setFailed(false);
    apiFetch<StaffList>(`/gyms/${gymId}/staff`)
      .then(setData)
      .catch(() => setFailed(true));
  }, [gymId]);
  useEffect(load, [load]);

  const date = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-GB' : 'el-GR', {
      dateStyle: 'short',
    }).format(new Date(iso));
  const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;

  async function cancelInvite(p: PendingInvitation) {
    setActionFailed(false);
    try {
      await apiFetch(`/gyms/${gymId}/invitations/${p.id}/cancel`, { method: 'POST' });
      setNotice(t('staff.cancelled'));
      load();
      // The button that was pressed is gone: keep keyboard and screen-reader users in place.
      titleRef.current?.focus();
    } catch {
      setActionFailed(true);
    }
  }

  return (
    <section aria-labelledby="staff-title">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2
          id="staff-title"
          ref={titleRef}
          tabIndex={-1}
          className="mr-auto text-xl font-semibold text-slate-900 focus:outline-none"
        >
          {t('nav.staff')}
        </h2>
        {canManage && (
          <button type="button" onClick={() => setInviting(true)} className={primary}>
            {t('staff.invite')}
          </button>
        )}
      </div>

      <div role="status" className="mb-4 min-h-6 text-green-800">
        {notice}
      </div>
      {actionFailed && (
        <p role="alert" className="mb-4 text-red-700">
          {t('common.genericError')}
        </p>
      )}
      {failed && (
        <div role="alert" className="mb-4 flex items-center gap-3 text-red-700">
          {t('common.genericError')}
          <button type="button" onClick={load} className="min-h-11 underline">
            {t('app.retry')}
          </button>
        </div>
      )}
      {!data && !failed && (
        <p role="status" className="text-slate-600">
          {t('app.loading')}
        </p>
      )}
      {data && data.staff.length === 0 && <p className="text-slate-700">{t('staff.empty')}</p>}
      {data && data.staff.length > 0 && (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {data.staff.map((m) => (
            <li key={m.userId} className="flex flex-col gap-2 p-4">
              <p className="font-semibold break-words text-slate-900">{fullName(m)}</p>
              <ul className="flex flex-wrap gap-2" aria-label={t('staff.roles')}>
                {m.roles.map((r) => (
                  <li
                    key={r}
                    className="rounded-full bg-slate-100 px-2.5 py-0.5 text-sm font-medium text-slate-900 ring-1 ring-slate-400"
                  >
                    {t(`roles.${r}`)}
                  </li>
                ))}
              </ul>
              <p className="text-sm break-all text-slate-700">{m.email}</p>
              {m.phone && (
                <a
                  href={`tel:${m.phone}`}
                  className="inline-flex min-h-11 w-fit items-center text-sm font-medium text-slate-900 underline"
                >
                  <span className="sr-only">{t('staff.call', { name: fullName(m) })}: </span>
                  {m.phone}
                </a>
              )}
              {canManage && (
                <div className="flex flex-wrap gap-2">
                  {m.roles.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRemoving({ member: m, role: r })}
                      aria-label={t('staff.removeRoleNamed', {
                        role: t(`roles.${r}`),
                        name: fullName(m),
                      })}
                      className={button}
                    >
                      {t('staff.removeRole', { role: t(`roles.${r}`) })}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && data && data.pending.length > 0 && (
        <section aria-labelledby="pending-title" className="mt-8">
          <h3 id="pending-title" className="mb-2 text-lg font-semibold text-slate-900">
            {t('staff.pending')}
          </h3>
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
            {data.pending.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="mr-auto min-w-0">
                  <p className="font-semibold break-words text-slate-900">{fullName(p)}</p>
                  <p className="text-sm break-all text-slate-700">{p.email}</p>
                  <p className="text-sm text-slate-600">
                    {p.roles.map((r) => t(`roles.${r}`)).join(', ')} ·{' '}
                    {t('staff.expires', { date: date(p.expiresAt) })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void cancelInvite(p)}
                  aria-label={t('staff.cancelInviteNamed', { name: fullName(p) })}
                  className={button}
                >
                  {t('staff.cancelInvite')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {inviting && (
        <InviteStaffDialog
          gymId={gymId}
          onClose={() => setInviting(false)}
          onInvited={({ mailSent }) => {
            setInviting(false);
            setNotice(mailSent ? t('staff.sent') : t('staff.sentNoMail'));
            load();
          }}
        />
      )}
      {removing && (
        <RemoveRoleDialog
          gymId={gymId}
          person={{ userId: removing.member.userId, name: fullName(removing.member) }}
          role={removing.role}
          onCancel={() => setRemoving(null)}
          onRemoved={() => {
            setRemoving(null);
            setNotice(t('staff.removed'));
            load();
            titleRef.current?.focus();
          }}
        />
      )}
    </section>
  );
}
