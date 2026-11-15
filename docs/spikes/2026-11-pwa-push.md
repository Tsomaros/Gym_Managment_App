# Spike result: PWA install + web push

*Date: 2026-11-15 · Tester: Dimitris*

| Check | iPhone (iOS 27, Safari 27.0.1, Greece) | Android 10 (Chrome 157) |
|---|---|---|
| Installs to home screen, opens without browser bars (`standalone: true`) | ☑ pass | ☑ pass |
| Permission prompt appears and is granted (`subscribed: 201`) | ☑ pass | ☑ pass |
| Notification arrives with the app closed and the phone locked | ☑ pass | ☑ pass |
| Greek text in the notification shows correctly | ☑ arrived (text not separately checked) | ☑ arrived (text not separately checked) |

**Notes:** On iPhone the first attempt hung after permission was granted: `pushManager.subscribe` was called on the registration before the service worker was active. Waiting for `navigator.serviceWorker.ready` fixed it. **The real app must subscribe through `navigator.serviceWorker.ready`.** Push arrived on both phones with the app closed.

**Decision:** ☑ Option A confirmed, continue with Task 2 · ☐ Failed, revisit spec §4
