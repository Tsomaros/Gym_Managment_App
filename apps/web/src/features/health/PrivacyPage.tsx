import type { ConsentState, Measurement, ProgressPhoto } from '@gym/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { apiFetch } from '../../api/client';
import { ConsentCard } from './ConsentCard';

/**
 * The member's privacy settings: what health data may be stored (body measurements, progress
 * photos), each with its explanation, "I agree" and "Withdraw". Withdrawing names how much is
 * deleted, so the counts are read first.
 */
export function PrivacyPage() {
  const { t } = useTranslation();
  const { gymId = '' } = useParams();
  const base = `/gyms/${gymId}/me`;
  const [consents, setConsents] = useState<ConsentState | null>(null);
  const [counts, setCounts] = useState({ measurements: 0, photos: 0 });
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const c = await apiFetch<ConsentState>(`${base}/consents`);
      // Only what exists to be deleted needs counting.
      const [m, p] = await Promise.all([
        c.measurements.granted ? apiFetch<Measurement[]>(`${base}/measurements`) : [],
        c.photos.granted ? apiFetch<ProgressPhoto[]>(`${base}/progress-photos`) : [],
      ]);
      setConsents(c);
      setCounts({ measurements: m.length, photos: p.length });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-labelledby="privacy-title" className="mx-auto flex max-w-xl flex-col gap-4">
      <h2 id="privacy-title" className="text-xl font-semibold text-slate-900">
        {t('health.privacyTitle')}
      </h2>
      <p className="text-slate-800">{t('health.privacyIntro')}</p>
      {failed && (
        <div role="alert" className="flex items-center gap-3 text-red-700">
          {t('common.genericError')}
          <button type="button" onClick={() => void load()} className="min-h-11 underline">
            {t('app.retry')}
          </button>
        </div>
      )}
      {!consents && !failed && (
        <p role="status" className="text-slate-700">
          {t('app.loading')}
        </p>
      )}
      {consents &&
        (['measurements', 'photos'] as const).map((kind) => (
          <ConsentCard
            key={kind}
            gymId={gymId}
            kind={kind}
            state={consents[kind]}
            itemCount={counts[kind]}
            onChanged={() => void load()}
          />
        ))}
    </section>
  );
}
