import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';

export type PushState = 'unsupported' | 'needs-install' | 'default' | 'denied' | 'subscribed';

export const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const isStandalone = () =>
  (navigator as Navigator & { standalone?: boolean }).standalone === true ||
  (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);

const isSupported = () =>
  typeof Notification !== 'undefined' &&
  typeof PushManager !== 'undefined' &&
  !!navigator.serviceWorker;

/** What can be known without asking the browser's push manager. */
function detect(): PushState {
  // Safari on iOS has no web push outside the installed app (spike: docs/spikes/2026-11-pwa-push.md).
  if (isIos() && !isStandalone()) return 'needs-install';
  if (!isSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return 'default';
}

/** The VAPID public key is base64url; the push manager wants the raw bytes. */
function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(base64Url.length / 4) * 4, '=');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Web push for this browser. `enable` must run from a tap (iOS asks for permission only then);
 * it subscribes through `navigator.serviceWorker.ready`, never `getRegistration()`, which can still
 * be empty right after the first load (spike lesson).
 */
export function usePush(): {
  state: PushState;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
} {
  const [state, setState] = useState<PushState>(detect);

  // Permission may already be granted with a live subscription from an earlier visit.
  useEffect(() => {
    if (state !== 'default') return;
    let cancelled = false;
    void (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled && sub && Notification.permission === 'granted') setState('subscribed');
      } catch {
        // No service worker (a dev build): stay on "default".
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state]);

  const enable = useCallback(async () => {
    const permission = await Notification.requestPermission();
    if (permission === 'denied') return setState('denied');
    if (permission !== 'granted') return setState('default');
    const { key } = await apiFetch<{ key: string }>('/push/vapid-public-key');
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(key),
    });
    try {
      await apiFetch('/me/push-subscriptions', {
        method: 'PUT',
        body: JSON.stringify(sub.toJSON()),
      });
    } catch (err) {
      // The server does not know this subscription: do not keep a half-enabled browser.
      await sub.unsubscribe().catch(() => false);
      throw err;
    }
    setState('subscribed');
  }, []);

  const disable = useCallback(async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await apiFetch('/me/push-subscriptions', {
        method: 'DELETE',
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
    setState('default');
  }, []);

  return { state, enable, disable };
}

/**
 * Ends push on this browser for whoever is signed in: the server row goes (so no reminder is sent
 * to it any more) and so does the browser's subscription. Called on sign-out, because a shared
 * device would otherwise keep showing the previous person's reminders. Never throws.
 */
export async function dropPushSubscription(): Promise<void> {
  try {
    if (!isSupported()) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await apiFetch('/me/push-subscriptions', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => undefined);
    await sub.unsubscribe();
  } catch {
    // Signing out matters more than tidying up.
  }
}
