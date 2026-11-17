import type { MemberTrainer, OnDutyPerson, StaffList, StaffMember } from '@gym/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiFetch } from '../../api/client';
import { Dialog } from '../../components/Dialog';

const primary =
  'min-h-11 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 aria-disabled:opacity-60';
const secondary =
  'min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';

/**
 * Reception: sets (or changes, or removes) a member's primary trainer. The gym's trainers are
 * listed with who is on a shift right now. The API refuses a member without a personal-training
 * membership; the dialog says so and offers to sell one.
 */
export function AssignTrainerDialog({
  gymId,
  memberId,
  memberName,
  current,
  onClose,
  onDone,
  onSell,
}: {
  gymId: string;
  memberId: string;
  memberName: string;
  current: MemberTrainer | null;
  onClose: () => void;
  onDone: () => void;
  /** Opens the sell dialog for this member. */
  onSell: () => void;
}) {
  const { t } = useTranslation();
  const [trainers, setTrainers] = useState<StaffMember[] | null>(null);
  const [onDuty, setOnDuty] = useState<Set<string>>(new Set());
  const [chosen, setChosen] = useState(current?.userId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'none' | 'noMembership' | 'failed' | 'loadFailed'>('none');

  useEffect(() => {
    Promise.all([
      apiFetch<StaffList>(`/gyms/${gymId}/staff`),
      apiFetch<OnDutyPerson[]>(`/gyms/${gymId}/on-duty`).catch(() => [] as OnDutyPerson[]),
    ])
      .then(([staff, duty]) => {
        setTrainers(staff.staff.filter((s) => s.roles.includes('trainer')));
        setOnDuty(new Set(duty.map((d) => d.userId)));
      })
      .catch(() => setError('loadFailed'));
  }, [gymId]);

  async function assign(e: FormEvent) {
    e.preventDefault();
    if (!chosen || busy) return;
    setBusy(true);
    setError('none');
    try {
      await apiFetch(`/gyms/${gymId}/members/${memberId}/trainer`, {
        method: 'PUT',
        body: JSON.stringify({ trainerId: chosen }),
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? 'noMembership' : 'failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError('none');
    try {
      await apiFetch(`/gyms/${gymId}/members/${memberId}/trainer`, { method: 'DELETE' });
      onDone();
    } catch {
      setError('failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t('trainers.assignTitle', { name: memberName })}
      closeLabel={t('common.close')}
      onClose={onClose}
    >
      <form onSubmit={(e) => void assign(e)} className="flex flex-col gap-4">
        {!trainers && error !== 'loadFailed' && (
          <p role="status" className="text-slate-600">
            {t('app.loading')}
          </p>
        )}
        {trainers && trainers.length === 0 && (
          <p className="text-slate-700">{t('trainers.noTrainers')}</p>
        )}
        {trainers && trainers.length > 0 && (
          <fieldset className="flex flex-col">
            <legend className="mb-1 text-sm font-medium text-slate-700">
              {t('trainers.pick')}
            </legend>
            {trainers.map((s) => (
              <label key={s.userId} className="flex min-h-11 items-center gap-3 text-slate-900">
                <input
                  type="radio"
                  name="trainer"
                  checked={chosen === s.userId}
                  onChange={() => setChosen(s.userId)}
                  className="size-5"
                />
                <span className="mr-auto">
                  {s.firstName} {s.lastName}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${
                    onDuty.has(s.userId)
                      ? 'bg-green-100 text-green-900'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  <span aria-hidden="true">{onDuty.has(s.userId) ? '● ' : '○ '}</span>
                  {onDuty.has(s.userId) ? t('trainers.onDuty') : t('trainers.offDuty')}
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {error === 'noMembership' && (
          <div role="alert" className="flex flex-col items-start gap-2 text-red-800">
            <p>{t('trainers.needsMembership')}</p>
            <button type="button" onClick={onSell} className={secondary}>
              {t('trainers.sell')}
            </button>
          </div>
        )}
        {(error === 'failed' || error === 'loadFailed') && (
          <p role="alert" className="text-red-700">
            {t('common.genericError')}
          </p>
        )}

        <div className="flex flex-wrap justify-between gap-2">
          {current ? (
            <button type="button" onClick={() => void remove()} className={secondary}>
              {t('trainers.removeTrainer')}
            </button>
          ) : (
            <span />
          )}
          <button type="submit" aria-disabled={busy || !chosen || undefined} className={primary}>
            {busy ? t('common.working') : t('trainers.assign')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
