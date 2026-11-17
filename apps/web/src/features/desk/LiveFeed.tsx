import type { CheckInResult } from '@gym/shared';
import { useTranslation } from 'react-i18next';
import { CheckInCard, useReasonText } from './CheckInCard';

/**
 * The left side of the desk: the latest check-in as a big card, the ones before it as short lines,
 * and whether the live link is up (stale data is worse than a visible "reconnecting").
 */
export function LiveFeed({
  results,
  connected,
  onSell,
  onCover,
}: {
  /** Newest first. */
  results: CheckInResult[];
  connected: boolean;
  onSell: (result: CheckInResult) => void;
  onCover?: (result: CheckInResult) => void;
}) {
  const { t } = useTranslation();
  const reasonText = useReasonText();
  const [latest, ...previous] = results;

  return (
    <section aria-labelledby="live-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="live-title" className="mr-auto text-lg font-semibold text-slate-900">
          {t('desk.liveTitle')}
        </h2>
        <p
          role="status"
          aria-label={t('desk.connection')}
          className={`rounded-full px-3 py-1 text-base font-semibold ${
            connected
              ? 'bg-green-100 text-green-900'
              : 'bg-amber-100 text-amber-950 ring-1 ring-amber-700'
          }`}
        >
          <span aria-hidden="true">{connected ? '● ' : '○ '}</span>
          {connected ? t('desk.live') : t('desk.reconnecting')}
        </p>
      </div>

      {latest ? (
        <CheckInCard result={latest} onSell={onSell} onCover={onCover} />
      ) : (
        <p className="text-slate-700">{t('desk.empty')}</p>
      )}

      {previous.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-600">{t('desk.previous')}</h3>
          <ul className="flex flex-col gap-1">
            {previous.slice(0, 10).map((r) => (
              <li
                key={r.checkInId}
                data-testid="previous-check-in"
                className={`flex flex-wrap items-center gap-x-3 rounded-lg border px-3 py-2 ${
                  r.valid ? 'border-slate-200 bg-white' : 'border-red-700 bg-red-50'
                }`}
              >
                <span aria-hidden="true" className="font-bold">
                  {r.valid ? '✓' : '!'}
                </span>
                <span className="mr-auto font-medium break-words text-slate-900">
                  {r.member.firstName} {r.member.lastName}
                </span>
                {!r.valid && (
                  <span className="text-sm font-semibold text-red-900">{reasonText(r)}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
