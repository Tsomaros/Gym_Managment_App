import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { CenteredCard } from '../components/CenteredCard';
import { Field, FormError, SubmitButton } from '../components/Field';

export function LoginPage() {
  const { t } = useTranslation();
  const { me, status, login } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [missing, setMissing] = useState<{ email?: boolean; password?: boolean }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  if (status === 'loading') {
    return (
      <CenteredCard title={t('auth.signIn')} testId="login-page">
        <p role="status" className="text-slate-500">
          {t('app.loading')}
        </p>
      </CenteredCard>
    );
  }
  if (me) return <Navigate to={from} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const empty = { email: !email.trim(), password: !password };
    setMissing(empty);
    if (empty.email || empty.password) {
      (empty.email ? emailRef : passwordRef).current?.focus();
      return;
    }
    setBusy(true);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setError(
        t(status === 401 || status === 400 ? 'auth.invalidCredentials' : 'auth.genericError'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <CenteredCard title={t('auth.signIn')} testId="login-page">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field
          ref={emailRef}
          label={t('auth.email')}
          type="email"
          inputMode="email"
          autoCapitalize="none"
          autoComplete="username"
          required
          error={missing.email ? t('auth.required') : null}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          ref={passwordRef}
          label={t('auth.password')}
          type="password"
          autoComplete="current-password"
          required
          error={missing.password ? t('auth.required') : null}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <FormError message={error} />
        <SubmitButton busy={busy}>{t('auth.signIn')}</SubmitButton>
      </form>
    </CenteredCard>
  );
}
