import type { BookingStatus, BookingView } from '@gym/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { apiFetch } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { dangerClass, plainClass, typeName } from './shared';

/** Member: upcoming bookings (with cancel) and what happened to the earlier ones. */
export function MyBookingsPage(_props: { now?: () => Date } = {}) {
  const { t, i18n } = useTranslation();
  const { gymId = '' } = useParams();
  const [upcoming, setUpcoming] = useState<BookingView[] | null>(null);
  const [past, setPast] = useState<BookingView[]>([]);
  const [failed, setFailed] = useState(false);
  const [cancelling, setCancelling] = useState<BookingView | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelFailed, setCancelFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    Promise.all([
      apiFetch<BookingView[]>(`/gyms/${gymId}/me/bookings?upcoming=true`),
      apiFetch<BookingView[]>(`/gyms/${gymId}/me/bookings`),
    ])
      .then(([next, all]) => {
        const ids = new Set(next.map((b) => b.id));
        setUpcoming(next);
        setPast(all.filter((b) => !ids.has(b.id)));
      })
      .catch(() => setFailed(true));
  }, [gymId]);
  useEffect(load, [load]);

  const tag = i18n.language === 'en' ? 'en-GB' : 'el-GR';
  const day = (iso: string) =>
    new Intl.DateTimeFormat(tag, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(new Date(`${iso}T00:00:00Z`));
  const statusText = (s: BookingStatus) => t(`classes.status.${s}`);

  async function cancel() {
    if (!cancelling) return;
    setBusy(true);
    setCancelFailed(false);
    try {
      await apiFetch(`/gyms/${gymId}/me/bookings/${cancelling.id}`, { method: 'DELETE' });
      setCancelling(null);
      load();
    } catch {
      setCancelFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="my-bookings-title" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="my-bookings-title" className="mr-auto text-xl font-semibold text-slate-900">
          {t('classes.member.myTitle')}
        </h2>
        <Link to={`/g/${gymId}/classes`} className={`${plainClass} content-center`}>
          {t('classes.member.title')}
        </Link>
      </div>

      {failed && (
        <div role="alert" className="flex items-center gap-3 text-red-700">
          {t('common.genericError')}
          <button type="button" onClick={load} className={plainClass}>
            {t('app.retry')}
          </button>
        </div>
      )}
      {!upcoming && !failed && (
        <p role="status" className="text-slate-600">
          {t('app.loading')}
        </p>
      )}

      {upcoming && (
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold text-slate-900">{t('classes.member.upcoming')}</h3>
          {upcoming.length === 0 && (
            <p className="text-slate-700">{t('classes.member.noUpcoming')}</p>
          )}
          <ul className="flex flex-col gap-3">
            {upcoming.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="mr-auto">
                  <p className="font-semibold text-slate-900">
                    {typeName(b.session.type, i18n.language)}
                  </p>
                  <p className="text-sm text-slate-700">
                    {day(b.session.date)} · {b.session.startsAt}
                  </p>
                </div>
                <button type="button" onClick={() => setCancelling(b)} className={dangerClass}>
                  {t('classes.member.cancel')}
                  <span className="sr-only">
                    {' '}
                    {typeName(b.session.type, i18n.language)} {b.session.startsAt}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {past.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold text-slate-900">{t('classes.member.history')}</h3>
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
            {past.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 p-3">
                <span className="mr-auto text-slate-900">
                  {typeName(b.session.type, i18n.language)} · {day(b.session.date)}{' '}
                  {b.session.startsAt}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-800">
                  {statusText(b.status)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {cancelling && (
        <ConfirmDialog
          title={t('classes.member.cancelTitle')}
          message={t('classes.member.cancelMessage', {
            name: typeName(cancelling.session.type, i18n.language),
            day: day(cancelling.session.date),
            time: cancelling.session.startsAt,
          })}
          warning={cancelling.late && cancelling.usesEntry ? t('classes.member.lateWarning') : undefined}
          confirmLabel={t('classes.member.confirmCancel')}
          cancelLabel={t('classes.member.keep')}
          busy={busy}
          busyLabel={t('common.working')}
          error={cancelFailed ? t('common.genericError') : undefined}
          onConfirm={() => void cancel()}
          onCancel={() => setCancelling(null)}
        />
      )}
    </section>
  );
}
