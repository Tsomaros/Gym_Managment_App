import type { ClassSessionView, ClassTypeView, ScheduleResponse } from '@gym/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { apiFetch } from '../../api/client';
import { addDays, mondayOf, todayIn, weekDates } from '../schedule/dates';
import { useNarrow } from '../schedule/useNarrow';
import { ClassSeriesDialog, type SeriesChange } from './ClassSeriesDialog';
import { ClassSessionDialog } from './ClassSessionDialog';
import { SessionDetailPage } from './SessionDetailPage';
import { durationOf, plainClass, primaryClass, type TrainerOption, typeName } from './shared';

/**
 * The weekly class timetable: Monday to Sunday columns on a tablet or desktop, a day list on a
 * phone. The owner adds weekly and one-off classes; owner and reception open a class to see who
 * is booked, tick attendance and book members.
 */
export function TimetablePage({
  isOwner,
  now = () => new Date(),
}: {
  isOwner: boolean;
  now?: () => Date;
}) {
  const { t, i18n } = useTranslation();
  const { gymId = '' } = useParams();
  // Seven columns need room: below 1024 px the day list reads better than cramped columns.
  const narrow = useNarrow('(max-width: 1023px)');
  const lastOpened = useRef<string | null>(null);
  const [typesFailed, setTypesFailed] = useState(false);
  // The gym and its staff share a time zone, and reception cannot always read the gym's settings.
  const today = todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone, now());
  const [monday, setMonday] = useState(() => mondayOf(today));
  const [sessions, setSessions] = useState<ClassSessionView[] | null>(null);
  const [types, setTypes] = useState<ClassTypeView[]>([]);
  const [trainers, setTrainers] = useState<TrainerOption[]>([]);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    { kind: 'series'; change?: SeriesChange } | { kind: 'oneOff'; date: string } | null
  >(null);
  const days = weekDates(monday);
  const sunday = days[6]!;

  const load = useCallback(() => {
    setFailed(false);
    apiFetch<ClassSessionView[]>(`/gyms/${gymId}/class-sessions?from=${monday}&to=${sunday}`)
      .then(setSessions)
      .catch(() => setFailed(true));
  }, [gymId, monday, sunday]);
  useEffect(load, [load]);

  useEffect(() => {
    if (!isOwner) return;
    apiFetch<ClassTypeView[]>(`/gyms/${gymId}/class-types`)
      .then((r) => {
        setTypes(r);
        setTypesFailed(false);
      })
      .catch(() => setTypesFailed(true));
    apiFetch<ScheduleResponse>(`/gyms/${gymId}/schedule?from=${today}&to=${today}`)
      .then((r) =>
        setTrainers(r.staff.filter((s) => s.roles.includes('trainer'))),
      )
      .catch(() => undefined);
  }, [gymId, isOwner, today]);

  const byDay = useMemo(() => {
    const map = new Map<string, ClassSessionView[]>();
    for (const s of sessions ?? []) map.set(s.date, [...(map.get(s.date) ?? []), s]);
    return map;
  }, [sessions]);

  const tag = i18n.language === 'en' ? 'en-GB' : 'el-GR';
  const dayLabel = (iso: string, long = false) =>
    new Intl.DateTimeFormat(tag, {
      weekday: long ? 'long' : 'short',
      day: 'numeric',
      month: long ? 'long' : 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${iso}T00:00:00Z`));

  const open = sessions?.find((s) => s.id === openId) ?? null;

  // Back from a class: focus returns to its block in the week.
  useEffect(() => {
    if (!openId && lastOpened.current && sessions) {
      document.querySelector<HTMLElement>(`[data-session="${lastOpened.current}"]`)?.focus();
    }
  }, [openId, sessions]);

  if (open) {
    const trainerId = open.trainer?.id ?? '';
    const change: SeriesChange | null = open.seriesId
      ? {
          seriesId: open.seriesId,
          from: open.date,
          values: {
            classTypeId: open.type.id,
            startsAt: open.startsAt,
            duration: String(durationOf(open)),
            capacity: String(open.capacity),
            trainerId,
            room: open.room ?? '',
          },
        }
      : null;
    return (
      <>
        <SessionDetailPage
          gymId={gymId}
          session={open}
          canManage={isOwner}
          canBook
          onBack={() => setOpenId(null)}
          onChanged={() => {
            setOpenId(null);
            load();
          }}
          onChangeFromHere={change ? () => setDialog({ kind: 'series', change }) : undefined}
        />
        {dialog?.kind === 'series' && (
          <ClassSeriesDialog
            gymId={gymId}
            types={types}
            trainers={trainers}
            today={today}
            change={dialog.change}
            onClose={() => setDialog(null)}
            onSaved={() => {
              setDialog(null);
              setOpenId(null);
              load();
            }}
          />
        )}
      </>
    );
  }

  const block = (s: ClassSessionView) => {
    const name = typeName(s.type, i18n.language);
    return (
      <li key={s.id}>
        <button
          type="button"
          data-session={s.id}
          onClick={() => {
            lastOpened.current = s.id;
            setOpenId(s.id);
          }}
          aria-label={`${s.startsAt} ${name}, ${t('classes.spots', {
            booked: s.booked,
            capacity: s.capacity,
          })}${s.cancelled ? `, ${t('classes.cancelled')}` : ''}`}
          className={`flex min-h-11 w-full flex-col gap-0.5 rounded-lg border p-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${
            s.cancelled
              ? 'border-slate-200 bg-slate-50 text-slate-500'
              : 'border-slate-300 bg-white text-slate-900 hover:bg-slate-50'
          }`}
        >
          <span className={`font-semibold break-words ${s.cancelled ? 'line-through' : ''}`}>
            {s.startsAt} {name}
          </span>
          <span className="text-xs text-slate-700">
            {s.trainer ? s.trainer.firstName : t('classes.noTrainer')}
            {s.room ? ` · ${s.room}` : ''}
          </span>
          <span className="text-xs font-medium text-slate-800">
            {s.cancelled
              ? t('classes.cancelled')
              : t('classes.spots', { booked: s.booked, capacity: s.capacity })}
          </span>
        </button>
      </li>
    );
  };

  return (
    <section aria-labelledby="timetable-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="timetable-title" className="mr-auto text-xl font-semibold text-slate-900">
          {t('classes.timetable')}
        </h2>
        {isOwner && typesFailed && (
          <p role="alert" className="text-sm text-red-700">
            {t('classes.typesFailed')}
          </p>
        )}
        {isOwner && (
          <>
            <button
              type="button"
              aria-disabled={typesFailed || undefined}
              onClick={() => !typesFailed && setDialog({ kind: 'series' })}
              className={primaryClass}
            >
              {t('classes.addWeekly')}
            </button>
            <button
              type="button"
              aria-disabled={typesFailed || undefined}
              onClick={() => !typesFailed && setDialog({ kind: 'oneOff', date: today })}
              className={plainClass}
            >
              {t('classes.addOneOff')}
            </button>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setMonday(addDays(monday, -7))}
          className={plainClass}
          aria-label={t('schedule.prevWeek')}
        >
          ←
        </button>
        <span aria-live="polite" className="min-w-40 text-center font-medium text-slate-900">
          {dayLabel(monday)} – {dayLabel(sunday)}
        </span>
        <button
          type="button"
          onClick={() => setMonday(addDays(monday, 7))}
          className={plainClass}
          aria-label={t('schedule.nextWeek')}
        >
          →
        </button>
        <button type="button" onClick={() => setMonday(mondayOf(today))} className={plainClass}>
          {t('schedule.today')}
        </button>
      </div>

      {failed && (
        <div role="alert" className="flex items-center gap-3 text-red-700">
          {t('common.genericError')}
          <button type="button" onClick={load} className="min-h-11 underline">
            {t('app.retry')}
          </button>
        </div>
      )}
      {!sessions && !failed && (
        <p role="status" className="text-slate-600">
          {t('app.loading')}
        </p>
      )}
      {sessions && sessions.length === 0 && (
        <p className="text-slate-700">{t('classes.empty')}</p>
      )}

      {sessions && (
        <ol
          className={narrow ? 'flex flex-col gap-4' : 'grid grid-cols-7 gap-2'}
          aria-label={t('classes.timetable')}
        >
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            if (narrow && list.length === 0) return null;
            return (
              <li key={d} aria-current={d === today ? 'date' : undefined} className="min-w-0">
                <h3
                  className={`mb-1 text-sm font-semibold ${d === today ? 'text-slate-900 underline' : 'text-slate-700'}`}
                >
                  {dayLabel(d, narrow)}
                  {d === today && <span className="font-normal"> · {t('schedule.today')}</span>}
                </h3>
                <ul className="flex flex-col gap-1">{list.map(block)}</ul>
              </li>
            );
          })}
        </ol>
      )}

      {dialog?.kind === 'series' && (
        <ClassSeriesDialog
          gymId={gymId}
          types={types}
          trainers={trainers}
          today={today}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            load();
          }}
        />
      )}
      {dialog?.kind === 'oneOff' && (
        <ClassSessionDialog
          gymId={gymId}
          types={types}
          trainers={trainers}
          today={today}
          date={dialog.date}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            load();
          }}
        />
      )}
    </section>
  );
}
