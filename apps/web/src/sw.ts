/// <reference lib="webworker" />
// Our own service worker (vite-plugin-pwa injectManifest): the offline precache as before, plus push.
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { notificationFrom, safeTargetUrl } from './sw-push';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | { url: string; revision: string | null }>;
};

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
// Single-page app: every navigation gets index.html, except calls to the API.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//] }),
);

// registerType 'autoUpdate': a new version takes over at once.
self.addEventListener('install', () => void self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  const { title, options } = notificationFrom(event.data ? event.data.text() : null);
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(
    safeTargetUrl((event.notification.data as { url?: unknown } | null)?.url),
    self.location.origin,
  ).href;
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Never steer the entrance tablet (/kiosk) away: it stays on its screen.
      const existing = open.find((c) => {
        const u = new URL(c.url);
        return u.origin === self.location.origin && !u.pathname.startsWith('/kiosk');
      });
      if (existing) {
        try {
          await existing.focus();
          await (existing as WindowClient).navigate(target);
          return;
        } catch {
          // an uncontrolled window cannot be navigated: open a new one instead
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
