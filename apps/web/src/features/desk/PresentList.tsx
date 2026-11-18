import type { PresentMember } from '@gym/shared';
import { useTranslation } from 'react-i18next';
import { formatTime } from '../../lib/format';
import { Avatar } from '../members/Avatar';
import { StatusBadge } from '../members/StatusBadge';

/** "Inside now": everyone with a valid check-in who has not left, with a check-out button. */
export function PresentList({
  members,
  capacity,
  onCheckOut,
  timeZone,
}: {
  members: PresentMember[];
  /** The gym's capacity, when the owner has set one: "5 / 30". */
  capacity?: number | null;
  onCheckOut: (checkInId: string) => void;
  timeZone: string;
}) {
  const { t, i18n } = useTranslation();
  return (
    <section aria-labelledby="present-title" className="flex flex-col gap-3">
      <h2 id="present-title" className="text-lg font-semibold text-slate-900">
        {t('desk.present')}{' '}
        <span className="rounded-full bg-slate-900 px-2.5 py-0.5 text-sm text-white tabular-nums">
          {members.length}
          {capacity != null && (
            <>
              <span aria-hidden="true"> / {capacity}</span>
              <span className="sr-only"> {t('desk.outOf', { count: capacity })}</span>
            </>
          )}
        </span>
      </h2>
      {members.length === 0 ? (
        <p className="text-slate-700">{t('desk.presentEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {members.map((m) => {
            const name = `${m.firstName} ${m.lastName}`;
            return (
              <li
                key={m.checkInId}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3"
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
                  <time dateTime={m.at} className="text-sm text-slate-600 tabular-nums">
                    {formatTime(m.at, timeZone, i18n.language)}
                  </time>
                </span>
                <StatusBadge status={m.membershipStatus} />
                <button
                  type="button"
                  onClick={() => onCheckOut(m.checkInId)}
                  aria-label={t('desk.checkOutNamed', { name })}
                  className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                >
                  {t('desk.checkOut')}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
