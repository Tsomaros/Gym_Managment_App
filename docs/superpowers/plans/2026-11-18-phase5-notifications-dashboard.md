# Phase 5: Notifications, Owner Dashboard and Occupancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Members get reminders by email and, if they installed the app and allowed it, push notifications: before their membership expires, on the expiry day, when a visit pack runs low, and when their trainer gives them a new plan. Each reminder goes out exactly once.
- The owner gets a dashboard of income, members and busy hours.
- Members see how busy the gym is right now.

**Architecture:** Builds on phase 4b (`main` at 3116855). A `NotificationService` sends one event to one person over email and web push. Each send is recorded in `notifications_sent` under a unique **dedupe key**, so a job that runs twice (restart, a second instance) never sends twice. A scheduled job runs hourly and handles gyms whose local time has reached the send hour. Event-driven notifications (visit pack low, new plan) fire after the triggering transaction commits. The dashboard is computed by pure functions over payments, memberships and check-ins.

**Tech Stack:** as phase 4b, plus `@nestjs/schedule` and `web-push` (API). The web app's service worker moves to vite-plugin-pwa's `injectManifest` strategy, with our own `sw.ts` for the push handler.

**Spec:** `docs/superpowers/specs/2026-11-15-gym-management-design.md` §2 (anti-goal: missed reminders), §4 (email always, push when installed), §6.1 (reminders, renewals), §6.2 (occupancy), §6.9 (owner dashboard), §6.11 (notifications), §12 (5 days before expiry). Spike lesson: subscribe through `navigator.serviceWorker.ready` (`docs/spikes/2026-11-pwa-push.md`).

## Global Constraints

- All earlier Global Constraints still apply.
- **Events and when they fire:**
  - `membership.expiring`: N days before the effective end (`gyms.reminder_days`, default **5**, range 1–14). Sent on the gym date `effectiveEndsOn − N`.
  - `membership.expires_today`: on the effective end date.
  - Both are skipped when the membership is frozen that day, when it's voided, or when the member already has a non-voided membership that starts within 1 day after this end ("already renewed").
  - `visits.low`: immediately after a check-in leaves a visit pack (kind `visits`) with **2** or fewer visits left. Once per membership per threshold value: 2, 1, 0.
  - `plan.assigned`: immediately after a plan becomes the member's active plan (activation, or creation with `activate`). Not sent for edits.
  - Class reminders come with phase 6.
- **Send time:** the scheduled events go out at **10:00 gym local time**. The job runs every hour at minute 5 and handles each gym whose local hour is ≥ 10 on that gym date. Catch-up after downtime is safe because of the dedupe keys.
- **Dedupe keys** (unique in `notifications_sent`):
  - `expiring:<membershipId>:<effectiveEndsOn>`
  - `expires_today:<membershipId>:<effectiveEndsOn>`
  - `visits_low:<membershipId>:<visitsLeft>`
  - `plan:<planId>:<activatedAt epoch>`

  A freeze that moves the end date creates a new key, so a new reminder for the new date is correct.
- **Channels:**
  - **Email** is on by default. A member may switch it off per event group: `membership` (expiring, expires today, visits low) and `plans`.
  - **Push** goes to every subscription of that person, also per group, on by default once subscribed.
  - Staff don't receive these events.
- **Push:** VAPID keys from env `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:` address), plus a script `pnpm --filter api vapid:keys`. A send that answers `404` or `410` deletes that subscription. Other errors are logged and leave the email untouched. Payload: `{ title, body, url }` in the member's language, never containing amounts or health data.
- **Email:** el/en templates per event, with the gym name in the subject, and a footer link "Ρυθμίσεις ειδοποιήσεων" to `${WEB_ORIGIN}/settings/notifications`. A failed email is retried by the next hourly run, because the dedupe row is written only after at least one channel succeeds. The `notifications_sent` row records which channels succeeded.
- **Dashboard (owner only)**, all in gym local time:
  - **Income per month:** non-voided payments by `paid_at` month, split by membership type name (snapshot) and by method.
  - **Active members:** distinct members with an `active` or `frozen` membership on the month's last day (on today for the current month).
  - **New members:** members whose first-ever non-voided membership started in the month.
  - **Didn't renew:** members with a time-based membership whose effective end fell in the month, and no non-voided membership starting within 14 days after it. A month whose last end + 14 days is after today is marked `provisional`.
  - **Busiest hours:** valid check-ins counted by weekday (1–7) × hour (0–23) over the last 8 weeks.
  - **Today:** visitors, who's in now, expiring in 7 days (reuse the existing services).
  - Range: the last **12 months**, including the current one.
- **Occupancy:**
  - `gyms.capacity int NULL` (1–2000) and `gyms.show_occupancy_count boolean DEFAULT false`, owner-editable.
  - The level comes from "present now" (the phase 2b definition): `quiet` < 40 % of capacity, `moderate` < 75 %, else `busy`. With no capacity set, members see nothing.
  - Members get the level; they get the count only when `show_occupancy_count` is on.
  - Staff always see the count.
- New history actions: `gym.settings_updated` (existing) covers the new settings. Notification sends are not copied to the history; `notifications_sent` is their record.

## Review Focus

1. **Exactly once:** running the reminder job twice in the same hour, or after a restart, sends one email and one push per member per event. An email that failed is retried on the next run and then not repeated. (Tasks 1, 2)
2. **Already renewed or frozen:** a member whose membership ends in 5 days but who already bought the next one gets no `expiring` reminder. A frozen member gets none while frozen, and gets one for the new end date after the freeze. (Task 2)
3. **Dead push subscriptions and opt-outs:** a push endpoint answering `410` is removed and the email still goes out. A member who switched off the `membership` email group gets push only. One who switched off both gets nothing, and no dedupe row is written for that event. (Tasks 1, 2)
4. **Month edges in Athens:** a payment at 23:30 Athens on 31 January (21:30 UTC) counts in January. A voided payment counts nowhere. A check-in at 00:30 Monday Athens counts as Monday, hour 0. (Task 4)
5. **Occupancy privacy:** with `show_occupancy_count` off, the member endpoint returns no number anywhere in its body. Invalid and auto-checked-out check-ins don't count towards presence. (Task 6)

---

### Task 1: Notification service, push subscriptions and preferences (API)

**Files:**
- Add dependencies: `web-push`, `@types/web-push` (API)
- Create: `apps/api/src/db/schema/push-subscriptions.ts`, `notification-prefs.ts`, `notifications-sent.ts`; migration `0023_notifications.sql`
- Create: `apps/api/src/notifications/notifications.module.ts`, `notification.service.ts`, `push.service.ts`, `notifications.controller.ts`, `templates/*.ts` (el + en per event)
- Create: `apps/api/scripts/vapid-keys.ts`; Modify: `apps/api/package.json` (script `vapid:keys`), `env.ts`, PROGRESS.md env key list, CI env
- Create: `packages/shared/src/schemas/notifications.ts`
- Test: `apps/api/test/notifications/notification.service.spec.ts`, `apps/api/test/notifications.e2e.spec.ts`, `apps/api/test/db/rls.spec.ts` (extend)

**Interfaces:**
- Tables:
  - `push_subscriptions(id, user_id FK users ON DELETE CASCADE, endpoint text UNIQUE, p256dh text, auth text, user_agent text NULL, created_at, last_success_at NULL)`. Global (one person, all gyms). Reached through `systemDb` scoped to the caller's user id.
  - `notification_prefs(gym_id, user_id, group text CHECK in ('membership','plans'), email bool DEFAULT true, push bool DEFAULT true, PRIMARY KEY (gym_id, user_id, group))`. Gym-owned, RLS.
  - `notifications_sent(id, gym_id, user_id, event text, dedupe_key text, channels text[] NOT NULL, sent_at, UNIQUE (gym_id, dedupe_key))`. Gym-owned, RLS.
- Shared: `NOTIFICATION_EVENTS = ['membership.expiring','membership.expires_today','visits.low','plan.assigned'] as const`; `NOTIFICATION_GROUPS`; `PushSubscriptionSchema` (the browser's `PushSubscription.toJSON()` shape); `NotificationPrefs { membership: { email; push }, plans: { email; push } }`.
- `NotificationService.notify(e: { gymId: string; userId: string; event: NotificationEvent; dedupeKey: string; params: Record<string, string | number> }): Promise<'sent' | 'duplicate' | 'opted_out' | 'failed'>`:
  1. Check the dedupe key; if present → `'duplicate'`.
  2. Resolve prefs. Both channels off → `'opted_out'`, with no row written.
  3. Render in the user's locale, then send email and push to every subscription.
  4. If at least one channel succeeded, insert the row with the channels that succeeded. A unique violation (a concurrent run) → `'duplicate'`.
  5. Otherwise → `'failed'`.
- `PushService.send(sub, payload): Promise<'ok' | 'gone' | 'error'>`. `'gone'` deletes the subscription.
- Routes (`JwtGuard`; the gym routes use `@GymRoles('member')`):
  - `GET /push/vapid-public-key` (public) → `{ key }`.
  - `PUT /me/push-subscriptions` `PushSubscription` → `204` (upserts on `endpoint`, bound to the caller). `DELETE /me/push-subscriptions` `{ endpoint }` → `204`.
  - `GET /gyms/:gymId/me/notification-prefs` → `NotificationPrefs`. `PUT` the same shape → `200`.

- [ ] **Step 1: Write the failing tests** (`MailService` and `PushService` replaced by fakes in unit tests; the e2e tests use the `FakeMail` pattern plus a fake push transport):
  - `notify` twice with the same key → `'sent'` then `'duplicate'`; one email, one push.
  - Two concurrent `notify` calls with the same key → one `'sent'`, one `'duplicate'`. *(Review Focus 1)*
  - Push `'gone'` → the subscription row is deleted; email still sent; the result is `'sent'` with `channels: ['email']`. *(Review Focus 3)*
  - Email off for `membership`, push on → only push. Both off → `'opted_out'` and no row. *(Review Focus 3)*
  - The email fails and there's no push subscription → `'failed'` and no row; a later `notify` sends. *(Review Focus 1)*
  - The template renders in English for `locale 'en'`; the push payload contains no amount.
  - Subscribing the same endpoint from a second account moves it to that account (one row).
  - Two-gym isolation for `notification_prefs` and `notifications_sent`.
- [ ] **Step 2: Run** `pnpm --filter api test notification` → FAIL.
- [ ] **Step 3: Implement.** Consult database-expert.
- [ ] **Step 4: Run** `pnpm --filter api test` → PASS.
- [ ] **Step 5: Commit** `feat: notification service with email, web push, preferences and dedupe`.

---

### Task 2: Reminder job and event triggers

**Files:**
- Add dependency: `@nestjs/schedule` (API)
- Create: `apps/api/src/notifications/reminders.job.ts`, `reminders.service.ts`, `select-reminders.ts`
- Modify: migration `0024_reminder_settings.sql` (`gyms.reminder_days`), the gym settings controller + shared schema, `apps/api/src/checkin/checkin.service.ts` (`visits.low` after commit), `apps/api/src/plans/plans.service.ts` (`plan.assigned` after commit)
- Test: `apps/api/test/notifications/select-reminders.spec.ts`, `apps/api/test/reminders.e2e.spec.ts`

**Interfaces:**
- `selectReminders(input: { today: string; reminderDays: number; memberships: (Membership & { memberId: string })[] }): { memberId; membershipId; event: 'membership.expiring' | 'membership.expires_today'; endsOn: string }[]`. Pure. Rules per Global Constraints (frozen today → skip; voided → skip; a follow-on membership starting ≤ end + 1 → skip).
- `RemindersService.runForGym(gymId: string, now: Date): Promise<{ sent: number; duplicate: number; optedOut: number; failed: number }>`. Does nothing before 10:00 local.
- `RemindersService.runAll(now: Date)`: loops over gyms through `systemDb` (gym ids only), then `runForGym` each inside its own `withGym`.
- `RemindersJob`: `@Cron('5 * * * *')` → `runAll(clock.now())`. Disabled when `NODE_ENV === 'test'`; tests call the service directly.
- After-commit hooks: `CheckInService` and `PlansService` call `notify` after their transaction resolves. A failure is logged and never fails the check-in or the save.

- [ ] **Step 1: Write the failing tests:**
  - `selectReminders` (today `2027-05-26`, `reminderDays 5`):
    - Ends 05-31 → `expiring`. Ends 05-26 → `expires_today`. Ends 06-01 → nothing.
    - A frozen membership → nothing. A follow-on membership starting 06-01 → nothing (already renewed). *(Review Focus 2)*
    - A visit pack with an end date → handled by the same rules on its end date.
  - `runForGym`:
    - At 09:59 Athens → nothing. At 10:05 → one email per due member.
    - Run again at 11:05 → zero new sends. *(Review Focus 1)*
    - After a freeze moves the end to 06-07, a reminder for the new date goes out on 06-02.
  - Check-in consuming visit 8 of 10 (2 left) → one `visits.low` email; the same check-in replayed (duplicate scan) → none; the next valid check-in (1 left) → one more.
  - Activating a plan → one `plan.assigned`; editing it → none.
  - Settings: owner `PATCH reminderDays 15` → `400`; `7` → `200`.
- [ ] **Step 2: Run** `pnpm --filter api test reminders select-reminders` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter api test` → PASS.
- [ ] **Step 5: Commit** `feat: membership reminder job and event notifications`.

---

### Task 3: Web, push subscription, notification settings, service worker

**Files:**
- Create: `apps/web/src/sw.ts` (precache via `workbox-precaching`, `push` → `showNotification`, `notificationclick` → focus or open `url`)
- Modify: `apps/web/vite.config.ts` (`VitePWA({ strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts', … })`, keep the manifest and the `/api` denylist)
- Create: `apps/web/src/features/notifications/usePush.ts`, `NotificationSettingsPage.tsx` (`/settings/notifications`), `EnablePushCard.tsx`, `InstallAppHint.tsx`
- Modify: the member shell (settings entry; `EnablePushCard` on the member home once), router, `el.json`, `en.json`
- Test: `usePush.spec.ts`, `NotificationSettingsPage.spec.tsx`, `EnablePushCard.spec.tsx`, `InstallAppHint.spec.tsx`

**Interfaces:**
- `usePush(): { state: 'unsupported' | 'needs-install' | 'default' | 'denied' | 'subscribed'; enable(): Promise<void>; disable(): Promise<void> }`.
  - `needs-install`: iOS Safari not in standalone mode.
  - `enable()`: `Notification.requestPermission()` from a tap, then `await navigator.serviceWorker.ready` (the spike lesson), then `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, then `PUT /me/push-subscriptions`.
  - `disable()`: unsubscribe, then `DELETE`.
- `InstallAppHint`: iOS steps (Safari → Share → «Προσθήκη στην οθόνη Αφετηρίας») with a simple illustration in SVG/CSS. Android: a button triggering the `beforeinstallprompt` event if captured.
- `NotificationSettingsPage`: the push state with enable/disable, and switches per group (`Συνδρομή`, `Προγράμματα`) × channel (`Email`, `Push`).
- `EnablePushCard`: a dismissible card on the member home: "Θέλεις υπενθύμιση πριν λήξει η συνδρομή σου;" → enable, or the install hint on iOS. The dismissal is remembered in `localStorage` (try/catch).

- [ ] **Step 1: Write the failing tests:**
  - `usePush`: iOS non-standalone → `needs-install`; `enable` awaits `serviceWorker.ready` before `subscribe` (mocks assert the order) and `PUT`s the subscription; permission `denied` → state `denied` with no `PUT`.
  - The settings page toggles call `PUT /notification-prefs` with the new shape.
  - The card hides after dismissal and stays hidden on reload.
- [ ] **Step 2: Run** `pnpm --filter web test notifications` → FAIL.
- [ ] **Step 3: Implement.** Check `pnpm --filter web build` produces `sw.js` with the precache manifest, and that the PWA still installs (Lighthouse "installable"). Run ui-ux-reviewer.
- [ ] **Step 4: Run** `pnpm --filter web test && pnpm --filter web build` → PASS.
- [ ] **Step 5: Commit** `feat(web): push subscription, notification settings, custom service worker`.

---

### Task 4: Owner dashboard (API)

**Files:**
- Create: `apps/api/src/dashboard/dashboard-math.ts`, `dashboard.module.ts`, `dashboard.controller.ts`, `dashboard.service.ts`
- Create: `packages/shared/src/schemas/dashboard.ts`
- Test: `apps/api/test/dashboard/dashboard-math.spec.ts`, `apps/api/test/dashboard.e2e.spec.ts`

**Interfaces:**
- `lastMonths(today: string, n: number): string[]` (`YYYY-MM`, oldest first).
- `monthOf(instant: Date, tz: string): string`.
- `incomeByMonth(payments: { paidAt: Date; amountCents: number; method; typeName: string; voided: boolean }[], months: string[], tz: string): { month; totalCents; byMethod: { cash; card }; byType: { name; cents }[] }[]`.
- `memberFlow(memberships: { memberId; kind; startsOn; effectiveEndsOn: string | null; voided: boolean }[], months: string[], today: string): { month; active; new; notRenewed; provisional: boolean }[]`.
- `busyHours(checkIns: { at: Date; valid: boolean }[], tz: string): number[][]` (a 7 × 24 grid, Monday first).
- Shared: `Dashboard { income; members; busyHours; today: { visitors: number; present: number; expiringSoon: number } }`.
- Route: `GET /gyms/:gymId/dashboard` (`@GymRoles('owner')`; reception → `403`) → `Dashboard`.

- [ ] **Step 1: Write the failing tests** (values by hand, `Europe/Athens`):
  - `monthOf(new Date('2027-01-31T21:30:00Z'))` = `'2027-01'` (23:30 Athens). A voided payment adds nothing. Cash 4000 + card 2500 in January → total 6500, `byMethod { cash: 4000, card: 2500 }`. *(Review Focus 4)*
  - Member flow:
    - A member whose first membership started 2027-02-10 → `new` in February only.
    - Ended 2027-03-20, next one starting 2027-04-01 (within 14 days) → not counted as not renewed. Next one starting 2027-04-10 → not renewed in March.
    - With today 2027-03-25, March is `provisional`.
    - Active on the last day of the month counts frozen members too.
  - `busyHours`: a check-in at `2027-03-28T21:30:00Z` (Monday 00:30 Athens) → `grid[0][0] = 1`; invalid check-ins aren't counted. *(Review Focus 4)*
  - `lastMonths('2027-05-15', 12)` starts at `'2026-06'` and ends at `'2027-05'`.
  - API: owner `200` with 12 income entries; reception → `403`.
- [ ] **Step 2: Run** `pnpm --filter api test dashboard` → FAIL.
- [ ] **Step 3: Implement.** Do the aggregation in SQL where it's simple (sums by month in the gym time zone), keeping the pure functions as the tested reference. Consult database-expert on the queries.
- [ ] **Step 4: Run** `pnpm --filter api test` → PASS.
- [ ] **Step 5: Commit** `feat: owner dashboard API`.

---

### Task 5: Web, owner dashboard

**Files:**
- Create: `apps/web/src/features/dashboard/DashboardPage.tsx` (owner `dashboard` nav item, the owner's home), `IncomeChart.tsx`, `MembersFlowChart.tsx`, `BusyHoursHeatmap.tsx`, `TodayTiles.tsx`
- Modify: owner shell, router, `el.json`, `en.json`
- Test: one `*.spec.tsx` per component

**Interfaces:**
- `TodayTiles`: visitors today, in now, expiring in 7 days (links to the desk and the renewals list).
- `IncomeChart`: monthly bars stacked by method, with a toggle "ανά τύπο συνδρομής". Amounts are formatted with `formatMoney`; the last bar is labelled "τρέχων μήνας".
- `MembersFlowChart`: an active members line, plus new and not-renewed bars. Provisional months are shown hatched or lighter, with a legend note.
- `BusyHoursHeatmap`: a 7 × 24 grid, Greek weekday abbreviations, cell labels on hover and focus, and a text summary of the three busiest slots for screen readers.
- Use the `dataviz` skill for colours, the stat tiles and the heatmap scale. Light and dark themes.

- [ ] **Step 1: Write the failing tests:** the tiles render the API numbers with links; the income toggle switches series; provisional months carry the legend note; the heatmap summary names the busiest slot ("Δευτέρα 18:00–19:00"); the empty state shows with no data.
- [ ] **Step 2: Run** `pnpm --filter web test dashboard` → FAIL.
- [ ] **Step 3: Implement.** Run ui-ux-reviewer (desktop first, readable at 375 px).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): owner dashboard`.

---

### Task 6: Occupancy

**Files:**
- Modify: migration `0025_occupancy.sql` (`gyms.capacity`, `gyms.show_occupancy_count`), the gym settings controller + shared schema + `GymSettingsPage.tsx`
- Create: `apps/api/src/checkin/occupancy.controller.ts`; shared `Occupancy`
- Create: `apps/web/src/features/occupancy/OccupancyBadge.tsx` (member home and member check-in screen), `useOccupancy.ts`
- Modify: `apps/web/src/features/desk/PresentList.tsx` (count vs capacity), `el.json`, `en.json`
- Test: `apps/api/test/occupancy.e2e.spec.ts`, `OccupancyBadge.spec.tsx`, `useOccupancy.spec.ts`; `e2e/notifications-dashboard.spec.ts`

**Interfaces:**
- `levelFor(present: number, capacity: number): 'quiet' | 'moderate' | 'busy'` (thresholds per Global Constraints).
- Shared: `Occupancy = { level: 'quiet' | 'moderate' | 'busy'; count?: number; capacity?: number } | { level: null }`.
- Route: `GET /gyms/:gymId/occupancy` (`@GymRoles('member', 'trainer', 'reception')`). Members get the count only when allowed; staff always get the count and capacity.
- `useOccupancy`: polls every 60 s while the page is visible.
- `OccupancyBadge`: "Ήσυχα" / "Μέτρια" / "Πολύς κόσμος", with an icon and text (never colour alone), plus "· 23 άτομα" when the count is present.

- [ ] **Step 1: Write the failing tests:**
  - `levelFor(11, 30)` = `quiet` (36.7 %); `levelFor(12, 30)` = `moderate` (40 %); `levelFor(23, 30)` = `busy` (76.7 %).
  - With no capacity → a member gets `{ level: null }`.
  - With `show_occupancy_count` off, the member response body has no `count` key and no digits other than in field names. *(Review Focus 5)* With it on → `count` is present.
  - An invalid check-in and a check-in older than the auto check-out window don't count. *(Review Focus 5)*
  - Staff always get the count.
  - The badge shows the text for each level; the hook refetches after 60 s.
  - E2E: owner sets capacity 10 and reminder days 5 → a member whose membership ends in 5 days → the test calls the reminders run through a test-only endpoint enabled only when `NODE_ENV=test` → Mailpit has one Greek reminder email → running it again adds none → three members check in → a member sees "Μέτρια" → the owner's dashboard shows today's visitors = 3.
- [ ] **Step 2: Run** `pnpm --filter api test occupancy && pnpm --filter web test occupancy && pnpm e2e` → FAIL.
- [ ] **Step 3: Implement.** Run ui-ux-reviewer.
- [ ] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm -r test && pnpm e2e` → PASS.
- [ ] **Step 5: Manual check** with the real phones through the tunnel:
  - The iPhone (installed app) and the Android phone enable notifications from the settings page.
  - Trigger the reminders run for a member whose membership ends in 5 days; the push arrives on both with the app closed, and tapping it opens the membership screen.
  - Also do the open phase 4b check: offline workout logging and typing `22,5`.
  - Record both in `PROGRESS.md`.
- [ ] **Step 6: Commit** `feat: occupancy indicator for members and staff`.

---

## Self-review notes

- **Spec coverage:**
  - §6.1 reminders N days before and on the expiry day, plus visit pack low → T1, T2.
  - §6.11 channels email (always) + push (if installed and allowed), events (expiring, expired, visits low, new plan; class reminder → phase 6) → T1, T2, T3.
  - §2 anti-goal "members miss reminders because they didn't install the app" → email on by default, push optional.
  - §6.9 dashboard → T4, T5. §6.2 occupancy → T6.
- **Before deployment** (still open in PROGRESS.md): a production SMTP provider and sender domain, VAPID keys kept secret, `trust proxy`, `S3_PUBLIC_ENDPOINT`, and the SameSite/`COOKIE_PATH` proxy setup.
