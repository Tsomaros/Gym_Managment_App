/** The parts of the push handler that can be tested without a service worker. Used by sw.ts. */

/**
 * A path inside the app, nothing else: the payload comes over the network. Resolved like a
 * browser would, so `/\host` (read as `//host`) and tab tricks are caught by the origin check.
 */
export function safeTargetUrl(url: unknown): string {
  if (typeof url !== 'string' || !url.startsWith('/')) return '/';
  const base = 'https://app.invalid';
  try {
    const u = new URL(url, base);
    return u.origin === base ? `${u.pathname}${u.search}${u.hash}` : '/';
  } catch {
    return '/';
  }
}

export interface NotificationToShow {
  title: string;
  options: { body: string; icon: string; badge: string; data: { url: string } };
}

/**
 * What to show for a push. Browsers (iOS above all) may revoke the subscription when a push shows
 * nothing, so a payload we cannot read still becomes a plain notification.
 */
export function notificationFrom(raw: string | null): NotificationToShow {
  let parsed: { title?: unknown; body?: unknown; url?: unknown } = {};
  try {
    const value: unknown = raw ? JSON.parse(raw) : {};
    parsed =
      value && typeof value === 'object' && !Array.isArray(value) ? (value as typeof parsed) : {};
  } catch {
    parsed = {};
  }
  return {
    title: typeof parsed.title === 'string' && parsed.title ? parsed.title : 'Gym',
    options: {
      body: typeof parsed.body === 'string' ? parsed.body : '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: safeTargetUrl(parsed.url) },
    },
  };
}
