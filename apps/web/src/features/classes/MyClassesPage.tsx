import type { ClassSessionView } from '@gym/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { apiFetch } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { addDays, todayIn } from '../schedule/dates';
import { SessionDetailPage } from './SessionDetailPage';
import { typeName } from './shared';

const DAYS_AHEAD = 7;

/**
 * Trainer: the classes they run today and in the next 7 days. Today's classes open straight into
 * the attendance list; later ones are only listed (marking opens an hour before the start).
 */
export function MyClassesPage({ now = () => new Date() }: { now?: () => Date } = {}) {
  const { t, i18n } = useTranslation();
  const { gymId = '' } = useParams();
  const { me } = useAuth();
  const [sessions, setSessions] = useState<ClassSessionView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const lastOpened = useRef<string | null>(null);
  // The gym and its staff share a time zone (the same choice as the shift list).
  const today = todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone, now());

  const load = useCallback(() => {
    setFailed(false);
    apiFetch<ClassSessionView[]>(
      `/gyms/${gymId}/class-sessions?from=${today}&to=${addDays(today, DAYS_AHEAD)}`,
    )
      .then(setSessions)
      .catch(() => setFailed(true));
  }, [gymId, today]);
  useEffect(load, [load]);

  const mine = (sessions ?? []).filter((s) => me && s.trainer?.id === me.id);
  const open = mine.find((s) => s.id === openId) ?? null;

  useEffect(() => {
    if (!openId && lastOpened.current && sessions) {
      document.querySelector<HTMLElement>(`[data-session="${lastOpened.current}"]`)?.focus();
    }
  }, [openId, sessions]);

  if (open) {
    return (
      <SessionDetailPage
        gymId={gymId}
        session={open}
        canManage={false}
        canBook={false}
        onBack={() => setOpenId(null)}
        onChanged={() => {
          setOpenId(null);
          load();
        }}
      />
    );
  }

  const tag = i18n.language === 'en' ? 'en-GB' : 'el-GR';
  const dayLabel = (iso: string) =>
    new Intl.DateTimeFormat(tag, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(new Date(`${iso}T00:00:00Z`));

  return (
    <section aria-labelledby="my-classes-title">
      <h2 id="my-classes-title" className="mb-3 text-xl font-semibold text-slate-900">
        {t('classes.mine.title')}
      </h2>
      {failed && (
        <div role="alert" className="mb-4 flex items-center gap-3 text-red-700">
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
      {sessions && mine.length === 0 && (
        <p className="text-slate-700">{t('classes.mine.empty', { days: DAYS_AHEAD })}</p>
      )}
      {mine.length > 0 && (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {mine.map((s) => {
            const isToday = s.date === today;
            const name = typeName(s.type, i18n.language);
            const text = (
              <>
                <span className="mr-auto font-semibold">
                  {dayLabel(s.date)}
                  {isToday && <span className="font-normal"> · {t('schedule.today')}</span>}
                </span>
                <span className="font-medium">
                  {s.startsAt}–{s.endsAt}
                </span>
                <span>{name}</span>
                <span className="text-sm">
                  {s.cancelled
                    ? t('classes.cancelled')
                    : t('classes.spots', { booked: s.booked, capacity: s.capacity })}
                </span>
              </>
            );
            return (
              <li key={s.id} aria-current={isToday ? 'date' : undefined}>
                {isToday && !s.cancelled ? (
                  <button
                    type="button"
                    data-session={s.id}
                    onClick={() => {
                      lastOpened.current = s.id;
                      setOpenId(s.id);
                    }}
                    className="flex min-h-11 w-full flex-wrap items-center gap-3 p-4 text-left text-slate-900 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-slate-900"
                  >
                    {text}
                  </button>
                ) : (
                  <div
                    className={`flex flex-wrap items-center gap-3 p-4 ${
                      s.cancelled ? 'text-slate-500 line-through' : 'text-slate-900'
                    }`}
                  >
                    {text}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
