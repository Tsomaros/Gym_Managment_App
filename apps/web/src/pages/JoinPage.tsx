import { type SignupResponse, SignupSchema } from '@gym/shared';
import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { ApiError, apiFetch } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { CenteredCard } from '../components/CenteredCard';
import { Field, FormError, SubmitButton } from '../components/Field';

type FieldName =
  | 'code'
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'phone'
  | 'dateOfBirth'
  | 'password'
  | 'emergencyContactName'
  | 'emergencyContactPhone'
  | 'acceptPrivacy';

const ORDER: FieldName[] = [
  'code',
  'firstName',
  'lastName',
  'email',
  'phone',
  'dateOfBirth',
  'password',
  'emergencyContactName',
  'emergencyContactPhone',
  'acceptPrivacy',
];

/**
 * /join — a new member signs up on their phone with the code reception gave them (spec §6.0).
 * One column, in the order reception reads the details back; the emergency contact is optional
 * and folded away.
 */
export function JoinPage() {
  const { t } = useTranslation();
  const { startSession } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<Exclude<FieldName, 'acceptPrivacy'>, string>>({
    code: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    password: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
  });
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [existing, setExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const emergencyRef = useRef<HTMLDetailsElement>(null);

  const set = (name: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [name]: e.target.value }));

  function messageFor(field: FieldName, value: unknown): string {
    if (field === 'acceptPrivacy') return t('signup.privacyRequired');
    if (value === '' || value === undefined) return t('common.required');
    switch (field) {
      case 'email':
        return t('signup.emailInvalid');
      case 'phone':
      case 'emergencyContactPhone':
        return t('signup.phoneInvalid');
      case 'dateOfBirth':
        return t('signup.dobInvalid');
      case 'password':
        return t('invite.passwordTooShort');
      default:
        return t('common.required');
    }
  }

  function focusField(field: FieldName) {
    if (field.startsWith('emergency') && emergencyRef.current) emergencyRef.current.open = true;
    formRef.current?.querySelector<HTMLElement>(`[name="${field}"]`)?.focus();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const candidate = {
      ...values,
      emergencyContactName: values.emergencyContactName.trim() || undefined,
      emergencyContactPhone: values.emergencyContactPhone.trim() || undefined,
      acceptPrivacy,
    };
    const parsed = SignupSchema.safeParse(candidate);
    if (!parsed.success) {
      const next: Partial<Record<FieldName, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as FieldName;
        next[field] ??= messageFor(field, candidate[field]);
      }
      setErrors(next);
      const first = ORDER.find((f) => next[f]);
      if (first) focusField(first);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const res = await apiFetch<SignupResponse>('/auth/signup', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      if ('accessToken' in res) {
        await startSession(res.accessToken);
        navigate('/', { replace: true });
      } else {
        setExisting(true);
      }
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setFormError(
        t(
          status === 410
            ? 'signup.codeGone'
            : status === 409
              ? 'signup.alreadyMember'
              : status === 429
                ? 'signup.tooMany'
                : 'common.genericError',
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  if (existing) {
    return (
      <CenteredCard title={t('signup.title')} testId="join-page">
        <p className="text-slate-700">{t('signup.existingAccount')}</p>
        <Link
          to="/login"
          className="mt-4 inline-flex min-h-11 items-center font-semibold text-slate-900 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {t('signup.toSignIn')}
        </Link>
      </CenteredCard>
    );
  }

  return (
    <CenteredCard title={t('signup.title')} testId="join-page">
      <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <p className="text-slate-700">{t('signup.intro')}</p>
        <Field
          name="code"
          label={t('signup.code')}
          hint={t('signup.codeHint')}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={values.code}
          error={errors.code}
          onChange={set('code')}
        />
        <Field
          name="firstName"
          label={t('signup.firstName')}
          autoComplete="given-name"
          maxLength={60}
          value={values.firstName}
          error={errors.firstName}
          onChange={set('firstName')}
        />
        <Field
          name="lastName"
          label={t('signup.lastName')}
          autoComplete="family-name"
          maxLength={60}
          value={values.lastName}
          error={errors.lastName}
          onChange={set('lastName')}
        />
        <Field
          name="email"
          label={t('auth.email')}
          type="email"
          autoComplete="email"
          value={values.email}
          error={errors.email}
          onChange={set('email')}
        />
        <Field
          name="phone"
          label={t('signup.phone')}
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          value={values.phone}
          error={errors.phone}
          onChange={set('phone')}
        />
        <Field
          name="dateOfBirth"
          label={t('signup.dateOfBirth')}
          type="date"
          autoComplete="bday"
          value={values.dateOfBirth}
          error={errors.dateOfBirth}
          onChange={set('dateOfBirth')}
        />
        <Field
          name="password"
          label={t('invite.choosePassword')}
          hint={t('invite.passwordHint')}
          type="password"
          autoComplete="new-password"
          value={values.password}
          error={errors.password}
          onChange={set('password')}
        />
        <details ref={emergencyRef} className="rounded-md border border-slate-200 p-3">
          <summary className="min-h-11 cursor-pointer content-center font-medium text-slate-800">
            {t('signup.emergency')}
          </summary>
          <div className="mt-3 flex flex-col gap-4">
            <Field
              name="emergencyContactName"
              label={t('signup.emergencyName')}
              maxLength={60}
              value={values.emergencyContactName}
              error={errors.emergencyContactName}
              onChange={set('emergencyContactName')}
            />
            <Field
              name="emergencyContactPhone"
              label={t('signup.emergencyPhone')}
              type="tel"
              inputMode="tel"
              value={values.emergencyContactPhone}
              error={errors.emergencyContactPhone}
              onChange={set('emergencyContactPhone')}
            />
          </div>
        </details>
        <div className="flex flex-col gap-1">
          <label className="flex min-h-11 items-start gap-3 text-slate-800">
            <input
              name="acceptPrivacy"
              type="checkbox"
              className="mt-1 size-5 shrink-0"
              checked={acceptPrivacy}
              aria-invalid={errors.acceptPrivacy ? true : undefined}
              aria-describedby={errors.acceptPrivacy ? 'privacy-error' : undefined}
              onChange={(e) => setAcceptPrivacy(e.target.checked)}
            />
            <span>{t('signup.acceptPrivacy')}</span>
          </label>
          {errors.acceptPrivacy && (
            <p id="privacy-error" className="text-sm text-red-700">
              {errors.acceptPrivacy}
            </p>
          )}
        </div>
        <FormError message={formError} />
        <SubmitButton busy={busy}>{t('signup.submit')}</SubmitButton>
        <p className="text-sm text-slate-600">
          {t('signup.haveAccount')}{' '}
          <Link to="/login" className="font-semibold text-slate-900 underline">
            {t('auth.signIn')}
          </Link>
        </p>
      </form>
    </CenteredCard>
  );
}
