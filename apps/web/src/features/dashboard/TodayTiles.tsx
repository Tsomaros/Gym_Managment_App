import type { Dashboard } from '@gym/shared';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

/** The three numbers of today. Each tile leads to where the owner can act on it. */
export function TodayTiles({ gymId, today }: { gymId: string; today: Dashboard['today'] }) {
  const { t } = useTranslation();
  const tiles = [
    { key: 'visitors', value: today.visitors, to: 'checkIn' },
    { key: 'present', value: today.present, to: 'checkIn' },
    { key: 'expiring', value: today.expiringSoon, to: 'renewals' },
  ] as const;
  return (
    <section aria-labelledby="today-title" className="flex flex-col gap-3">
      <h3 id="today-title" className="text-lg font-semibold text-slate-900">
        {t('dashboard.todayTitle')}
      </h3>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {tiles.map(({ key, value, to }) => (
          <li key={key}>
            <Link
              to={`/g/${gymId}/${to}`}
              className="flex min-h-11 flex-col gap-1 rounded-2xl border border-slate-300 bg-white p-4 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              <span className="text-3xl font-bold tabular-nums text-slate-900">{value}</span>
              <span className="text-sm text-slate-800">{t(`dashboard.${key}`)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
