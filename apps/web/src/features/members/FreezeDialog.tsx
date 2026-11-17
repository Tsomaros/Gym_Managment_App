import type { Freeze, Membership } from '@gym/shared';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiFetch } from '../../api/client';
import { Dialog } from '../../components/Dialog';
import { Field, FormError, SubmitButton } from '../../components/Field';

const daysInclusive = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

/** Reception pauses a time-based membership; the end moves forward by the frozen days. */
export function FreezeDialog({
  gymId,
  membership,
  freezes,
  onClose,
  onDone,
}: {
  gymId: string;
  membership: Membership;
  /** Freezes of this membership so far (they count against the type's maximum). */
  freezes: Freeze[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const used = freezes
    .filter((f) => f.membershipId === membership.id)
    .reduce((sum, f) => sum + daysInclusive(f.startsOn, f.endsOn), 0);
  const left = Math.max(0, membership.maxFreezeDays - used);
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [errors, setErrors] = useState<{ startsOn?: string; endsOn?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const next: typeof errors = {};
    if (!startsOn) next.startsOn = t('common.required');
    if (!endsOn) next.endsOn = t('common.required');
    else if (startsOn && endsOn < startsOn) next.endsOn = t('freeze.endBeforeStart');
    setErrors(next);
    if (next.startsOn || next.endsOn) return;
    setBusy(true);
    try {
      await apiFetch<Freeze>(`/gyms/${gymId}/memberships/${membership.id}/freezes`, {
        method: 'POST',
        body: JSON.stringify({ startsOn, endsOn }),
      });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { remainingFreezeDays?: number } | undefined;
        setError(
          body?.remainingFreezeDays !== undefined
            ? t('freeze.notEnough', { count: body.remainingFreezeDays })
            : t('freeze.conflict'),
        );
      } else if (err instanceof ApiError && err.status === 400) {
        setError(t('freeze.badDates'));
      } else {
        setError(t('common.genericError'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t('freeze.title', { name: membership.name })}
      closeLabel={t('common.close')}
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-slate-700">{t('freeze.left', { count: left })}</p>
        <Field
          label={t('freeze.from')}
          type="date"
          value={startsOn}
          error={errors.startsOn}
          onChange={(e) => setStartsOn(e.target.value)}
        />
        <Field
          label={t('freeze.to')}
          type="date"
          value={endsOn}
          error={errors.endsOn}
          onChange={(e) => setEndsOn(e.target.value)}
        />
        <FormError message={error} />
        <SubmitButton busy={busy}>{t('freeze.submit')}</SubmitButton>
      </form>
    </Dialog>
  );
}
