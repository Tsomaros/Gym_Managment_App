import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../api/client';
import { Field, FormError, SubmitButton } from '../components/Field';
import { ShellLayout } from './ShellLayout';

function CreateGymForm() {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('Europe/Athens');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerFullName, setOwnerFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await apiFetch<{ gymId: string; mailSent: boolean }>('/platform/gyms', {
        method: 'POST',
        body: JSON.stringify({ name, timezone, ownerEmail, ownerFullName }),
      });
      setDone(
        res.mailSent
          ? t('platform.created', { email: ownerEmail.trim().toLowerCase() })
          : t('platform.createdNoMail'),
      );
      setName('');
      setOwnerEmail('');
      setOwnerFullName('');
    } catch {
      setError(t('auth.genericError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="create-gym"
      className="max-w-md rounded-xl border border-slate-200 bg-white p-6"
    >
      <h2 id="create-gym" className="mb-4 text-xl font-semibold text-slate-900">
        {t('platform.createGym')}
      </h2>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field
          label={t('platform.gymName')}
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Field
          label={t('platform.timezone')}
          required
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
        />
        <Field
          label={t('platform.ownerEmail')}
          type="email"
          required
          value={ownerEmail}
          onChange={(e) => setOwnerEmail(e.target.value)}
        />
        <Field
          label={t('platform.ownerFullName')}
          required
          maxLength={120}
          value={ownerFullName}
          onChange={(e) => setOwnerFullName(e.target.value)}
        />
        <FormError message={error} />
        <p role="status" className="text-sm text-green-800">
          {done}
        </p>
        <SubmitButton busy={busy}>{t('platform.create')}</SubmitButton>
      </form>
    </section>
  );
}

export function PlatformShell() {
  const { t } = useTranslation();
  return (
    <ShellLayout
      testId="shell-platform"
      title={t('shell.platform')}
      nav={['gyms']}
      home={<CreateGymForm />}
    />
  );
}
