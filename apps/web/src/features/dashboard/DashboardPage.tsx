import type { Dashboard } from '@gym/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { apiFetch } from '../../api/client';
import { BusyHoursHeatmap } from './BusyHoursHeatmap';
import { IncomeChart } from './IncomeChart';
import { MembersFlowChart } from './MembersFlowChart';
import { TodayTiles } from './TodayTiles';

/** The owner's home: today's numbers, income, members and the busiest hours (spec §6.9). */
export function DashboardPage() {
  const { t } = useTranslation();
  const { gymId = '' } = useParams();
  const [data, setData] = useState<Dashboard | null>(null);
  const [failed, setFailed] = useState(false);

  const [attempt, setAttempt] = useState(0);

  // One request per gym and attempt; an answer that arrives after the gym changed is dropped.
  useEffect(() => {
    let current = true;
    setData(null);
    setFailed(false);
    apiFetch<Dashboard>(`/gyms/${gymId}/dashboard`)
      .then((d) => current && setData(d))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [gymId, attempt]);

  return (
    <section aria-labelledby="dashboard-title" className="flex flex-col gap-6">
      <h2 id="dashboard-title" className="text-xl font-semibold text-slate-900">
        {t('dashboard.title')}
      </h2>
      {failed && (
        <div role="alert" className="flex items-center gap-3 text-red-700">
          {t('common.genericError')}
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="min-h-11 underline"
          >
            {t('app.retry')}
          </button>
        </div>
      )}
      {!data && !failed && (
        <p role="status" className="text-slate-700">
          {t('dashboard.loading')}
        </p>
      )}
      {data && (
        <>
          <TodayTiles gymId={gymId} today={data.today} />
          <div className="grid gap-6 lg:grid-cols-2">
            <IncomeChart income={data.income} />
            <MembersFlowChart members={data.members} />
          </div>
          <BusyHoursHeatmap grid={data.busyHours} />
        </>
      )}
    </section>
  );
}
