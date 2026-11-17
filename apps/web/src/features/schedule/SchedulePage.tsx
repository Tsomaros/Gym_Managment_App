import type { GymSettings, ScheduleResponse } from '@gym/shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { apiFetch } from '../../api/client';
import { addDays, mondayOf, todayIn, weekDates } from './dates';
import { ShiftDialog, type ShiftTarget } from './ShiftDialog';
import { useNarrow } from './useNarrow';
import { WeekGrid } from './WeekGrid';

const nav =
  'min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';

/**
 * The week schedule of all staff (Monday to Sunday in gym time). The owner edits it; reception
 * only when the owner allowed it in the settings. Past days are read-only.
 */
export function SchedulePage({
  isOwner,
  now = () => new Date(),
}: {
  isOwner: boolean;
  /** The current instant; replaced in tests. */
  now?: () => Date;
}) {
  const { t, i18n } = useTranslation();
  const { gymId = '' } = useParams();
  const narrow = useNarrow();
  const [settings, setSettings] = useState<GymSettings | null>(null);
  const [monday, setMonday] = useState<string | null>(null);
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [target, setTarget] = useState<ShiftTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const noticeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiFetch<GymSettings>(`/gyms/${gymId}/settings`)
      .then((s) => {
        setSettings(s);
        setMonday((current) => current ?? mondayOf(todayIn(s.timezone, now())));
      })
      .catch(() => setFailed(true));
    // `now` is only a test seam
  }, [gymId]);

  // A late answer for another week must not overwrite the week on screen.
  useEffect(() => {
    if (!monday) return;
    let live = true;
    setFailed(false);
    apiFetch<ScheduleResponse>(`/gyms/${gymId}/schedule?from=${monday}&to=${addDays(monday, 6)}`)
      .then((d) => live && setData(d))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [gymId, monday, reloadKey]);
  const load = () => setReloadKey((k) => k + 1);
  /** Moving to another week: forget the old one (its shifts would sit under the new dates). */
  const go = (m: string) => {
    if (m === monday) return;
    setData(null);
    setNotice(null);
    setMonday(m);
  };

  const today = settings ? todayIn(settings.timezone, now()) : null;
  const editable = isOwner || !!settings?.receptionCanEditShifts;
  const days = monday ? weekDates(monday) : [];
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-GB' : 'el-GR', {
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(new Date(`${iso}T00:00:00Z`));

  return (
    <section aria-labelledby="schedule-title">
      <h2 id="schedule-title" className="mb-3 text-xl font-semibold text-slate-900">
        {t('schedule.title')}
      </h2>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={nav}
          disabled={!monday}
          onClick={() => monday && go(addDays(monday, -7))}
        >
          {t('schedule.prevWeek')}
        </button>
        <button
          type="button"
          className={nav}
          disabled={!settings}
          onClick={() => settings && go(mondayOf(todayIn(settings.timezone, now())))}
        >
          {t('schedule.thisWeek')}
        </button>
        <button
          type="button"
          className={nav}
          disabled={!monday}
          onClick={() => monday && go(addDays(monday, 7))}
        >
          {t('schedule.nextWeek')}
        </button>
        {monday && (
          <p className="ml-auto font-medium text-slate-800" aria-live="polite">
            {fmt(monday)} – {fmt(addDays(monday, 6))}
          </p>
        )}
      </div>

      <div
        ref={noticeRef}
        tabIndex={-1}
        role="status"
        className="min-h-6 text-green-800 focus:outline-none"
      >
        {notice}
      </div>
      {failed && (
        <div role="alert" className="mb-4 flex items-center gap-3 text-red-700">
          {t('common.genericError')}
          <button type="button" onClick={load} className="min-h-11 underline">
            {t('app.retry')}
          </button>
        </div>
      )}
      {!data && !failed && (
        <p role="status" className="text-slate-600">
          {t('app.loading')}
        </p>
      )}
      {data && today && (
        <WeekGrid
          days={days}
          staff={data.staff}
          shifts={data.shifts}
          today={today}
          editable={editable}
          narrow={narrow}
          onAdd={(staffId, date) => {
            setNotice(null);
            setTarget({ kind: 'new', staffId, date });
          }}
          onOpen={(shift) => {
            setNotice(null);
            setTarget({ kind: 'edit', shift });
          }}
        />
      )}
      {!editable && settings && (
        <p className="mt-3 text-sm text-slate-600">{t('schedule.readOnlyHint')}</p>
      )}

      {target && data && (
        <ShiftDialog
          gymId={gymId}
          staff={data.staff}
          target={target}
          onClose={() => setTarget(null)}
          returnFocusTo={() => noticeRef.current}
          onSaved={() => {
            setTarget(null);
            setNotice(t('schedule.saved'));
            load();
          }}
        />
      )}
    </section>
  );
}
