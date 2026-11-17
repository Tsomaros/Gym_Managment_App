import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../api/client';

/** Shown to a member until they confirm their email, with a way to get the email again. */
export function EmailNotVerifiedBanner({ email }: { email: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function resend() {
    if (state === 'sending') return; // a double tap sends one email
    setState('sending');
    try {
      await apiFetch<void>('/auth/resend-verification', { method: 'POST' });
      setState('sent');
    } catch {
      setState('error');
    }
  }

  return (
    <div className="border-b border-amber-300 bg-amber-50">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
        <p className="mr-auto text-sm text-amber-950">
          <span aria-hidden="true">✉ </span>
          {t('banner.notVerified', { email })}
        </p>
        <button
          type="button"
          onClick={() => void resend()}
          aria-disabled={state === 'sending' || undefined}
          className="min-h-11 rounded-md border border-amber-700 px-3 text-sm font-semibold text-amber-950 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-amber-900 aria-disabled:opacity-60"
        >
          {state === 'sending' ? t('banner.sending') : t('banner.resend')}
        </button>
        <p role="status" className="w-full text-sm text-amber-950 empty:hidden">
          {state === 'sent' ? `✓ ${t('banner.sent')}` : ''}
        </p>
        {state === 'error' && (
          <p role="alert" className="w-full text-sm text-red-700">
            {t('common.genericError')}
          </p>
        )}
      </div>
    </div>
  );
}
