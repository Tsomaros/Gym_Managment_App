import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import webpush from 'web-push';
import { getEnv } from '../config/env';
import { systemDb } from '../db/client';
import { pushSubscriptions } from '../db/schema';

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** The one call to the browser vendors' push services. Tests replace it with a fake. */
export abstract class PushTransport {
  /** Rejects with an error carrying `statusCode` when the push service answers with one. */
  abstract send(target: PushTarget, payload: string): Promise<void>;
}

@Injectable()
export class WebPushTransport extends PushTransport {
  private configured = false;

  async send(target: PushTarget, payload: string): Promise<void> {
    if (!this.configured) {
      const env = getEnv();
      webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
      this.configured = true;
    }
    await webpush.sendNotification(target, payload, { TTL: 24 * 3600, timeout: 10_000 });
  }
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

/** The subscription row as the service needs it. */
export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

@Injectable()
export class PushService {
  constructor(private readonly transport: PushTransport) {}

  /**
   * Sends to one subscription. 'gone' (404/410: the browser dropped it) deletes the row; any other
   * failure is logged and leaves it, so a flaky push service never costs a person their subscription.
   */
  async send(sub: PushSubscriptionRow, payload: PushPayload): Promise<'ok' | 'gone' | 'error'> {
    try {
      await this.transport.send(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
      );
      await systemDb
        .update(pushSubscriptions)
        .set({ lastSuccessAt: new Date() })
        .where(eq(pushSubscriptions.id, sub.id));
      return 'ok';
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await systemDb.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
        return 'gone';
      }
      console.error(`[push] send failed (${status ?? 'no status'}): ${(err as Error).message}`);
      return 'error';
    }
  }
}
