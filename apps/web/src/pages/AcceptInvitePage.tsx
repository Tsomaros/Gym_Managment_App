import { type AcceptInviteResponse, type InvitePreview, PASSWORD_MIN_LENGTH } from '@gym/shared';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError, apiFetch } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { CenteredCard } from '../components/CenteredCard';
import { Field, FormError, SubmitButton } from '../components/Field';

type State =
  | { kind: 'loading' }
  | { kind: 'gone' }
  | { kind: 'error' }
  | { kind: 'ready'; invite: InvitePreview };

const isGone = (err: unknown) =>
  err instanceof ApiError && (err.status === 410 || err.status === 404);

/**
 * /invite/:token. A new person chooses a password and is signed in. Someone who already has an
 * account signs in with their own password first; only then is the invitation used, so a typo
 * never burns the link.
 */
export function AcceptInvitePage() {
  const { t } = useTranslation();
  const { token = '' } = useParams();
  const { login, startSession, refreshMe } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setState({ kind: 'loading' });
    apiFetch<InvitePreview>(`/auth/invitations/${encodeURIComponent(token)}`)
      .then((invite) => setState({ kind: 'ready', invite }))
      .catch((err: unknown) => setState({ kind: isGone(err) ? 'gone' : 'error' }));
  }, [token]);

  useEffect(load, [load]);

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
      <CenteredCard title={t('invite.expiredTitle')} testId="invite-page">
        <p className="text-slate-700">{t('invite.expired')}</p>
        <Link
          to="/login"
          className="mt-4 inline-flex min-h-11 items-center font-semibold text-slate-900 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {t('invite.toSignIn')}
        </Link>
      </CenteredCard>
    );
  }
  if (state.kind === 'error') {
    return (
      <CenteredCard title={t('app.name')} testId="invite-page">
        <p role="alert" className="text-slate-700">
          {t('invite.loadFailed')}
        </p>
        <button
          type="button"
          onClick={load}
          className="mt-4 min-h-11 rounded-md border border-slate-500 px-4 font-semibold text-slate-900 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {t('app.retry')}
        </button>
      </CenteredCard>
    );
  }

  const { invite } = state;

  async function accept(): Promise<AcceptInviteResponse> {
    return apiFetch<AcceptInviteResponse>('/auth/accept-invite', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldError(null);
    if (invite.accountExists ? !password : password.length < PASSWORD_MIN_LENGTH) {
      setFieldError(t(invite.accountExists ? 'auth.required' : 'invite.passwordTooShort'));
      return;
    }
    setBusy(true);
    try {
      if (invite.accountExists) {
        await login(invite.email, password); // verifies the password; the invitation is untouched
        await accept();
        await refreshMe(); // show the gym just joined
      } else {
        const res = await accept();
        if ('accessToken' in res) await startSession(res.accessToken);
      }
      navigate('/', { replace: true });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : (err as { status?: number }).status;
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
          hint={invite.accountExists ? undefined : t('invite.passwordHint')}
          error={fieldError}
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
