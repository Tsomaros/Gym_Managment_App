import type { PairDeviceResponse } from '@gym/shared';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, kioskFetch } from '../../api/client';

/** First screen of a new tablet: the owner's pairing code (XXXX-XXXX), typed with big keys. */
export function KioskPairing({ onPaired }: { onPaired: (deviceToken: string) => void }) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const paired = await kioskFetch<PairDeviceResponse>('/kiosk/pair', null, {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      onPaired(paired.deviceToken);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 410
          ? t('kiosk.pairInvalid')
          : err instanceof ApiError && err.status === 429
            ? t('kiosk.pairBusy')
            : t('kiosk.pairError'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 p-6">
      <h1 className="text-3xl font-bold text-slate-900">{t('kiosk.pairTitle')}</h1>
      <p className="text-lg text-slate-700">{t('kiosk.pairHint')}</p>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
        <label htmlFor="pair-code" className="text-lg font-medium text-slate-800">
          {t('kiosk.codeLabel')}
        </label>
        <input
          id="pair-code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={9}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'pair-error' : undefined}
          className="min-h-16 rounded-lg border-2 border-slate-500 px-4 text-center font-mono text-4xl tracking-widest text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        />
        {error && (
          <p id="pair-error" role="alert" className="text-lg font-medium text-red-700">
            {error}
          </p>
        )}
        <button
          type="submit"
          aria-disabled={busy || undefined}
          className="min-h-16 rounded-lg bg-slate-900 px-6 text-2xl font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 aria-disabled:opacity-60"
        >
          {busy ? t('kiosk.pairing') : t('kiosk.pairButton')}
        </button>
      </form>
    </main>
  );
}
