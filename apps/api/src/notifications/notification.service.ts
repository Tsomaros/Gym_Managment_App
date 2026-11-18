import { type BeforeApplicationShutdown, Injectable } from '@nestjs/common';
import {
  groupOfEvent,
  type Locale,
  type NotificationEvent,
  type NotificationGroup,
} from '@gym/shared';
import { and, eq, sql } from 'drizzle-orm';
import { getEnv } from '../config/env';
import { systemDb } from '../db/client';
import {
  gymRoles,
  gyms,
  notificationPrefs,
  notificationsSent,
  pushSubscriptions,
  users,
} from '../db/schema';
import { withGym } from '../db/tenant';
import { MailService } from '../mail/mail.service';
import { type PushSubscriptionRow, PushService } from './push.service';
import { type NotificationParams, renderNotification } from './templates';

/**
 * At most this many dispatched sends run at once. Each one holds a pooled database connection
 * while it talks to the mail server, so an unbounded burst (a rush of check-ins while the mail
 * server is slow) could take the whole pool and stop everything else.
 */
export const DISPATCH_CONCURRENCY = 3;

export interface NotifyInput {
  gymId: string;
  userId: string;
  event: NotificationEvent;
  /** One value per thing that must reach the person once, see the plan's Global Constraints. */
  dedupeKey: string;
  params: NotificationParams;
}

export type NotifyResult = 'sent' | 'duplicate' | 'opted_out' | 'failed';

@Injectable()
export class NotificationService implements BeforeApplicationShutdown {
  private readonly pending = new Set<Promise<unknown>>();
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly mail: MailService,
    private readonly push: PushService,
  ) {}

  /**
   * Fire and forget for events raised inside a request (a check-in must not wait for SMTP): runs
   * `notify` in the background and logs a failure. `idle()` waits for those that are still running.
   */
  dispatch(input: NotifyInput): void {
    const task: Promise<unknown> = new Promise<void>((resolve) => {
      const start = () => {
        this.running++;
        this.notify(input)
          .catch((err: Error) => {
            console.error(`[notify] ${input.event} for ${input.userId} failed: ${err.message}`);
          })
          .finally(() => {
            this.running--;
            this.waiting.shift()?.();
            resolve();
          });
      };
      if (this.running < DISPATCH_CONCURRENCY) start();
      else this.waiting.push(start);
    }).finally(() => this.pending.delete(task));
    this.pending.add(task);
  }

  /** Resolves when every dispatched notification has finished (shutdown, tests). */
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  /** A deploy or restart lets the sends that are already running finish first. */
  async beforeApplicationShutdown(): Promise<void> {
    await this.idle();
  }

  /**
   * Sends one event to one member over email and web push, at most once per dedupe key.
   *
   * Everything runs in one transaction that first takes an advisory lock on (gym, key): two runs
   * of the same key (a restart, a second instance) queue up, and the second one finds the first
   * one's row. The row is written only after at least one channel succeeded, so a failed send is
   * retried by the next run. At-least-once at the edges: a crash after the email left but before
   * the row commits resends on the next run. Holds a pooled connection while sending, which is fine at this scale.
   */
  async notify(input: NotifyInput): Promise<NotifyResult> {
    const { gymId, userId, event, dedupeKey } = input;
    return withGym(gymId, async (tx) => {
      // A hung send must not make same-key waiters queue forever: they give up (and throw) after 5 s.
      await tx.execute(sql`select set_config('lock_timeout', '5000', true)`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${gymId}:${dedupeKey}`}))`);
      const [existing] = await tx
        .select({ id: notificationsSent.id })
        .from(notificationsSent)
        .where(and(eq(notificationsSent.gymId, gymId), eq(notificationsSent.dedupeKey, dedupeKey)));
      if (existing) return 'duplicate';

      // Only members receive these events; staff (and people without a role here) get nothing.
      const [person] = await tx
        .select({
          email: users.email,
          firstName: users.firstName,
          locale: users.locale,
          gymName: gyms.name,
        })
        .from(gymRoles)
        .innerJoin(users, eq(users.id, gymRoles.userId))
        .innerJoin(gyms, eq(gyms.id, gymRoles.gymId))
        .where(and(eq(gymRoles.userId, userId), eq(gymRoles.role, 'member')));
      if (!person) return 'opted_out';

      const group = groupOfEvent(event);
      const prefs = await this.prefsOf(tx, userId, group);
      const subs: PushSubscriptionRow[] = prefs.push
        ? await systemDb
            .select({
              id: pushSubscriptions.id,
              endpoint: pushSubscriptions.endpoint,
              p256dh: pushSubscriptions.p256dh,
              auth: pushSubscriptions.auth,
            })
            .from(pushSubscriptions)
            .where(eq(pushSubscriptions.userId, userId))
        : [];
      // Nothing to send over: switched off, or push is on but the person has no subscription.
      if (!prefs.email && subs.length === 0) return 'opted_out';

      const rendered = renderNotification(event, {
        locale: person.locale as Locale,
        gymId,
        gymName: person.gymName,
        firstName: person.firstName,
        webOrigin: getEnv().WEB_ORIGIN,
        params: input.params,
      });

      const channels: ('email' | 'push')[] = [];
      if (prefs.email) {
        try {
          await this.mail.send({ to: person.email, ...rendered.email });
          channels.push('email');
        } catch (err) {
          console.error(`[notify] email failed (${event}): ${(err as Error).message}`);
        }
      }
      let pushed = false;
      for (const sub of subs) {
        if ((await this.push.send(sub, rendered.push)) === 'ok') pushed = true;
      }
      if (pushed) channels.push('push');

      if (channels.length === 0) return 'failed';
      await tx.insert(notificationsSent).values({ gymId, userId, event, dedupeKey, channels });
      return 'sent';
    });
  }

  private async prefsOf(
    tx: Parameters<Parameters<typeof withGym>[1]>[0],
    userId: string,
    group: NotificationGroup,
  ): Promise<{ email: boolean; push: boolean }> {
    const [row] = await tx
      .select({ email: notificationPrefs.email, push: notificationPrefs.push })
      .from(notificationPrefs)
      .where(and(eq(notificationPrefs.userId, userId), eq(notificationPrefs.group, group)));
    return row ?? { email: true, push: true };
  }
}
