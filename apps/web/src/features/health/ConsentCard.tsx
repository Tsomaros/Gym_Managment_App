import type { ConsentKind, ConsentState } from '@gym/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';

/**
 * What the member agrees to, in plain words: what is stored, who sees it (the member and their
 * trainer, never the owner or reception) and that it can be withdrawn at any time, which deletes
 * it. "I agree" gives consent; "Withdraw" asks first, naming how much will be deleted.
 */
export function ConsentCard({
  gymId,
  kind,
  state,
  itemCount,
  onChanged,
}: {
  gymId: string;
  kind: ConsentKind;
  state: ConsentState[ConsentKind];
  /** How many measurements or photos withdrawing would delete. */
  itemCount: number;
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const path = `/gyms/${gymId}/me/consents/${kind}`;

  async function grant() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(path, { method: 'POST' });
      onChanged();
    } catch {
      setError(t('common.genericError'));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(path, { method: 'DELETE' });
      setWithdrawing(false);
      onChanged();
    } catch {
      setError(t('common.genericError'));
    } finally {
      setBusy(false);
    }
  }

  const since = state.at
    ? new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-GB' : 'el-GR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(new Date(state.at))
    : null;

  return (
    <section
      aria-label={t(`health.consent.${kind}.title`)}
      className="flex flex-col gap-3 rounded-2xl border border-slate-300 bg-white p-4"
    >
      <h3 className="text-lg font-semibold text-slate-900">{t(`health.consent.${kind}.title`)}</h3>
      <p className="text-slate-800">{t(`health.consent.${kind}.what`)}</p>
      <p className="text-slate-800">{t('health.consent.who')}</p>
      <p className="text-slate-800">{t('health.consent.withdrawInfo')}</p>
      {state.granted ? (
        <>
          <p className="font-medium text-green-800">
            ✓ {t('health.consent.given', { date: since })}
          </p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setWithdrawing(true);
            }}
            className="min-h-11 self-start rounded-md border border-red-700 bg-white px-4 font-medium text-red-800 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800"
          >
            {t('health.consent.withdraw')}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => void grant()}
          aria-disabled={busy || undefined}
          className="min-h-11 self-start rounded-md bg-slate-900 px-5 font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 aria-disabled:opacity-60"
        >
          {busy ? t('common.working') : t('health.consent.agree')}
        </button>
      )}
      {error && !withdrawing && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {withdrawing && (
        <WithdrawConsentDialog
          kind={kind}
          count={itemCount}
          busy={busy}
          error={error}
          onConfirm={() => void withdraw()}
          onCancel={() => setWithdrawing(false)}
        />
      )}
    </section>
  );
}

/** The question before consent is withdrawn: it says how much goes, and that it cannot come back. */
export function WithdrawConsentDialog({
  kind,
  count,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  kind: ConsentKind;
  count: number;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      title={t(`health.withdraw.title.${kind}`)}
      message={t(`health.withdraw.message.${kind}`, { count })}
      warning={t('health.withdraw.warning')}
      confirmLabel={t('health.consent.withdraw')}
      cancelLabel={t('common.cancel')}
      busy={busy}
      busyLabel={t('common.working')}
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
