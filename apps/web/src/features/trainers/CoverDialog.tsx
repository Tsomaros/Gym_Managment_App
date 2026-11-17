import type { OnDutyPerson } from '@gym/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiFetch } from '../../api/client';
import { Dialog } from '../../components/Dialog';

/**
 * Reception: picks a cover trainer for one member for today. Only trainers on a shift right now
 * are offered (the API checks it again); the member's own primary trainer is left out.
 */
export function CoverDialog({
  gymId,
  memberId,
  memberName,
  primaryTrainerId,
  onClose,
  onDone,
  returnFocusTo,
}: {
  gymId: string;
  memberId: string;
  memberName: string;
  primaryTrainerId: string | null;
  onClose: () => void;
  onDone: (cover: { trainerId: string; firstName: string }) => void;
  returnFocusTo?: () => HTMLElement | null;
}) {
  const { t } = useTranslation();
  const [people, setPeople] = useState<OnDutyPerson[] | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'notOnDuty' | 'failed' | 'loadFailed'>(
    'idle',
  );

  const load = useCallback(() => {
    apiFetch<OnDutyPerson[]>(`/gyms/${gymId}/on-duty`)
      .then((list) => {
        setPeople(list);
        setState((s) => (s === 'loadFailed' ? 'idle' : s));
      })
      .catch(() => setState('loadFailed'));
  }, [gymId]);
  useEffect(load, [load]);

  const trainers = people?.filter(
    (p) => p.roles.includes('trainer') && p.userId !== primaryTrainerId,
  );

  async function pick(p: OnDutyPerson) {
    if (state === 'busy') return;
    setState('busy');
    try {
      await apiFetch(`/gyms/${gymId}/members/${memberId}/cover`, {
        method: 'PUT',
        body: JSON.stringify({ trainerId: p.userId }),
      });
      onDone({ trainerId: p.userId, firstName: p.firstName });
    } catch (err) {
      const offShift = err instanceof ApiError && err.status === 409;
      setState(offShift ? 'notOnDuty' : 'failed');
      if (offShift) load(); // the list was out of date: show who is on shift now
    }
  }

  return (
    <Dialog
      title={t('trainers.coverTitle', { name: memberName })}
      closeLabel={t('common.close')}
      onClose={onClose}
      returnFocusTo={returnFocusTo}
    >
      {!people && state !== 'loadFailed' && (
        <p role="status" className="text-slate-600">
          {t('app.loading')}
        </p>
      )}
      {trainers && trainers.length === 0 && (
        <p className="text-slate-700">{t('trainers.nobodyToCover')}</p>
      )}
      {trainers && trainers.length > 0 && (
        <ul className="flex flex-col gap-2">
          {trainers.map((p) => (
            <li key={p.userId}>
              <button
                type="button"
                onClick={() => void pick(p)}
                aria-disabled={state === 'busy' || undefined}
                className="flex min-h-11 w-full items-center gap-3 rounded-md border border-slate-300 px-4 text-left font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 aria-disabled:opacity-60"
              >
                <span className="mr-auto">
                  {p.firstName} {p.lastName}
                </span>
                <span className="text-sm text-slate-700">
                  {t('schedule.until', { time: p.until })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {state === 'busy' && (
        <p role="status" className="mt-3 text-slate-600">
          {t('common.working')}
        </p>
      )}
      {state === 'notOnDuty' && (
        <p role="alert" className="mt-3 text-red-700">
          {t('trainers.notOnDuty')}
        </p>
      )}
      {(state === 'failed' || state === 'loadFailed') && (
        <div role="alert" className="mt-3 flex items-center gap-3 text-red-700">
          {t('common.genericError')}
          {state === 'loadFailed' && (
            <button type="button" onClick={load} className="min-h-11 underline">
              {t('app.retry')}
            </button>
          )}
        </div>
      )}
    </Dialog>
  );
}
