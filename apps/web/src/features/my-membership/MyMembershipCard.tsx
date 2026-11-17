import type { Membership } from '@gym/shared';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../../lib/format';
import { StatusBadge } from '../members/StatusBadge';

const RUNNING = ['active', 'frozen'];

/**
 * The member's home: what they have now, in big type (days or visits left), when it ends, and
 * what comes next. `memberships` are the member's non-voided ones, newest first.
 */
export function MyMembershipCard({
  memberships,
  compact = false,
}: {
  memberships: Membership[];
  /** One short block (name, state, what is left) for under the check-in code. */
  compact?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  // Oldest running first: the one being used up now.
  const current = [...memberships].reverse().find((m) => RUNNING.includes(m.status));
  const next = [...memberships]
    .filter((m) => m.status === 'upcoming')
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0];

  if (!current) {
    return (
      <section
        aria-labelledby="my-membership"
        className="rounded-xl border border-slate-200 bg-white p-6"
      >
        <h2 id="my-membership" className="text-lg font-semibold text-slate-900">
          {t('nav.myMembership')}
        </h2>
        <p className="mt-2 text-slate-700">{t('my.none')}</p>
        {next && (
          <p className="mt-2 text-slate-700">
            {t('my.next', { name: next.name, from: formatDate(next.startsOn, lang) })}
          </p>
        )}
        <p className="mt-2 text-sm text-slate-600">{t('my.askReception')}</p>
      </section>
    );
  }

  const big =
    current.remaining.visits !== null
      ? t('my.visits', { count: current.remaining.visits })
      : current.remaining.days !== null
        ? t('my.days', { count: current.remaining.days })
        : null;

  if (compact) {
    return (
      <section
        aria-labelledby="my-membership"
        className="rounded-xl border border-slate-200 bg-white p-4 text-center"
      >
        <h2
          id="my-membership"
          className="flex flex-wrap items-center justify-center gap-2 text-base font-semibold text-slate-900"
        >
          {current.name}
          <StatusBadge status={current.status} />
        </h2>
        {(big || current.effectiveEndsOn) && (
          <p className="mt-1 text-sm text-slate-700">
            {big && `${big} ${t('my.left')}`}
            {big && current.effectiveEndsOn && ' · '}
            {current.effectiveEndsOn &&
              t(current.status === 'frozen' ? 'my.newEnd' : 'my.ends', {
                date: formatDate(current.effectiveEndsOn, lang),
              })}
          </p>
        )}
      </section>
    );
  }

  return (
    <section
      aria-labelledby="my-membership"
      className="rounded-xl border border-slate-200 bg-white p-6 text-center"
    >
      <h2 id="my-membership" className="text-lg font-semibold text-slate-900">
        {current.name}
      </h2>
      <div className="mt-2">
        <StatusBadge status={current.status} />
      </div>
      {big && (
        <p className="mt-4 text-slate-900">
          <span className="block text-4xl font-bold break-words tabular-nums sm:text-5xl">
            {big}
          </span>
          <span className="block text-sm text-slate-600">{t('my.left')}</span>
        </p>
      )}
      {current.effectiveEndsOn && (
        <p className="mt-3 text-slate-700">
          {t(current.status === 'frozen' ? 'my.newEnd' : 'my.ends', {
            date: formatDate(current.effectiveEndsOn, lang),
          })}
        </p>
      )}
      {next && (
        <p className="mt-4 border-t border-slate-200 pt-4 text-slate-700">
          {t('my.next', { name: next.name, from: formatDate(next.startsOn, lang) })}
        </p>
      )}
    </section>
  );
}
