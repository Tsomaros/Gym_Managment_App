import type { ClassSessionView, MyMemberships } from '@gym/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Route, Routes, useParams } from 'react-router';
import { apiFetch } from '../../api/client';
import { addDays, todayIn } from '../schedule/dates';
import { BookingButton } from './BookingButton';
import { MyBookingsPage } from './MyBookingsPage';
import { plainClass, typeName } from './shared';

const DAYS = 14;

/** Member: the classes of the next 14 days, one day at a time, with a booking button on each. */
function Timetable({ now = () => new Date() }: { now?: () => Date }) {
  const { t, i18n } = useTranslation();
  const { gymId = '' } = useParams();
  const today = todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone, now());
  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(today, i)), [today]);
  const [day, setDay] = useState(today);
  const [sessions, setSessions] = useState<ClassSessionView[] | null>(null);
  const [canBook, setCanBook] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    apiFetch<ClassSessionView[]>(
      `/gyms/${gymId}/class-sessions?from=${today}&to=${addDays(today, DAYS - 1)}`,
    )
      .then(setSessions)
      .catch(() => setFailed(true));
  }, [gymId, today]);
  useEffect(load, [load]);

  useEffect(() => {
    apiFetch<MyMemberships>(`/gyms/${gymId}/me/memberships`)
      .then((r) =>
        setCanBook(
          r.memberships.some(
            (m) => m.includesClasses && (m.status === 'active' || m.status === 'upcoming'),
          ),
        ),
      )
      .catch(() => setCanBook(true)); // the server has the last word on a booking
  }, [gymId]);

  const tag = i18n.language === 'en' ? 'en-GB' : 'el-GR';
  const label = (iso: string, long = false) =>
    new Intl.DateTimeFormat(tag, {
      weekday: long ? 'long' : 'short',
      day: 'numeric',
      month: long ? 'long' : 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${iso}T00:00:00Z`));

  const ofDay = (sessions ?? []).filter((s) => s.date === day);

  return (
    <section aria-labelledby="classes-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="classes-title" className="mr-auto text-xl font-semibold text-slate-900">
          {t('classes.member.title')}
        </h2>
        <Link to={`/g/${gymId}/classes/my`} className={`${plainClass} content-center`}>
          {t('classes.member.mine')}
        </Link>
      </div>

      <div role="group" aria-label={t('classes.member.days')} className="flex gap-2 overflow-x-auto pb-1">
        {days.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={d === day}
            onClick={() => setDay(d)}
            className={`min-h-11 shrink-0 rounded-md border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${
              d === day
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 text-slate-800 hover:bg-slate-50'
            }`}
          >
            {label(d)}
            {d === today && <span className="sr-only"> ({t('schedule.today')})</span>}
          </button>
        ))}
      </div>

      {!canBook && (
        <p className="rounded-md border border-slate-300 bg-slate-50 p-3 text-sm text-slate-800">
          {t('classes.member.noMembershipBanner')}
        </p>
      )}

      {failed && (
        <div role="alert" className="flex items-center gap-3 text-red-700">
          {t('common.genericError')}
          <button type="button" onClick={load} className={plainClass}>
            {t('app.retry')}
          </button>
        </div>
      )}
      {!sessions && !failed && (
        <p role="status" className="text-slate-600">
          {t('app.loading')}
        </p>
      )}
      {sessions && ofDay.length === 0 && (
        <p className="text-slate-700">{t('classes.member.emptyDay')}</p>
      )}
      {ofDay.length > 0 && (
        <ul className="flex flex-col gap-3">
          {ofDay.map((s) => {
            const left = s.capacity - s.booked;
            return (
              <li
                key={s.id}
                className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <h3 className="text-lg font-semibold text-slate-900">
                    {s.startsAt} {typeName(s.type, i18n.language)}
                  </h3>
                  <span className="text-sm text-slate-700">
                    {s.startsAt}–{s.endsAt}
                  </span>
                </div>
                <p className="text-sm text-slate-700">
                  {s.trainer ? s.trainer.firstName : t('classes.noTrainer')}
                  {s.room ? ` · ${s.room}` : ''}
                  {' · '}
                  {s.cancelled
                    ? t('classes.cancelled')
                    : left <= 0
                      ? t('classes.member.full')
                      : t('classes.member.spotsLeft', { count: left })}
                </p>
                <BookingButton
                  gymId={gymId}
                  session={s}
                  canBook={canBook}
                  dayLabel={label(s.date, true)}
                  onChanged={load}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The member's "Μαθήματα" area: the timetable, and their bookings under /my. */
export function ClassTimetablePage(props: { now?: () => Date }) {
  return (
    <Routes>
      <Route index element={<Timetable now={props.now} />} />
      <Route path="my" element={<MyBookingsPage now={props.now} />} />
    </Routes>
  );
}
