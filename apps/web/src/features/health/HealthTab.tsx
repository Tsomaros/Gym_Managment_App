import type { ConsentState, Measurement } from '@gym/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../api/client';
import { MeasurementForm } from './MeasurementForm';
import { MeasurementsList } from './MeasurementsList';
import { ProgressPhotos } from './ProgressPhotos';

/**
 * A client's body data for their trainer: the measurement form (primary trainer only), the
 * recorded measurements and the progress photos. Anything the member has not consented to is
 * said to be missing, never silently empty. A cover trainer only reads.
 */
export function HealthTab({
  gymId,
  memberId,
  canWrite,
}: {
  gymId: string;
  memberId: string;
  canWrite: boolean;
}) {
  const { t } = useTranslation();
  const base = `/gyms/${gymId}/members/${memberId}`;
  const [consents, setConsents] = useState<ConsentState | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, m] = await Promise.all([
        apiFetch<ConsentState>(`${base}/consents`),
        apiFetch<Measurement[]>(`${base}/measurements`),
      ]);
      setConsents(c);
      setMeasurements(m);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
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
      {consents && (
        <>
          {canWrite && (
            <MeasurementForm
              gymId={gymId}
              memberId={memberId}
              consentGranted={consents.measurements.granted}
              onSaved={() => void load()}
            />
          )}
          <MeasurementsList
            gymId={gymId}
            memberId={memberId}
            measurements={measurements}
            canDelete={canWrite}
            onChanged={() => void load()}
          />
          <ProgressPhotos
            gymId={gymId}
            memberId={memberId}
            canWrite={canWrite}
            consentGranted={consents.photos.granted}
          />
        </>
      )}
    </div>
  );
}
