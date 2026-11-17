import type { MemberStatus, MembershipStatus } from '@gym/shared';
import { useTranslation } from 'react-i18next';

type Status = MemberStatus | MembershipStatus;

/** Colour plus a symbol plus words: status is never told by colour alone. */
const STYLE: Record<Status, { className: string; symbol: string }> = {
  new: { className: 'bg-sky-100 text-sky-900', symbol: '★' },
  active: { className: 'bg-green-100 text-green-900', symbol: '●' },
  frozen: { className: 'bg-indigo-100 text-indigo-900', symbol: '❄' },
  expiring: { className: 'bg-amber-100 text-amber-950 ring-1 ring-amber-700', symbol: '!' },
  expired: { className: 'bg-red-50 text-red-900 ring-1 ring-red-700', symbol: '○' },
  upcoming: { className: 'bg-teal-100 text-teal-900', symbol: '→' },
  used_up: { className: 'bg-red-50 text-red-900 ring-1 ring-red-700', symbol: '○' },
  voided: { className: 'bg-slate-200 text-slate-800 line-through decoration-1', symbol: '✕' },
};

export function StatusBadge({
  status,
  size = 'normal',
}: {
  status: Status;
  size?: 'normal' | 'large';
}) {
  const { t } = useTranslation();
  const { className, symbol } = STYLE[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap ${
        size === 'large' ? 'px-3 py-1 text-base' : 'px-2.5 py-0.5 text-sm'
      } ${className}`}
    >
      <span aria-hidden="true">{symbol}</span>
      <span>{t(`status.${status}`)}</span>
    </span>
  );
}
