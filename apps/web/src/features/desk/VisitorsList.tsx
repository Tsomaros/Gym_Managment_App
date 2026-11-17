import type { VisitorRow } from '@gym/shared';
import { useTranslation } from 'react-i18next';
import { formatTime } from '../../lib/format';
import { useReasonText } from './CheckInCard';

/** Today's visitors, refused attempts included, newest first. */
export function VisitorsList({ rows, timeZone }: { rows: VisitorRow[]; timeZone: string }) {
  const { t, i18n } = useTranslation();
  const reasonText = useReasonText();
  return (
    <section aria-labelledby="visitors-title" className="flex flex-col gap-3">
      <h2 id="visitors-title" className="text-lg font-semibold text-slate-900">
        {t('desk.today')}
      </h2>
      {rows.length === 0 ? (
        <p className="text-slate-700">{t('desk.visitorsEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li
              key={r.checkInId}
              className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border p-3 ${
                r.valid ? 'border-slate-200 bg-white' : 'border-red-700 bg-red-50'
              }`}
            >
              <time dateTime={r.at} className="text-sm text-slate-600 tabular-nums">
                {formatTime(r.at, timeZone, i18n.language)}
              </time>
              <span className="mr-auto font-semibold break-words text-slate-900">
                {r.firstName} {r.lastName}
              </span>
              <span className="text-sm text-slate-600">
                {t(r.method === 'kiosk' ? 'desk.kiosk' : 'desk.manual')}
              </span>
              {!r.valid && (
                <span className="w-full text-sm font-semibold text-red-900">
                  <span aria-hidden="true">! </span>
                  <span>{t('desk.refused')}</span> ·{' '}
                  <span>{reasonText({ reason: r.reason, membership: null }) ?? ''}</span>
                </span>
              )}
              {r.checkedOutAt && (
                <span className="text-sm text-slate-600">
                  {t('desk.leftAt', { time: formatTime(r.checkedOutAt, timeZone, i18n.language) })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
