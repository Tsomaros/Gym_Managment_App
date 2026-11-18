import { Injectable } from '@nestjs/common';
import {
  DEFAULT_NOTIFICATION_PREFS,
  NOTIFICATION_GROUPS,
  type NotificationGroup,
  type NotificationPrefs,
  type PushSubscriptionInput,
} from '@gym/shared';
import { and, eq, sql } from 'drizzle-orm';
import { systemDb } from '../db/client';
import { notificationPrefs, pushSubscriptions } from '../db/schema';
import { withGym } from '../db/tenant';

@Injectable()
export class NotificationSettingsService {
  async getPrefs(gymId: string, userId: string): Promise<NotificationPrefs> {
    const rows = await withGym(gymId, (tx) =>
      tx.select().from(notificationPrefs).where(eq(notificationPrefs.userId, userId)),
    );
    const prefs: NotificationPrefs = structuredClone(DEFAULT_NOTIFICATION_PREFS);
    for (const r of rows) {
      if ((NOTIFICATION_GROUPS as readonly string[]).includes(r.group)) {
        prefs[r.group as NotificationGroup] = { email: r.email, push: r.push };
      }
    }
    return prefs;
  }

  async setPrefs(
    gymId: string,
    userId: string,
    prefs: NotificationPrefs,
  ): Promise<NotificationPrefs> {
    await withGym(gymId, (tx) =>
      tx
        .insert(notificationPrefs)
        .values(
          NOTIFICATION_GROUPS.map((group) => ({
            gymId,
            userId,
            group,
            email: prefs[group].email,
            push: prefs[group].push,
          })),
        )
        .onConflictDoUpdate({
          target: [notificationPrefs.gymId, notificationPrefs.userId, notificationPrefs.group],
          set: { email: sql`excluded.email`, push: sql`excluded.push` },
        }),
    );
    return this.getPrefs(gymId, userId);
  }

  /** Stores or moves a subscription: one browser belongs to whoever subscribed last. */
  async subscribe(userId: string, sub: PushSubscriptionInput, userAgent?: string): Promise<void> {
    const ua = userAgent?.slice(0, 300) ?? null;
    await systemDb
      .insert(pushSubscriptions)
      .values({
        userId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        userAgent: ua,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          userId,
          p256dh: sub.keys.p256dh,
          auth: sub.keys.auth,
          userAgent: ua,
        },
      });
  }

  /** Removes the caller's own subscription for `endpoint`; someone else's is left alone. */
  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await systemDb
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
  }
}
