import type { Locale, NotificationEvent } from '@gym/shared';
import type { PushPayload } from '../push.service';

export type NotificationParams = Record<string, string | number>;

export interface RenderContext {
  locale: Locale;
  gymId: string;
  gymName: string;
  firstName: string;
  webOrigin: string;
  params: NotificationParams;
}

export interface RenderedNotification {
  email: { subject: string; text: string };
  push: PushPayload;
}

/** 2027-05-31 -> 31/05/2027, the same in both languages. */
function day(iso: string | number | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso ?? '');
}

interface Copy {
  subject: string;
  /** The sentence the email and the push both carry. */
  line: string;
  title: string;
  /** Where tapping the push opens, relative to the web origin. */
  path: string;
}

const copy: Record<Locale, Record<NotificationEvent, (c: RenderContext) => Copy>> = {
  el: {
    'membership.expiring': ({ params: p }) => ({
      subject: 'Η συνδρομή σου λήγει σύντομα',
      title: 'Η συνδρομή σου λήγει σύντομα',
      line: `Η συνδρομή «${p.membershipName}» λήγει στις ${day(p.endsOn)} (σε ${p.days} ημέρες).`,
      path: '/myMembership',
    }),
    'membership.expires_today': ({ params: p }) => ({
      subject: 'Η συνδρομή σου λήγει σήμερα',
      title: 'Η συνδρομή σου λήγει σήμερα',
      line: `Η συνδρομή «${p.membershipName}» λήγει σήμερα, ${day(p.endsOn)}.`,
      path: '/myMembership',
    }),
    'visits.low': ({ params: p }) => ({
      subject: 'Σου απομένουν λίγες επισκέψεις',
      title: 'Σου απομένουν λίγες επισκέψεις',
      line:
        Number(p.left) === 0
          ? `Χρησιμοποίησες όλες τις επισκέψεις της συνδρομής «${p.membershipName}».`
          : `Στη συνδρομή «${p.membershipName}» σου απομένουν ${p.left} επισκέψεις.`,
      path: '/myMembership',
    }),
    'plan.assigned': ({ params: p }) => ({
      subject: 'Νέο πρόγραμμα προπόνησης',
      title: 'Νέο πρόγραμμα προπόνησης',
      line: `Ο γυμναστής σου σού όρισε το πρόγραμμα «${p.planName}».`,
      path: '/myWorkouts',
    }),
  },
  en: {
    'membership.expiring': ({ params: p }) => ({
      subject: 'Your membership expires soon',
      title: 'Your membership expires soon',
      line: `Your membership "${p.membershipName}" expires on ${day(p.endsOn)} (in ${p.days} days).`,
      path: '/myMembership',
    }),
    'membership.expires_today': ({ params: p }) => ({
      subject: 'Your membership expires today',
      title: 'Your membership expires today',
      line: `Your membership "${p.membershipName}" expires today, ${day(p.endsOn)}.`,
      path: '/myMembership',
    }),
    'visits.low': ({ params: p }) => ({
      subject: 'You are running low on visits',
      title: 'You are running low on visits',
      line:
        Number(p.left) === 0
          ? `You have used every visit of "${p.membershipName}".`
          : `"${p.membershipName}" has ${p.left} visits left.`,
      path: '/myMembership',
    }),
    'plan.assigned': ({ params: p }) => ({
      subject: 'A new workout plan',
      title: 'A new workout plan',
      line: `Your trainer assigned you the plan "${p.planName}".`,
      path: '/myWorkouts',
    }),
  },
};

const greeting = { el: (n: string) => `Γεια σου ${n},`, en: (n: string) => `Hi ${n},` };
const footer = {
  el: (link: string) => `Ρυθμίσεις ειδοποιήσεων: ${link}`,
  en: (link: string) => `Notification settings: ${link}`,
};

/**
 * Renders one event for one person. The push carries no amounts or health data (params that are
 * not used by the sentence, such as a price, never reach it).
 */
export function renderNotification(
  event: NotificationEvent,
  ctx: RenderContext,
): RenderedNotification {
  const c = copy[ctx.locale][event](ctx);
  const settingsLink = `${ctx.webOrigin}/settings/notifications`;
  return {
    email: {
      subject: `${ctx.gymName}: ${c.subject}`,
      text: [
        greeting[ctx.locale](ctx.firstName),
        '',
        c.line,
        '',
        `${ctx.webOrigin}/g/${ctx.gymId}${c.path}`,
        '',
        '--',
        footer[ctx.locale](settingsLink),
      ].join('\n'),
    },
    push: { title: c.title, body: c.line, url: `/g/${ctx.gymId}${c.path}` },
  };
}
