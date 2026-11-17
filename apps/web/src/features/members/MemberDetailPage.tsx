import type { CheckInResult, MemberDetail, Membership } from '@gym/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { ApiError, apiFetch } from '../../api/client';
import { formatDate, formatMoney } from '../../lib/format';
import { CheckInCard } from '../desk/CheckInCard';
import { AssignTrainerDialog } from '../trainers/AssignTrainerDialog';
import { CoverDialog } from '../trainers/CoverDialog';
import { FreezeDialog } from './FreezeDialog';
import { PhotoCapture } from './PhotoCapture';
import { SellMembershipDialog } from './SellMembershipDialog';
import { StatusBadge } from './StatusBadge';

const FREEZABLE = ['active', 'frozen', 'upcoming'];

/** Reception and owner: one member, their memberships, selling and freezing; payments for the owner. */
export function MemberDetailPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { gymId = '', memberId = '' } = useParams();
  const [member, setMember] = useState<MemberDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [selling, setSelling] = useState(false);
  const [freezing, setFreezing] = useState<Membership | null>(null);
  const [verdict, setVerdict] = useState<CheckInResult | null>(null);
  const [assigning, setAssigning] = useState(false);
  // The assignment was refused for lack of a trainer membership: after the sale, offer it again.
  const [resumeAssign, setResumeAssign] = useState<{ sold: boolean } | null>(null);
  const [covering, setCovering] = useState(false);
  const [checkInFailed, setCheckInFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setMember(await apiFetch<MemberDetail>(`/gyms/${gymId}/members/${memberId}`));
      setState('ready');
    } catch (err) {
      // A failed refresh (after a sale or freeze) keeps the page and any open confirmation;
      // only a first load that fails shows the error.
      setState((s) =>
        s === 'ready' ? s : err instanceof ApiError && err.status === 404 ? 'missing' : 'error',
      );
    }
  }, [gymId, memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  const back = (
    <Link
      to=".."
      relative="path"
      className="inline-flex min-h-11 items-center text-sm font-medium text-slate-700 underline"
    >
      ← {t('nav.members')}
    </Link>
  );

  if (state === 'loading') return <p className="text-slate-600">{t('app.loading')}</p>;
  if (state === 'missing' || state === 'error' || !member) {
    return (
      <div className="flex flex-col gap-2">
        {back}
        <p role="alert" className="text-red-700">
          {t(state === 'missing' ? 'members.notFound' : 'common.genericError')}
        </p>
      </div>
    );
  }

  const fullName = `${member.firstName} ${member.lastName}`;
  async function checkInNow() {
    setCheckInFailed(false);
    try {
      setVerdict(
        await apiFetch<CheckInResult>(`/gyms/${gymId}/members/${memberId}/check-ins`, {
          method: 'POST',
        }),
      );
    } catch {
      setCheckInFailed(true);
    }
  }
  const period = (m: Membership) =>
    m.effectiveEndsOn
      ? `${formatDate(m.startsOn, lang)} – ${formatDate(m.effectiveEndsOn, lang)}`
      : t('sell.from', { from: formatDate(m.startsOn, lang) });

  return (
    <div className="flex flex-col gap-6">
      {back}
      <section
        aria-labelledby="member-name"
        className="rounded-xl border border-slate-200 bg-white p-6"
      >
        <div className="flex flex-wrap items-start gap-4">
          <PhotoCapture
            gymId={gymId}
            memberId={memberId}
            name={fullName}
            firstName={member.firstName}
            lastName={member.lastName}
            photoUrl={member.photoUrl}
            onChanged={() => void load()}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2
                id="member-name"
                className="mr-auto text-xl font-semibold break-words text-slate-900"
              >
                {fullName}
              </h2>
              <StatusBadge status={member.status} size="large" />
            </div>
            <div>
              <button
                type="button"
                onClick={() => void checkInNow()}
                className="min-h-11 rounded-md border border-slate-300 px-4 font-semibold text-slate-900 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              >
                {t('desk.checkInButton')}
              </button>
            </div>
          </div>
        </div>
        {checkInFailed && (
          <p role="alert" className="mt-3 text-red-700">
            {t('common.genericError')}
          </p>
        )}
        {verdict && (
          <div className="mt-4">
            <CheckInCard
              result={verdict}
              onSell={() => setSelling(true)}
              onCover={() => setCovering(true)}
            />
          </div>
        )}
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Item label={t('signup.phone')} value={member.phone} />
          <Item
            label={t('auth.email')}
            value={`${member.email}${member.emailVerified ? '' : ` (${t('members.unverified')})`}`}
          />
          <Item
            label={t('signup.dateOfBirth')}
            value={member.dateOfBirth && formatDate(member.dateOfBirth, lang)}
          />
          <Item
            label={t('signup.emergency')}
            value={
              member.emergencyContactName &&
              `${member.emergencyContactName} ${member.emergencyContactPhone ?? ''}`
            }
          />
        </dl>
      </section>

      <section
        aria-labelledby="trainer-title"
        className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4"
      >
        <h3 id="trainer-title" className="text-lg font-semibold text-slate-900">
          {t('trainers.section')}
        </h3>
        <p className="mr-auto min-w-0 break-words text-slate-900">
          {member.trainer ? (
            <>
              {member.trainer.firstName} {member.trainer.lastName}
              {member.trainer.paused && (
                <span className="ml-2 rounded-full bg-amber-100 px-2.5 py-0.5 text-sm font-semibold text-amber-950 ring-1 ring-amber-700">
                  <span aria-hidden="true">⏸ </span>
                  {t('trainers.paused')}
                </span>
              )}
            </>
          ) : (
            <span className="text-slate-700">{t('trainers.none')}</span>
          )}
        </p>
        <button
          type="button"
          onClick={() => setAssigning(true)}
          className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {member.trainer ? t('trainers.change') : t('trainers.assignBtn')}
        </button>
        {member.trainer?.paused && (
          <p className="w-full text-sm text-slate-700">{t('trainers.pausedHint')}</p>
        )}
      </section>

      <section aria-labelledby="memberships-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 id="memberships-title" className="mr-auto text-lg font-semibold text-slate-900">
            {t('members.memberships')}
          </h3>
          <button
            type="button"
            onClick={() => setSelling(true)}
            className="min-h-11 rounded-md bg-slate-900 px-4 font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            {t('sell.open')}
          </button>
        </div>
        {member.memberships.length === 0 && (
          <p className="text-slate-600">{t('members.noMemberships')}</p>
        )}
        <ul className="flex flex-col gap-2">
          {member.memberships.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4"
            >
              <div className="mr-auto min-w-0">
                <p className="font-semibold break-words text-slate-900">{m.name}</p>
                <p className="text-sm text-slate-600">{period(m)}</p>
                {m.visitsTotal !== null && (
                  <p className="text-sm text-slate-600">
                    {t('members.visitsUsed', { used: m.visitsUsed, total: m.visitsTotal })}
                  </p>
                )}
              </div>
              <StatusBadge status={m.status} />
              {m.kind === 'time' && m.maxFreezeDays > 0 && FREEZABLE.includes(m.status) && (
                <button
                  type="button"
                  onClick={() => setFreezing(m)}
                  aria-label={t('freeze.openNamed', { name: m.name })}
                  className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-slate-900"
                >
                  {t('freeze.open')}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {member.payments.length > 0 && (
        <section aria-labelledby="payments-title" className="flex flex-col gap-3">
          <h3 id="payments-title" className="text-lg font-semibold text-slate-900">
            {t('nav.payments')}
          </h3>
          <ul className="flex flex-col gap-2">
            {member.payments.map((p) => (
              <li key={p.id} className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
                <span className={p.voidedAt ? 'line-through' : 'font-semibold'}>
                  {formatMoney(p.amountCents, lang)}
                </span>{' '}
                · {t(`sell.${p.method}`)} · {p.membershipName} ·{' '}
                {new Date(p.paidAt).toLocaleDateString(lang === 'en' ? 'en-GB' : 'el-GR')}
                {p.voidedAt && ` · ${t('status.voided')}`}
              </li>
            ))}
          </ul>
        </section>
      )}

      {assigning && (
        <AssignTrainerDialog
          gymId={gymId}
          memberId={memberId}
          memberName={fullName}
          current={member.trainer}
          onClose={() => setAssigning(false)}
          onDone={() => {
            setAssigning(false);
            setVerdict(null); // its trainer line is out of date now
            void load();
          }}
          onSell={() => {
            setAssigning(false);
            setResumeAssign({ sold: false });
            setSelling(true);
          }}
        />
      )}
      {covering && verdict && (
        <CoverDialog
          gymId={gymId}
          memberId={memberId}
          memberName={fullName}
          primaryTrainerId={verdict.trainer?.userId ?? null}
          onClose={() => setCovering(false)}
          returnFocusTo={() => document.querySelector<HTMLElement>('[data-testid="cover-line"]')}
          onDone={(cover) => {
            setVerdict({ ...verdict, cover });
            setCovering(false);
          }}
        />
      )}
      {selling && (
        <SellMembershipDialog
          gymId={gymId}
          memberId={memberId}
          memberName={fullName}
          onClose={() => {
            setSelling(false);
            if (resumeAssign?.sold) setAssigning(true);
            setResumeAssign(null);
          }}
          onSold={() => {
            setResumeAssign((r) => r && { sold: true });
            void load();
          }}
        />
      )}
      {freezing && (
        <FreezeDialog
          gymId={gymId}
          membership={freezing}
          freezes={member.freezes}
          onClose={() => setFreezing(null)}
          onDone={() => {
            setFreezing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function Item({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-slate-600">{label}</dt>
      <dd className="break-words text-slate-900">{value || '—'}</dd>
    </div>
  );
}
