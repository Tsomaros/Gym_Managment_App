import type { BookingView } from '@gym/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { apiFetch } from '../../api/client';
import { typeName } from './shared';

/** Member home: "Next class: Pilates, Tuesday 18:00" with a link to their bookings; nothing without one. */
export function NextClassCard() {
  const { t, i18n } = useTranslation();
  const { gymId = '' } = useParams();
  const [next, setNext] = useState<BookingView | null>(null);

  useEffect(() => {
    apiFetch<BookingView[]>(`/gyms/${gymId}/me/bookings?upcoming=true`)
      .then((list) => setNext(list[0] ?? null))
      .catch(() => setNext(null)); // a card, not a feature: stay quiet when it cannot load
  }, [gymId]);

  if (!next) return null;
  const tag = i18n.language === 'en' ? 'en-GB' : 'el-GR';
  const weekday = new Intl.DateTimeFormat(tag, { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(`${next.session.date}T00:00:00Z`),
  );
  return (
    <section
      aria-label={t('classes.member.nextTitle')}
      className="mx-auto mt-4 flex max-w-xl flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4"
    >
      <p className="mr-auto font-semibold text-slate-900">
        {t('classes.member.next', {
          name: typeName(next.session.type, i18n.language),
          day: weekday,
          time: next.session.startsAt,
        })}
      </p>
      <Link to={`/g/${gymId}/classes/my`} className="min-h-11 content-center underline">
        {t('classes.member.mine')}
      </Link>
    </section>
  );
}
