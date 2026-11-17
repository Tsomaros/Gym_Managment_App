import type { CheckInResult } from '@gym/shared';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../../lib/format';
import { Avatar } from '../members/Avatar';
import { StatusBadge } from '../members/StatusBadge';

/** Why a check-in was refused, in a sentence the receptionist can act on. */
export function useReasonText() {
  const { t, i18n } = useTranslation();
  return (result: Pick<CheckInResult, 'reason' | 'membership'>): string | null => {
    const { reason, membership } = result;
    if (!reason) return null;
    const date =
      reason === 'upcoming_only'
        ? membership?.startsOn
        : reason === 'expired'
          ? membership?.effectiveEndsOn
          : null;
    if ((reason === 'upcoming_only' || reason === 'expired') && !date) {
      return t(`desk.reasonNoDate.${reason}`);
    }
    return t(`desk.reason.${reason}`, { date: date ? formatDate(date, i18n.language) : '' });
  };
}

/**
 * The verdict for one check-in, big enough to read from the other side of the desk: photo, name,
 * status and the membership; a refusal gets a red frame and its reason in words, never colour alone.
 */
export function CheckInCard({
  result,
  onSell,
  onCover,
}: {
  result: CheckInResult;
  /** When given, a refusal offers to sell a membership right away. */
  onSell?: (result: CheckInResult) => void;
  /** When given, a primary trainer who is off shift offers to assign a cover for today. */
  onCover?: (result: CheckInResult) => void;
}) {
  const { t, i18n } = useTranslation();
  const reasonText = useReasonText();
  const { member, membership } = result;
  const name = `${member.firstName} ${member.lastName}`;
  const reason = reasonText(result);
  const remaining = membership
    ? membership.remaining.visits !== null
      ? t('my.visits', { count: membership.remaining.visits })
      : membership.remaining.days !== null
        ? t('my.days', { count: membership.remaining.days })
        : null
    : null;

  return (
    <article
      data-testid="check-in-card"
      data-verdict={result.valid ? 'valid' : 'refused'}
      className={`flex flex-col gap-4 rounded-2xl border-4 p-5 ${
        result.valid ? 'border-green-700 bg-green-50' : 'border-red-700 bg-red-50'
      }`}
    >
      <div className="flex flex-wrap items-center gap-4">
        <Avatar
          firstName={member.firstName}
          lastName={member.lastName}
          photoUrl={member.photoUrl}
          size="large"
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-3xl font-bold break-words text-slate-900">{name}</h3>
          <p
            className={`mt-1 text-xl font-semibold ${result.valid ? 'text-green-900' : 'text-red-900'}`}
          >
            <span aria-hidden="true">{result.valid ? '✓ ' : '! '}</span>
            {result.valid ? t('desk.valid') : t('desk.refused')}
          </p>
          {reason && (
            <p data-testid="check-in-reason" className="mt-1 text-xl font-bold text-red-900">
              {reason}
            </p>
          )}
        </div>
        <StatusBadge status={membership?.status ?? 'new'} size="large" />
      </div>

      {membership && (
        <div className="text-lg text-slate-800">
          <p className="font-semibold">{membership.name}</p>
          <p>
            {remaining}
            {remaining && membership.effectiveEndsOn && ' · '}
            {membership.effectiveEndsOn &&
              t(membership.status === 'frozen' ? 'desk.newEnd' : 'members.until', {
                date: formatDate(membership.effectiveEndsOn, i18n.language),
              })}
          </p>
        </div>
      )}
      {result.trainer && (
        <p className="text-lg text-slate-800">
          {t(result.trainer.onDuty ? 'trainers.trainerLine' : 'trainers.trainerLineOff', {
            name: result.trainer.firstName,
          })}
        </p>
      )}
      {result.cover && (
        <p className="text-lg font-semibold text-slate-900">
          {t('trainers.coverLine', { name: result.cover.firstName })}
        </p>
      )}
      {result.trainer && !result.trainer.onDuty && !result.cover && onCover && (
        <div>
          <button
            type="button"
            onClick={() => onCover(result)}
            className="min-h-12 rounded-md border border-slate-400 px-5 text-lg font-semibold text-slate-900 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            {t('trainers.assignCover')}
          </button>
        </div>
      )}
      {result.duplicate && <p className="text-base text-slate-700">{t('desk.duplicate')}</p>}

      {!result.valid && onSell && (
        <div>
          <button
            type="button"
            onClick={() => onSell(result)}
            className="min-h-12 rounded-md bg-slate-900 px-5 text-lg font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            {t('desk.sell')}
          </button>
        </div>
      )}
    </article>
  );
}
