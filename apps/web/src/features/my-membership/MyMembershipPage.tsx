import type { MyMemberships } from '@gym/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { apiFetch } from '../../api/client';
import { MyMembershipCard } from './MyMembershipCard';

/** Member home: loads the caller's memberships in this gym and shows the card. */
export function MyMembershipPage() {
  const { t } = useTranslation();
  const { gymId } = useParams();
  const [data, setData] = useState<MyMemberships | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    apiFetch<MyMemberships>(`/gyms/${gymId}/me/memberships`)
      .then(setData)
      .catch(() => setFailed(true));
  }, [gymId]);

  useEffect(load, [load]);

  if (failed) {
    return (
      <div role="alert" className="flex items-center gap-3 text-red-700">
        {t('common.genericError')}
        <button type="button" onClick={load} className="min-h-11 underline">
          {t('app.retry')}
        </button>
      </div>
    );
  }
  if (!data) return <p className="text-slate-600">{t('app.loading')}</p>;
  return (
    <div className="mx-auto max-w-md">
      <MyMembershipCard memberships={data.memberships} />
    </div>
  );
}
