import type { Measurement } from '@gym/shared';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { viewerLanguage } from '../exercises/exerciseName';
import { num, shortDate } from '../progress/chartTheme';

/** The recorded measurements, newest first; the primary trainer can delete one. */
export function MeasurementsList({
  gymId,
  memberId,
  measurements,
  canDelete,
  consentGranted = true,
  onChanged,
}: {
  gymId: string;
  memberId?: string;
  measurements: Measurement[];
  canDelete: boolean;
  /** Without consent nothing can be recorded: say so instead of showing an empty list. */
  consentGranted?: boolean;
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = viewerLanguage(i18n.language);
  const [deleting, setDeleting] = useState<Measurement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const parts = (m: Measurement): string[] =>
    [
      m.weightKg !== null && `${num(m.weightKg, lang, 2)} kg`,
      m.bodyFatPct !== null && `${num(m.bodyFatPct, lang)} %`,
      m.waistCm !== null && `${t('health.measure.waist')} ${num(m.waistCm, lang)} cm`,
      m.hipsCm !== null && `${t('health.measure.hips')} ${num(m.hipsCm, lang)} cm`,
      m.chestCm !== null && `${t('health.measure.chest')} ${num(m.chestCm, lang)} cm`,
      m.armCm !== null && `${t('health.measure.arm')} ${num(m.armCm, lang)} cm`,
      m.thighCm !== null && `${t('health.measure.thigh')} ${num(m.thighCm, lang)} cm`,
    ].filter((x): x is string => typeof x === 'string');

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/gyms/${gymId}/members/${memberId}/measurements/${deleting.id}`, {
        method: 'DELETE',
      });
      setDeleting(null);
      // the delete button that opened the dialog is gone: keep focus on the section
      requestAnimationFrame(() => titleRef.current?.focus());
      onChanged();
    } catch {
      setError(t('common.genericError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="measure-list-title"
      className="flex flex-col gap-2 rounded-2xl border border-slate-300 bg-white p-4"
    >
      <h3
        id="measure-list-title"
        ref={titleRef}
        tabIndex={-1}
        className="text-lg font-semibold text-slate-900 focus:outline-none"
      >
        {t('health.measure.listTitle')}
      </h3>
      {!consentGranted && measurements.length === 0 ? (
        <p className="text-slate-700">{t('health.measure.noConsentView')}</p>
      ) : measurements.length === 0 ? (
        <p className="text-slate-700">{t('health.measure.none')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {measurements.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-2 first:border-t-0 first:pt-0"
            >
              <span className="min-w-0 break-words text-slate-900">
                <span className="font-semibold">{shortDate(m.measuredOn, lang)} · </span>
                <span className="tabular-nums">{parts(m).join(' · ')}</span>
                {m.notes && <span className="block text-sm text-slate-700">{m.notes}</span>}
              </span>
              {canDelete && (
                <button
                  type="button"
                  aria-label={t('health.measure.deleteNamed', {
                    date: shortDate(m.measuredOn, lang),
                  })}
                  onClick={() => {
                    setError(null);
                    setDeleting(m);
                  }}
                  className="ml-auto min-h-11 rounded-md px-3 text-sm font-medium text-red-800 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-slate-900"
                >
                  {t('health.measure.delete')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {deleting && (
        <ConfirmDialog
          title={t('health.measure.deleteTitle')}
          message={t('health.measure.deleteMessage', {
            date: shortDate(deleting.measuredOn, lang),
          })}
          confirmLabel={t('health.measure.delete')}
          cancelLabel={t('common.cancel')}
          busy={busy}
          busyLabel={t('common.working')}
          error={error}
          onConfirm={() => void remove()}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  );
}
