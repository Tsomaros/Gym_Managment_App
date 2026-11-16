import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { ApiError, apiFetch } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { CenteredCard } from '../components/CenteredCard';

/** /verify-email/:token — the link from the confirmation email. Works signed in or not. */
export function VerifyEmailPage() {
  const { t } = useTranslation();
  const { token = '' } = useParams();
  const { me, status, refreshMe } = useAuth();
  const [state, setState] = useState<'working' | 'done' | 'gone' | 'error'>('working');
  const sent = useRef(false);
  const refreshed = useRef(false);

  useEffect(() => {
    if (sent.current) return; // single-use link: send it once, even under StrictMode
    sent.current = true;
    apiFetch<void>('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) })
      .then(() => setState('done'))
      .catch((err: unknown) =>
        setState(err instanceof ApiError && err.status === 410 ? 'gone' : 'error'),
      );
  }, [token]);

  // A signed-in member's profile may load after the link was confirmed (fresh tab): refresh it
  // then, so the "confirm your email" banner disappears.
  useEffect(() => {
    if (state !== 'done' || status !== 'ready' || !me || me.emailVerified || refreshed.current) {
      return;
    }
    refreshed.current = true;
    Promise.resolve(refreshMe()).catch(() => undefined);
  }, [state, status, me, refreshMe]);

  return (
    <CenteredCard title={t('verify.title')} testId="verify-page">
      <div aria-live="polite">
        {state === 'working' && <p className="text-slate-600">{t('app.loading')}</p>}
        {state === 'done' && (
          <p className="text-slate-800">
            <span aria-hidden="true">✓ </span>
            <span>{t('verify.done')}</span>
          </p>
        )}
        {state === 'gone' && <p className="text-slate-800">{t('verify.gone')}</p>}
        {state === 'error' && (
          <p role="alert" className="text-red-700">
            {t('common.genericError')}
          </p>
        )}
      </div>
      {state !== 'working' && (
        <Link
          to="/"
          className="mt-4 inline-flex min-h-11 items-center font-semibold text-slate-900 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {t('verify.continue')}
        </Link>
      )}
    </CenteredCard>
  );
}
