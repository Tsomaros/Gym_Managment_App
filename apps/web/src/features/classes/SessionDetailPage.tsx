import type { Attendee, BookingStatus, ClassSessionView, MemberSummary } from '@gym/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Avatar } from '../members/Avatar';
import { dangerClass, inputClass, plainClass, typeName } from './shared';

const chipClass: Record<BookingStatus, string> = {
  booked: 'bg-slate-100 text-slate-800',
  attended: 'bg-green-100 text-green-900',
  no_show: 'bg-red-100 text-red-900',
  cancelled: 'bg-slate-100 text-slate-600',
  late_cancelled: 'bg-slate-100 text-slate-600',
};

/**
 * One class: who is booked, ticking them present or absent (trainer of the class, reception,
 * owner), booking a member by name, and for the owner changing or cancelling the class.
 */
export function SessionDetailPage({
  gymId,
  session,
  canManage,
  canBook,
  onBack,
  onChanged,
  onChangeFromHere,
}: {
  gymId: string;
  session: ClassSessionView;
  /** Owner: may cancel the class and change its weekly series. */
  canManage: boolean;
  /** Reception and owner: may book a member. */
  canBook: boolean;
  onBack: () => void;
  /** The class itself changed (cancelled): the caller reloads its list. */
  onChanged: () => void;
  /** Owner, for a class of a weekly series: opens the "change from this day" dialog. */
  onChangeFromHere?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [attendees, setAttendees] = useState<Attendee[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState(false);
  const [reason, setReason] = useState('');
  const [text, setText] = useState('');
  const [found, setFound] = useState<MemberSummary[]>([]);
  const [bookError, setBookError] = useState<string | null>(null);
  const [booked, setBooked] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => titleRef.current?.focus(), []);

  const load = useCallback(() => {
    setFailed(false);
    apiFetch<Attendee[]>(`/gyms/${gymId}/class-sessions/${session.id}/attendees`)
      .then(setAttendees)
      .catch(() => setFailed(true));
  }, [gymId, session.id]);
  useEffect(load, [load]);

  useEffect(() => {
    const q = text.trim();
    if (!canBook || !q) {
      setFound([]);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      apiFetch<MemberSummary[]>(`/gyms/${gymId}/members?q=${encodeURIComponent(q)}`)
        .then((r) => current && setFound(r.slice(0, 6)))
        .catch(() => current && setFound([]));
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [text, gymId, canBook]);

  const tag = i18n.language === 'en' ? 'en-GB' : 'el-GR';
  const dayLabel = new Intl.DateTimeFormat(tag, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${session.date}T00:00:00Z`));
  const name = typeName(session.type, i18n.language);
  const toNotify = (attendees ?? []).filter((a) => a.status === 'booked').length;

  async function mark(a: Attendee, status: 'attended' | 'no_show') {
    setMarkError(null);
    try {
      await apiFetch(`/gyms/${gymId}/bookings/${a.bookingId}/attendance`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      setAttendees((list) =>
        list ? list.map((x) => (x.bookingId === a.bookingId ? { ...x, status } : x)) : list,
      );
    } catch {
      setMarkError(t('classes.detail.markFailed'));
    }
  }

  async function book(member: MemberSummary) {
    setBookError(null);
    setBooked(null);
    try {
      await apiFetch(`/gyms/${gymId}/class-sessions/${session.id}/bookings`, {
        method: 'POST',
        body: JSON.stringify({ memberId: member.userId }),
      });
      setText('');
      setFound([]);
      setBooked(`${member.firstName} ${member.lastName}`);
      searchRef.current?.focus();
      load();
    } catch (err) {
      const message = (err as { body?: { message?: string } }).body?.message;
      setBookError(
        message === 'Class full'
          ? t('classes.detail.bookFull')
          : message === 'No membership for classes'
            ? t('classes.detail.bookNoMembership')
            : message === 'Already booked'
              ? t('classes.detail.bookAlready')
              : t('classes.detail.bookFailed'),
      );
    }
  }

  async function cancelSession() {
    setCancelBusy(true);
    setCancelError(false);
    try {
      await apiFetch(`/gyms/${gymId}/class-sessions/${session.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify(reason.trim() ? { reason: reason.trim() } : {}),
      });
      setCancelling(false);
      onChanged();
    } catch {
      setCancelError(true);
    } finally {
      setCancelBusy(false);
    }
  }

  return (
    <section aria-labelledby="session-title" className="flex flex-col gap-5">
      <div>
        <button type="button" onClick={onBack} className={plainClass}>
          ← {t('classes.detail.back')}
        </button>
      </div>
      <div>
        <h2
          id="session-title"
          ref={titleRef}
          tabIndex={-1}
          className="text-xl font-semibold text-slate-900 focus:outline-none"
        >
          {name}
          {session.cancelled && (
            <span className="ml-2 text-base font-normal text-red-800">
              ({t('classes.cancelled')})
            </span>
          )}
        </h2>
        <p className="text-slate-700">
          {dayLabel} · {session.startsAt}–{session.endsAt}
          {session.room ? ` · ${session.room}` : ''}
        </p>
        <p className="text-slate-700">
          {session.trainer ? session.trainer.firstName : t('classes.noTrainer')} ·{' '}
          {t('classes.spots', { booked: session.booked, capacity: session.capacity })}
        </p>
      </div>

      {failed && (
        <div role="alert" className="flex items-center gap-3 text-red-700">
          {t('common.genericError')}
          <button type="button" onClick={load} className="min-h-11 underline">
            {t('app.retry')}
          </button>
        </div>
      )}
      {!attendees && !failed && (
        <p role="status" className="text-slate-600">
          {t('app.loading')}
        </p>
      )}
      {attendees && attendees.length === 0 && (
        <p className="text-slate-700">{t('classes.detail.noAttendees')}</p>
      )}
      {attendees && attendees.length > 0 && (
        <ul
          aria-label={t('classes.detail.attendees')}
          className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white"
        >
          {attendees.map((a) => (
            <li key={a.bookingId} className="flex flex-wrap items-center gap-3 p-3">
              <Avatar
                firstName={a.member.firstName}
                lastName={a.member.lastName}
                photoUrl={a.member.photoUrl}
              />
              <span className="mr-auto font-medium text-slate-900">
                {a.member.firstName} {a.member.lastName}
              </span>
              <span
                aria-live="polite"
                data-testid={`chip-${a.bookingId}`}
                className={`rounded-full px-3 py-1 text-sm font-medium ${chipClass[a.status]}`}
              >
                {t(`classes.status.${a.status}`)}
              </span>
              {!session.cancelled && (
                <>
                  <button
                    type="button"
                    onClick={() => a.status !== 'attended' && void mark(a, 'attended')}
                    aria-label={t('classes.detail.markAttendedFor', {
                      name: `${a.member.firstName} ${a.member.lastName}`,
                    })}
                    aria-disabled={a.status === 'attended' || undefined}
                    className={`${plainClass} aria-disabled:opacity-50`}
                  >
                    {t('classes.detail.markAttended')}
                  </button>
                  <button
                    type="button"
                    onClick={() => a.status !== 'no_show' && void mark(a, 'no_show')}
                    aria-label={t('classes.detail.markNoShowFor', {
                      name: `${a.member.firstName} ${a.member.lastName}`,
                    })}
                    aria-disabled={a.status === 'no_show' || undefined}
                    className={`${plainClass} aria-disabled:opacity-50`}
                  >
                    {t('classes.detail.markNoShow')}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <p role="alert" className="min-h-5 text-sm text-red-700">
        {markError}
      </p>

      {canBook && !session.cancelled && (
        <div className="flex flex-col gap-2">
          <label htmlFor="book-member" className="text-sm font-medium text-slate-700">
            {t('classes.detail.bookForMember')}
          </label>
          <input
            id="book-member"
            ref={searchRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('classes.detail.searchMember')}
            className={inputClass}
            autoComplete="off"
          />
          {found.length > 0 && (
            <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
              {found.map((m) => (
                <li key={m.userId}>
                  <button
                    type="button"
                    onClick={() => void book(m)}
                    className="min-h-11 w-full px-3 text-left text-slate-900 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-slate-900"
                  >
                    {m.firstName} {m.lastName}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p role="status" className="min-h-5 text-sm text-green-800">
            {booked && `✓ ${t('classes.detail.booked', { name: booked })}`}
          </p>
          <p role="alert" className="min-h-5 text-sm text-red-700">
            {bookError}
          </p>
        </div>
      )}

      {canManage && !session.cancelled && (
        <div className="flex flex-col gap-1">
          <label htmlFor="cancel-reason" className="text-sm font-medium text-slate-700">
            {t('classes.detail.reason')}
          </label>
          <input
            id="cancel-reason"
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
            className={inputClass}
          />
        </div>
      )}
      {canManage && !session.cancelled && (
        <div className="flex flex-wrap gap-3">
          {session.seriesId && onChangeFromHere && (
            <button type="button" onClick={onChangeFromHere} className={plainClass}>
              {t('classes.detail.changeFromHere')}
            </button>
          )}
          <button type="button" onClick={() => setCancelling(true)} className={dangerClass}>
            {t('classes.detail.cancelSession')}
          </button>
        </div>
      )}

      {cancelling && (
        <ConfirmDialog
          title={t('classes.detail.cancelTitle')}
          message={t('classes.detail.cancelMessage', { name, day: dayLabel, time: session.startsAt })}
          warning={
            toNotify > 0
              ? t('classes.detail.cancelWarning', { count: toNotify })
              : t('classes.detail.cancelNoBookings')
          }
          confirmLabel={t('classes.detail.cancelConfirm')}
          cancelLabel={t('common.cancel')}
          busy={cancelBusy}
          busyLabel={t('common.working')}
          error={cancelError ? t('common.genericError') : undefined}
          onConfirm={() => void cancelSession()}
          onCancel={() => setCancelling(false)}
        />
      )}
    </section>
  );
}
