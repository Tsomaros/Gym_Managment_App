import { z } from 'zod';

export const NOTIFICATION_EVENTS = [
  'membership.expiring',
  'membership.expires_today',
  'visits.low',
  'plan.assigned',
  'class.reminder',
  'class.cancelled',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/** The groups a member can switch on and off per channel. */
export const NOTIFICATION_GROUPS = ['membership', 'plans', 'classes'] as const;
export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];

export const groupOfEvent = (event: NotificationEvent): NotificationGroup =>
  event === 'plan.assigned' ? 'plans' : event.startsWith('class.') ? 'classes' : 'membership';

/**
 * The server POSTs to this URL, so it must be one of the browser vendors' push services: https
 * only, and a known host (otherwise a signed-in user could make the API call internal services).
 */
const PUSH_HOSTS = /(^|\.)(googleapis\.com|mozilla\.com|windows\.com|apple\.com)$/;
const pushEndpointSchema = z
  .url()
  .max(2000)
  .refine((value) => {
    // https://host/..., no port, no user info; the host must be a known push service.
    const host = /^https:\/\/([a-z0-9.-]+)(?:[/?#]|$)/i.exec(value)?.[1];
    return !!host && PUSH_HOSTS.test(host.toLowerCase());
  }, 'Unsupported push service');

/** The browser's `PushSubscription.toJSON()` shape. */
export const PushSubscriptionSchema = z.object({
  endpoint: pushEndpointSchema,
  expirationTime: z.number().nullish(),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(500) }),
});
export type PushSubscriptionInput = z.infer<typeof PushSubscriptionSchema>;

export const RemovePushSubscriptionSchema = z.object({ endpoint: z.url().max(2000) });

const ChannelPrefsSchema = z.object({ email: z.boolean(), push: z.boolean() });
export const NotificationPrefsSchema = z.object({
  membership: ChannelPrefsSchema,
  plans: ChannelPrefsSchema,
  classes: ChannelPrefsSchema,
});
export type NotificationPrefs = z.infer<typeof NotificationPrefsSchema>;

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  membership: { email: true, push: true },
  plans: { email: true, push: true },
  classes: { email: true, push: true },
};

export const REMINDER_DAYS_MIN = 1;
export const REMINDER_DAYS_MAX = 14;
