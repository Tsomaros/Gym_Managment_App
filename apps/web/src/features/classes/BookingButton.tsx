import type { ClassSessionView } from '@gym/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiFetch } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { dangerClass, plainClass, primaryClass, typeName } from './shared';

/** What the server said about a failed booking, as a state of the button. */
type Refused = 'full' | 'needsMembership' | 'failed' | 'started' | 'notOpen' | null;

const messageOf = (err: unknown): string | undefined =>
  err instanceof ApiError ? (err.body as { message?: string } | null)?.message : undefined;

/**
 * Member: the one button of a class card. Book; booked with a cancel (a late cancel of a class-pack
 * booking warns that an entry is charged); full; or no membership with classes (disabled, with a hint).
 */
export function BookingButton({
  gymId,
  session,
  canBook,
  dayLabel,
  onChanged,
}: {
  gymId: string;
  session: ClassSessionView;
  /** The member has a membership that includes classes (or a class pack). */
  canBook: boolean;
  dayLabel: string;
  /** The booking changed: reload; the text is what a screen reader should hear. */
  onChanged: (announcement?: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<Refused>(null);
  const [confirming, setConfirming] = useState(false);
  const [cancelFailed, setCancelFailed] = useState(false);
  const mine = session.myBooking;
  const name = typeName(session.type, i18n.language);

  async function book() {
    if (busy) return;
    setBusy(true);
    setRefused(null);
    try {
      await apiFetch(`/gyms/${gymId}/class-sessions/${session.id}/bookings`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      onChanged(t('classes.member.bookedAnnounce', { name, day: dayLabel, time: session.startsAt }));
    } catch (err) {
      const message = messageOf(err);
      if (message === 'Class full') {
        setRefused('full');
        onChanged(t('classes.member.justFull'));
      }
      else if (message === 'No membership for classes') setRefused('needsMembership');
      else if (message === 'Already booked') onChanged();
      else if (message === 'The class has started') setRefused('started');
      else if (message?.startsWith('Booking opens')) setRefused('notOpen');
      else setRefused('failed');
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!mine) return;
    setBusy(true);
    setCancelFailed(false);
    try {
      await apiFetch(`/gyms/${gymId}/me/bookings/${mine.id}`, { method: 'DELETE' });
      setConfirming(false);
      onChanged(t('classes.member.cancelledAnnounce', { name, day: dayLabel, time: session.startsAt }));
    } catch {
      setCancelFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const note = (text: string) => <p className="text-sm text-slate-700">{text}</p>;

  if (session.cancelled) return note(t('classes.member.classCancelled'));
  if (mine?.status === 'attended') {
    return <p className="font-semibold text-green-900">✓ {t('classes.status.attended')}</p>;
  }

  if (mine) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-semibold text-green-900">{t('classes.member.booked')}</span>
        <button type="button" onClick={() => setConfirming(true)} className={dangerClass}>
          {t('classes.member.cancel')}
          <span className="sr-only">
            {' '}
            {name} {session.startsAt}
          </span>
        </button>
        {confirming && (
          <ConfirmDialog
            title={t('classes.member.cancelTitle')}
            message={t('classes.member.cancelMessage', {
              name,
              day: dayLabel,
              time: session.startsAt,
            })}
            warning={mine.late && mine.usesEntry ? t('classes.member.lateWarning') : undefined}
            confirmLabel={t('classes.member.confirmCancel')}
            cancelLabel={t('classes.member.keep')}
            busy={busy}
            busyLabel={t('common.working')}
            error={cancelFailed ? t('common.genericError') : undefined}
            onConfirm={() => void cancel()}
            onCancel={() => setConfirming(false)}
          />
        )}
      </div>
    );
  }

  if (refused === 'full' || session.booked >= session.capacity) {
    return (
      <button
        type="button"
        aria-disabled="true"
        className={`${plainClass} cursor-not-allowed bg-slate-50 py-2 text-slate-700`}
      >
        {t('classes.member.full')}
        <span className="sr-only">
          {' '}
          {name} {session.startsAt}
        </span>
      </button>
    );
  }
  if (!canBook || refused === 'needsMembership') {
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          aria-disabled="true"
          aria-describedby={`hint-${session.id}`}
          className={`${plainClass} cursor-not-allowed bg-slate-50 py-2 text-left text-slate-700`}
        >
          {t('classes.member.needsMembership')}
        </button>
        <p id={`hint-${session.id}`} className="text-sm text-slate-700">
          {t('classes.member.askReception')}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        aria-disabled={busy || undefined}
        onClick={() => void book()}
        className={primaryClass}
      >
        {t('classes.member.book')}
        <span className="sr-only">
          {' '}
          {name} {session.startsAt}
        </span>
      </button>
      {refused === 'failed' && (
        <p role="alert" className="text-sm text-red-700">
          {t('classes.member.bookFailed')}
        </p>
      )}
      {refused === 'started' && (
        <p role="alert" className="text-sm text-red-700">
          {t('classes.member.started')}
        </p>
      )}
      {refused === 'notOpen' && (
        <p role="alert" className="text-sm text-red-700">
          {t('classes.member.notOpen')}
        </p>
      )}
    </div>
  );
}
