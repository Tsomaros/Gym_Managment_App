import { InviteSchema, type StaffRole } from '@gym/shared';
import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../api/client';
import { Dialog } from '../../components/Dialog';
import { Field } from '../../components/Field';

const ROLES: readonly StaffRole[] = ['owner', 'reception', 'trainer'];

/** Owner: invites a person by email with one or more staff roles (the existing invitation API). */
export function InviteStaffDialog({
  gymId,
  onClose,
  onInvited,
}: {
  gymId: string;
  onClose: () => void;
  /** `mailSent` false means the invitation is stored but the email did not go out. */
  onInvited: (result: { mailSent: boolean }) => void;
}) {
  const { t } = useTranslation();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState<StaffRole[]>([]);
  const [errors, setErrors] = useState<Partial<Record<'firstName' | 'lastName' | 'email', string>>>(
    {},
  );
  const firstRef = useRef<HTMLInputElement>(null);
  const lastRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  function toggle(role: StaffRole) {
    setRolesError(null);
    setRoles((current) =>
      current.includes(role) ? current.filter((r) => r !== role) : [...current, role],
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setFailed(false);
    const parsed = InviteSchema.safeParse({
      email,
      firstName,
      lastName,
      roles: ROLES.filter((r) => roles.includes(r)),
    });
    const bad = parsed.success
      ? new Set<PropertyKey>()
      : new Set(parsed.error.issues.map((i) => i.path[0]));
    const next = {
      firstName: bad.has('firstName') ? t('common.required') : undefined,
      lastName: bad.has('lastName') ? t('common.required') : undefined,
      email: bad.has('email') ? t('staff.emailInvalid') : undefined,
    };
    setErrors(next);
    setRolesError(roles.length === 0 ? t('staff.rolesRequired') : null);
    if (next.firstName) return firstRef.current?.focus();
    if (next.lastName) return lastRef.current?.focus();
    if (next.email) return emailRef.current?.focus();
    if (!parsed.success || roles.length === 0) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ mailSent: boolean }>(`/gyms/${gymId}/invitations`, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      onInvited({ mailSent: res.mailSent });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={t('staff.invite')} closeLabel={t('common.close')} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
        <Field
          label={t('staff.firstName')}
          ref={firstRef}
          error={errors.firstName}
          value={firstName}
          maxLength={60}
          autoComplete="off"
          onChange={(e) => setFirstName(e.target.value)}
        />
        <Field
          label={t('staff.lastName')}
          ref={lastRef}
          error={errors.lastName}
          value={lastName}
          maxLength={60}
          autoComplete="off"
          onChange={(e) => setLastName(e.target.value)}
        />
        <Field
          label={t('staff.email')}
          type="email"
          value={email}
          autoComplete="off"
          ref={emailRef}
          error={errors.email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <fieldset aria-describedby={rolesError ? 'staff-roles-error' : undefined}>
          <legend className="mb-1 text-sm font-medium text-slate-700">{t('staff.roles')}</legend>
          <div className="flex flex-col">
            {ROLES.map((role) => (
              <label key={role} className="flex min-h-11 items-center gap-3 text-slate-900">
                <input
                  type="checkbox"
                  checked={roles.includes(role)}
                  onChange={() => toggle(role)}
                  className="size-5"
                />
                {t(`roles.${role}`)}
              </label>
            ))}
          </div>
          {rolesError && (
            <p id="staff-roles-error" role="alert" className="text-sm text-red-700">
              {rolesError}
            </p>
          )}
        </fieldset>
        {failed && (
          <p role="alert" className="text-red-700">
            {t('common.genericError')}
          </p>
        )}
        <div className="flex justify-end">
          <button
            type="submit"
            aria-disabled={busy || undefined}
            className="min-h-11 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 aria-disabled:opacity-60"
          >
            {busy ? t('common.working') : t('staff.send')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
