import { type ExpandedShift, type ScheduleStaff } from '@gym/shared';
import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../api/client';
import { Dialog } from '../../components/Dialog';
import { addDays, isoWeekday } from './dates';

export type ShiftTarget =
  { kind: 'new'; staffId: string | null; date: string } | { kind: 'edit'; shift: ExpandedShift };

type Confirming = 'day' | 'from' | 'delete';

const input =
  'min-h-11 rounded-md border border-slate-500 px-3 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';
const primary =
  'min-h-11 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 aria-disabled:opacity-60';
const danger =
  'min-h-11 rounded-md border border-red-700 px-4 text-sm font-medium text-red-800 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800 aria-disabled:opacity-60';
const plain =
  'min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';

/**
 * Owner (or reception when allowed): adds a shift on a day, or changes one. A weekly shift can be
 * changed for that day only (an override) or from that day on (the old series ends the day before
 * and a new one starts, so earlier days never change). Destructive actions ask once more.
 */
export function ShiftDialog({
  gymId,
  staff,
  target,
  onClose,
  onSaved,
  onChanged,
  returnFocusTo,
}: {
  gymId: string;
  staff: ScheduleStaff[];
  target: ShiftTarget;
  onClose: () => void;
  onSaved: () => void;
  /** The schedule changed although the action as a whole failed: reload it, stay open. */
  onChanged?: () => void;
  /** Where focus goes when the dialog closes (the opener may be gone after a reload). */
  returnFocusTo?: () => HTMLElement | null;
}) {
  const { t, i18n } = useTranslation();
  const editing = target.kind === 'edit' ? target.shift : null;
  const date = editing ? editing.date : (target as { date: string }).date;
  const [staffId, setStaffId] = useState(
    editing ? editing.staffId : ((target as { staffId: string | null }).staffId ?? ''),
  );
  const [startsAt, setStartsAt] = useState(editing?.startsAt ?? '06:00');
  const [endsAt, setEndsAt] = useState(editing?.endsAt ?? '14:00');
  const [weekly, setWeekly] = useState(false);
  const [scope, setScope] = useState<'day' | 'from'>('day');
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [error, setError] = useState<{ field: 'person' | 'time'; text: string } | null>(null);
  const [failure, setFailure] = useState<'none' | 'failed' | 'partial'>('none');
  const [busy, setBusy] = useState(false);
  const personRef = useRef<HTMLSelectElement>(null);
  const toRef = useRef<HTMLInputElement>(null);

  const isSeries = !!editing && editing.seriesId !== null;
  const person = staff.find((s) => s.userId === staffId);
  const tag = i18n.language === 'en' ? 'en-GB' : 'el-GR';
  const at = new Date(`${date}T00:00:00Z`);
  const dayLabel = new Intl.DateTimeFormat(tag, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(at);
  const weekdayName = new Intl.DateTimeFormat(tag, { weekday: 'long', timeZone: 'UTC' }).format(at);

  /** Runs the requests of one action; on failure shows the error and stays open. */
  async function run(requests: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setFailure('none');
    setConfirming(null);
    try {
      await requests();
      onSaved();
    } catch (err) {
      setFailure(err instanceof PartialError ? 'partial' : 'failed');
      if (err instanceof PartialError) onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  const post = (path: string, body: unknown) =>
    apiFetch(`/gyms/${gymId}${path}`, { method: 'POST', body: JSON.stringify(body) });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!staffId) {
      setError({ field: 'person', text: t('schedule.choosePerson') });
      return personRef.current?.focus();
    }
    if (endsAt <= startsAt) {
      setError({ field: 'time', text: t('schedule.endAfterStart') });
      return toRef.current?.focus();
    }
    setError(null);
    const times = { startsAt, endsAt };

    if (!editing) {
      return void run(() =>
        weekly
          ? post('/shift-series', { staffId, weekday: isoWeekday(date), ...times, validFrom: date })
          : post('/shifts', { staffId, date, ...times }),
      );
    }
    if (editing.seriesId === null) {
      return void run(() =>
        apiFetch(`/gyms/${gymId}/shifts/${editing.shiftId}`, {
          method: 'PATCH',
          body: JSON.stringify(times),
        }),
      );
    }
    const seriesId = editing.seriesId;
    if (scope === 'day') {
      return void run(() =>
        apiFetch(`/gyms/${gymId}/shift-series/${seriesId}/occurrences/${date}`, {
          method: 'PUT',
          body: JSON.stringify({ ...times, note: editing.note }),
        }),
      );
    }
    void run(async () => {
      await post(`/shift-series/${seriesId}/end`, { lastDate: addDays(date, -1) });
      const weekday = isoWeekday(date);
      try {
        await post('/shift-series', {
          staffId: editing.staffId,
          weekday,
          ...times,
          validFrom: date,
        });
      } catch {
        // The old series is already ended: put the old times back (open-ended), then tell the user.
        await post('/shift-series', {
          staffId: editing.staffId,
          weekday,
          startsAt: editing.startsAt,
          endsAt: editing.endsAt,
          validFrom: date,
        }).catch(() => undefined);
        throw new PartialError();
      }
    });
  }

  function confirmed() {
    if (!editing) return;
    const seriesId = editing.seriesId;
    if (confirming === 'day' && seriesId) {
      void run(() =>
        apiFetch(`/gyms/${gymId}/shift-series/${seriesId}/occurrences/${date}`, {
          method: 'PUT',
          body: JSON.stringify({ cancelled: true }),
        }),
      );
    } else if (confirming === 'from' && seriesId) {
      void run(() => post(`/shift-series/${seriesId}/end`, { lastDate: addDays(date, -1) }));
    } else if (confirming === 'delete' && !seriesId) {
      void run(() => apiFetch(`/gyms/${gymId}/shifts/${editing.shiftId}`, { method: 'DELETE' }));
    }
  }

  const confirmText: Record<Confirming, string> = {
    day: t('schedule.confirmCancelDay', { day: dayLabel }),
    from: t('schedule.confirmEndFrom', { day: dayLabel }),
    delete: t('schedule.confirmDelete', { day: dayLabel }),
  };

  return (
    <Dialog
      title={editing ? t('schedule.changeShift') : t('schedule.newShift')}
      closeLabel={t('common.close')}
      onClose={onClose}
      returnFocusTo={returnFocusTo}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-slate-700">
          {person ? `${person.firstName} ${person.lastName} · ` : ''}
          {dayLabel}
        </p>

        {!editing && !(target as { staffId: string | null }).staffId && (
          <div className="flex flex-col gap-1">
            <label htmlFor="shift-person" className="text-sm font-medium text-slate-700">
              {t('schedule.personLabel')}
            </label>
            <select
              id="shift-person"
              ref={personRef}
              value={staffId}
              onChange={(e) => {
                setStaffId(e.target.value);
                setError(null);
              }}
              aria-invalid={error?.field === 'person' || undefined}
              aria-describedby={error?.field === 'person' ? 'shift-error' : undefined}
              className={input}
            >
              <option value="">{t('schedule.choose')}</option>
              {staff.map((s) => (
                <option key={s.userId} value={s.userId}>
                  {s.firstName} {s.lastName}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex gap-3">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="shift-from" className="text-sm font-medium text-slate-700">
              {t('schedule.from')}
            </label>
            <input
              id="shift-from"
              type="time"
              step={300}
              value={startsAt}
              onChange={(e) => {
                setStartsAt(e.target.value);
                setError(null);
              }}
              className={input}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="shift-to" className="text-sm font-medium text-slate-700">
              {t('schedule.to')}
            </label>
            <input
              id="shift-to"
              ref={toRef}
              type="time"
              step={300}
              value={endsAt}
              onChange={(e) => {
                setEndsAt(e.target.value);
                setError(null);
              }}
              aria-invalid={error?.field === 'time' || undefined}
              aria-describedby={error?.field === 'time' ? 'shift-error' : undefined}
              className={input}
            />
          </div>
        </div>
        {error && (
          <p id="shift-error" role="alert" className="-mt-2 text-sm text-red-700">
            {error.text}
          </p>
        )}

        {!editing && (
          <label className="flex min-h-11 items-center gap-3 text-slate-900">
            <input
              type="checkbox"
              checked={weekly}
              onChange={(e) => setWeekly(e.target.checked)}
              className="size-5"
            />
            {t('schedule.everyWeek', { weekday: weekdayName })}
          </label>
        )}

        {isSeries && (
          <fieldset className="flex flex-col">
            <legend className="mb-1 text-sm font-medium text-slate-700">
              {t('schedule.scope')}
            </legend>
            {(['day', 'from'] as const).map((value) => (
              <label key={value} className="flex min-h-11 items-center gap-3 text-slate-900">
                <input
                  type="radio"
                  name="scope"
                  checked={scope === value}
                  onChange={() => {
                    setScope(value);
                    setConfirming(null);
                  }}
                  className="size-5"
                />
                {t(value === 'day' ? 'schedule.scopeDay' : 'schedule.scopeFrom', { day: dayLabel })}
              </label>
            ))}
          </fieldset>
        )}

        {failure === 'failed' && (
          <p role="alert" className="text-red-700">
            {t('common.genericError')}
          </p>
        )}
        {failure === 'partial' && (
          <p role="alert" className="text-red-700">
            {t('schedule.partialFailed')}
          </p>
        )}

        {confirming && (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-md border border-red-300 bg-red-50 p-3"
          >
            <p className="font-medium text-red-900">{confirmText[confirming]}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={confirmed}
                aria-disabled={busy || undefined}
                className={danger}
              >
                {t('schedule.confirmYes')}
              </button>
              <button type="button" onClick={() => setConfirming(null)} className={plain}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {isSeries && scope === 'day' && (
              <button type="button" onClick={() => setConfirming('day')} className={danger}>
                {t('schedule.cancelDay')}
              </button>
            )}
            {isSeries && scope === 'from' && (
              <button type="button" onClick={() => setConfirming('from')} className={danger}>
                {t('schedule.endFromHere')}
              </button>
            )}
            {editing && !isSeries && (
              <button type="button" onClick={() => setConfirming('delete')} className={danger}>
                {t('schedule.deleteShift')}
              </button>
            )}
          </div>
          <button type="submit" aria-disabled={busy || undefined} className={primary}>
            {busy ? t('common.working') : t('common.save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** The old weekly shift was ended but the new one could not be created. */
class PartialError extends Error {}
