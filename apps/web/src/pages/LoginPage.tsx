import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { CenteredCard } from '../components/CenteredCard';
import { Field, FormError, SubmitButton } from '../components/Field';

export function LoginPage() {
  const { t } = useTranslation();
  const { me, login } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me) return <Navigate to={from} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
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
          label={t('auth.email')}
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label={t('auth.password')}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <FormError message={error} />
        <SubmitButton busy={busy}>{t('auth.signIn')}</SubmitButton>
      </form>
    </CenteredCard>
  );
}
