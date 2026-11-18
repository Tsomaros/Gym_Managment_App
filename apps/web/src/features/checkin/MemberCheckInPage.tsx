import type { MyMemberships } from '@gym/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { OccupancyBadge } from '../occupancy/OccupancyBadge';
import { MyMembershipCard } from '../my-membership/MyMembershipCard';
import { QrCode } from './QrCode';
import { useCheckInToken } from './useCheckInToken';
import { useWakeLock } from './useWakeLock';

const TOKEN_LIFE_SECONDS = 45;

/** A small ring that empties as the code ages; the seconds are also given in words. */
function CountdownRing({ secondsLeft }: { secondsLeft: number }) {
  const radius = 9;
  const circumference = 2 * Math.PI * radius;
  const fraction = Math.min(1, secondsLeft / TOKEN_LIFE_SECONDS);
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6 -rotate-90">
      <circle cx="12" cy="12" r={radius} fill="none" strokeWidth="3" className="stroke-slate-200" />
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - fraction)}
        className="stroke-slate-700"
      />
    </svg>
  );
}

/** The member's way in: a rotating QR code to show to the tablet at the door (spec §6.2). */
export function MemberCheckInPage() {
  const { t } = useTranslation();
  const { gymId } = useParams();
  const { me } = useAuth();
  const { token, secondsLeft, error, retry } = useCheckInToken(gymId);
  const [memberships, setMemberships] = useState<MyMemberships['memberships'] | null>(null);
  useWakeLock();

  useEffect(() => {
    let current = true; // a slow answer for the previous gym must not replace this one
    setMemberships(null);
    apiFetch<MyMemberships>(`/gyms/${gymId}/me/memberships`)
      .then((r) => current && setMemberships(r.memberships))
      .catch(() => current && setMemberships(null));
    return () => {
      current = false;
    };
  }, [gymId]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 text-center">
      <h2 className="text-xl font-semibold text-slate-900">{t('checkin.title')}</h2>
      <p className="text-slate-700">{t('checkin.hint')}</p>

      {token ? (
        <div className="flex w-full flex-col items-center gap-2 rounded-2xl bg-white p-2 ring-1 ring-slate-200">
          <QrCode
            value={token}
            label={me ? t('checkin.qrLabel', { name: me.fullName }) : t('checkin.qrLabelAnonymous')}
          />
          <p className="flex items-center gap-2 text-sm text-slate-600">
            <CountdownRing secondsLeft={secondsLeft} />
            {t('checkin.refresh', { count: secondsLeft })}
          </p>
        </div>
      ) : error ? (
        <div
          role="alert"
          className="flex w-full flex-col items-center gap-3 rounded-2xl border border-amber-700 bg-amber-50 p-5 text-amber-950"
        >
          <p className="text-base font-medium">{t('checkin.offline')}</p>
          <button
            type="button"
            onClick={retry}
            className="min-h-11 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            {t('checkin.retry')}
          </button>
        </div>
      ) : (
        <p role="status" className="py-16 text-slate-600">
          {t('checkin.loading')}
        </p>
      )}

      {/* Below the code: the badge arrives after the first answer and must not push the QR down. */}
      {gymId && <OccupancyBadge gymId={gymId} />}

      {me && <p className="text-lg font-semibold text-slate-900">{me.fullName}</p>}
      {memberships && memberships.length > 0 && (
        <div className="w-full">
          <MyMembershipCard memberships={memberships} compact />
        </div>
      )}
    </div>
  );
}
