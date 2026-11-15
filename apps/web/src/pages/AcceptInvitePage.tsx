import { type AcceptInviteResponse, type InvitePreview, PASSWORD_MIN_LENGTH } from '@gym/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { ApiError, apiFetch } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { CenteredCard } from '../components/CenteredCard';
import { Field, FormError, SubmitButton } from '../components/Field';

type State = { kind: 'loading' } | { kind: 'gone' } | { kind: 'ready'; invite: InvitePreview };

/**
 * /invite/:token. A new person chooses a password and is signed in. Someone who already has an
 * account signs in with their own password: the link alone never opens an existing account.
 */
export function AcceptInvitePage() {
  const { t } = useTranslation();
  const { token = '' } = useParams();
  const { login, startSession } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<InvitePreview>(`/auth/invitations/${encodeURIComponent(token)}`)
      .then((invite) => !cancelled && setState({ kind: 'ready', invite }))
      .catch(() => !cancelled && setState({ kind: 'gone' }));
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.kind === 'loading') {
    return (
      <CenteredCard title={t('app.name')} testId="invite-page">
        <p role="status" className="text-slate-500">
          {t('app.loading')}
        </p>
      </CenteredCard>
    );
  }
  if (state.kind === 'gone') {
    return (
      <CenteredCard title={t('app.name')} testId="invite-page">
        <p role="alert" className="text-slate-700">
          {t('invite.expired')}
        </p>
      </CenteredCard>
    );
  }

  const { invite } = state;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!invite.accountExists && password.length < PASSWORD_MIN_LENGTH) {
      setError(t('invite.passwordTooShort'));
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<AcceptInviteResponse>('/auth/accept-invite', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      if ('accessToken' in res) await startSession(res.accessToken);
      else await login(invite.email, password);
      navigate('/', { replace: true });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 410) setState({ kind: 'gone' });
      else setError(t(status === 401 ? 'auth.invalidCredentials' : 'auth.genericError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <CenteredCard title={t('invite.title', { gym: invite.gymName })} testId="invite-page">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <p className="text-slate-700">
          {invite.accountExists
            ? t('invite.existingAccount', { email: invite.email, gym: invite.gymName })
            : t('invite.greeting', { name: invite.fullName })}
        </p>
        <Field
          label={t('auth.email')}
          type="email"
          value={invite.email}
          readOnly
          autoComplete="username"
        />
        <Field
          label={invite.accountExists ? t('auth.password') : t('invite.choosePassword')}
          type="password"
          autoComplete={invite.accountExists ? 'current-password' : 'new-password'}
          required
          minLength={invite.accountExists ? undefined : PASSWORD_MIN_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <FormError message={error} />
        <SubmitButton busy={busy}>
          {invite.accountExists ? t('invite.joinAndSignIn') : t('invite.accept')}
        </SubmitButton>
      </form>
    </CenteredCard>
  );
}
