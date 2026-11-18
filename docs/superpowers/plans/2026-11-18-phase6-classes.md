# Phase 6: Group Classes and Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- The owner defines class types (spinning, pilates…) and a weekly timetable with trainer, room, time and capacity.
- Members with classes in their membership book and cancel spots.
- Trainers and reception take attendance, and a member with a class pack who arrives for a booked class is let in at the kiosk.
- Members get a reminder before each class, and a notice if a class is cancelled.

**Architecture:** Builds on phase 5 (`main` at a495815). The timetable is stored as weekly **class series** (like shifts) that a job materialises into concrete **class sessions** 28 days ahead, so bookings attach to a real row. Bookings hold the membership that pays for them. A class-pack entry is **reserved** while booked, and **consumed** on attendance, late cancellation or no-show. Check-in learns about today's bookings, so `classes_only` members are let in for their class. Class notifications reuse phase 5's `NotificationService` and dedupe keys.

**Tech Stack:** as phase 5. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-15-gym-management-design.md` §6.1 (class packs, includes classes), §6.2 (check-in), §6.8 (group classes), §6.11 (class booking reminder), §12 (2 h cancellation cut-off, no waitlist in v1). Earlier decisions: phase 2b (class packs show `classes_only` at the door until this phase), phase 3 (series and override pattern, `expandShifts`), phase 5 (notifications, dedupe, job pattern).

## Global Constraints

- All earlier Global Constraints still apply.
- **Class types:** `name` (Greek, required), `name_en`, `description` ≤ 500, `default_capacity` 1–200, `default_duration_minutes` 15–240, archived instead of deleted.
- **Series:** `weekday` (ISO), `starts_at` (`HH:MM`, steps of 5), `duration_minutes`, `capacity`, `trainer_id` (must hold the trainer role), `room` ≤ 40, `valid_from`, `valid_until`. Editing "from date X" ends the old series at X − 1 and creates a new one, as with shifts.
- **Sessions:** materialised for `today … today + 27` (gym dates) by the hourly job and right after any series change. Unique `(series_id, date)`. One-off sessions have no series. Changing or ending a series affects only **future sessions without bookings** directly. Future sessions that have bookings are **cancelled** (bookings cancelled with no charge, members notified), and a new session is created for the new times. Past sessions never change.
- **Booking window:** from **14 days** before start until the session starts. At most **one booking per member per session**.
- **Eligibility** on the session's date:
  - (a) a non-voided membership with `includes_classes` (other than a `classes` pack) that covers that date and isn't frozen on it → no entry is used; or
  - (b) a `classes` pack with **available** entries = `visits_total − visits_used − (its bookings still in status booked)`, valid on that date.
  - (a) wins over (b). Otherwise → `409 { message: 'No membership for classes' }`.
- **Capacity:** booking locks the session row (`FOR UPDATE`). Booked plus attended < capacity, else `409 { message: 'Class full' }`. No waitlist (spec §12).
- **Cancelling:**
  - More than `gyms.class_cancel_cutoff_minutes` (default **120**, 0–1440) before start → `cancelled`; the reservation is released.
  - Later → `late_cancelled`; a class-pack entry is consumed.
  - Staff can cancel for a member at any time with no charge.
- **Attendance** (statuses: `booked` → `attended` | `no_show` | `cancelled` | `late_cancelled`):
  - The class's trainer or reception marks it.
  - A valid kiosk or manual check-in from **60 min before** start until **15 min after** start marks the member's booking for that session `attended` automatically.
  - Marking `attended` consumes the pack entry (when the booking is paid by a pack).
  - **No-show:** 30 min after a session ends, the job marks remaining `booked` bookings `no_show` and consumes pack entries.
  - All consumption is `UPDATE memberships SET visits_used = visits_used + 1 WHERE id = $1 AND visits_used < visits_total`, done once per booking (tracked by `bookings.entry_consumed`).
- **Check-in change:** `decideCheckIn` gets a second input, today's bookings. If no gym entry is valid but the member has a `booked` booking whose check-in window (−60 / +15 min) contains now → valid, with `useMembershipId` = the booking's membership, `consumeVisit: false`, and the booking marked attended. Otherwise unchanged (still `classes_only` without a booking).
- **Session cancelled by staff:** all `booked` bookings → `cancelled`, no consumption, one `class.cancelled` notification per member (dedupe `class_cancelled:<sessionId>:<memberId>`).
- **Notifications:** new events `class.reminder` (sent when a booked session starts within **2 hours**; dedupe `class_reminder:<bookingId>`) and `class.cancelled`, in a new preference group `classes`. The reminder job also runs every **15 minutes** for class reminders (the hourly membership job is unchanged).
- New history actions: `class_type.created/updated/archived`, `class_series.created/ended`, `class_session.created/cancelled`, `booking.cancelled_by_staff`, `attendance.marked`. Member bookings and cancellations live in `class_bookings` and aren't copied to the history.

## Review Focus

1. **Last spot:** two members booking the last spot at the same moment → one `201`, one `409 Class full`; booked never exceeds capacity. (Task 2)
2. **Class pack reservations:** with 1 entry left, a member can book one future class but not a second (`409`). An on-time cancel frees the entry. A late cancel consumes it. Attendance consumes it only once, even if marked twice or auto-marked by check-in and then marked by the trainer. (Tasks 2, 3)
3. **Cancelled session:** the owner cancels a session with 5 bookings → all cancelled, no entries consumed, each member notified exactly once, even if the cancel is retried. (Tasks 1, 4)
4. **Door access for class-pack members:** a member whose only membership is a class pack checks in at the kiosk 30 min before their booked class → green, and the booking is `attended`. 2 hours before → still `classes_only`. Without a booking → `classes_only`. (Task 3)
5. **No-show job twice:** running the no-show pass twice consumes each no-show's entry once. A class at 09:00 Athens on 2027-03-28 (the DST day) is materialised at 09:00 local and gets its no-show pass at 10:15 local (09:00 + 45 min duration + 30 min). (Tasks 1, 3)

---

### Task 1: Class types, timetable series, sessions (API)

**Files:**
- Create: `apps/api/src/db/schema/class-types.ts`, `class-series.ts`, `class-sessions.ts`; migration `0026_classes.sql` (also `gyms.class_cancel_cutoff_minutes`)
- Create: `apps/api/src/classes/classes.module.ts`, `class-types.controller.ts`, `timetable.controller.ts`, `timetable.service.ts`, `materialise.ts`, `classes.job.ts`
- Modify: gym settings controller + shared schema (`classCancelCutoffMinutes`); `staff.service.ts` (removing a trainer role: their future sessions keep running with `trainer_id = null`, shown as "χωρίς γυμναστή")
- Create: `packages/shared/src/schemas/classes.ts`; Modify: `audit.ts`
- Test: `apps/api/test/classes/materialise.spec.ts`, `apps/api/test/timetable.e2e.spec.ts`, `apps/api/test/db/rls.spec.ts` (extend)

**Interfaces:**
- Tables (gym-owned, RLS):
  - `class_types(…)`.
  - `class_series(id, gym_id, class_type_id, weekday, starts_at time, duration_minutes, capacity, trainer_id NULL, room NULL, valid_from, valid_until NULL, created_by, created_at)`.
  - `class_sessions(id, gym_id, class_type_id, series_id NULL, date, starts_at time, ends_at time, starts_at_utc timestamptz, ends_at_utc timestamptz, capacity, trainer_id NULL, room NULL, cancelled_at NULL, cancel_reason NULL, UNIQUE (series_id, date))`, indexes `(gym_id, date)` and `(gym_id, starts_at_utc)`. The UTC columns are computed from the gym time zone at materialisation; they're what jobs compare with "now".
- `materialiseSeries(series: readonly ClassSeries[], existing: readonly { seriesId; date }[], from: string, to: string): { seriesId; date; startsAt; endsAt; capacity; trainerId; room; classTypeId }[]`. Pure: occurrences not yet existing, reusing `isoWeekday` and `addDays`.
- `localToUtc(date: string, time: string, tz: string): Date`. Pure; handles DST using `Intl` (no date library).
- Routes:
  - Owner: `GET/POST/PATCH /gyms/:gymId/class-types` (+ `/archive`); `POST /gyms/:gymId/class-series`; `POST /gyms/:gymId/class-series/:id/end` `{ lastDate }`; `POST /gyms/:gymId/class-sessions` (one-off); `POST /gyms/:gymId/class-sessions/:id/cancel` `{ reason }`. Reception also gets the cancel route.
  - Read: `GET /gyms/:gymId/class-sessions?from=&to=` (any gym role; ≤ 31 days) → `ClassSessionView[]` (`id, date, startsAt, endsAt, type: { name, nameEn }, trainer: { firstName } | null, room, capacity, booked, cancelled, myBooking?: { id, status }`).
- `ClassesJob`: hourly → materialise for every gym. After a series change, the service materialises immediately for that gym.
- Cancelling a session or ending a series cancels the affected bookings (Task 2 adds the booking table; leave a hook, and Task 2 extends these tests).

- [ ] **Step 1: Write the failing tests:**
  - `materialiseSeries`: a Wednesday 18:00 series from `2027-05-05`, range `2027-05-01..2027-05-28` → 05-05, 05-12, 05-19, 05-26; with 05-12 already existing → three new.
  - `localToUtc('2027-03-28', '09:00', 'Europe/Athens')` = `2027-03-28T06:00:00Z` (UTC+3 after the switch); `localToUtc('2027-03-27', '09:00', …)` = `07:00Z`. *(Review Focus 5)*
  - API: the owner creates a type and a series → sessions exist for 28 days; running the job again creates none.
  - Ending the series from next week → next week's sessions without bookings are removed; past sessions stay.
  - A one-off session appears in the list. Reception can cancel, a trainer can't (`403`). Members can list (`200`).
  - Range over 31 days → `400`; capacity 0 → `400`; a non-trainer as `trainer_id` → `404`.
  - Two-gym isolation for the three tables.
- [ ] **Step 2: Run** `pnpm --filter api test classes timetable` → FAIL.
- [ ] **Step 3: Implement.** Consult database-expert (UTC columns, indexes).
- [ ] **Step 4: Run** `pnpm --filter api test` → PASS.
- [ ] **Step 5: Commit** `feat: class types, timetable series and materialised sessions`.

---

### Task 2: Bookings (API)

**Files:**
- Create: `apps/api/src/db/schema/class-bookings.ts`, migration `0027_class_bookings.sql`
- Create: `apps/api/src/classes/bookings.controller.ts`, `bookings.service.ts`, `class-eligibility.ts`
- Modify: `timetable.service.ts` (cancel hooks), `apps/api/src/memberships/status.ts` or `remaining` callers (a class pack's `remaining.visits` subtracts reserved bookings, see Global Constraints)
- Test: `apps/api/test/classes/class-eligibility.spec.ts`, `apps/api/test/bookings.e2e.spec.ts`, `apps/api/test/db/rls.spec.ts` (extend)

**Interfaces:**
- Table `class_bookings(id, gym_id, session_id FK, member_id FK users, membership_id NULL FK memberships, status text CHECK, entry_consumed bool NOT NULL DEFAULT false, booked_at, cancelled_at NULL, attended_at NULL, marked_by NULL FK users, booked_by FK users)`. Partial unique index `(session_id, member_id) WHERE status IN ('booked','attended')`. Index `(gym_id, member_id, status)`. RLS.
- `classEligibility(ms: readonly Membership[], reservedByMembership: Record<string, number>, sessionDate: string): { ok: true; membershipId: string; usesEntry: boolean } | { ok: false }`. Pure; rule (a) before (b).
- Routes:
  - Member: `POST /gyms/:gymId/class-sessions/:id/bookings` → `201`. `DELETE /gyms/:gymId/me/bookings/:id` → `200 { status: 'cancelled' | 'late_cancelled' }`. `GET /gyms/:gymId/me/bookings?upcoming=true`.
  - Reception: `POST /gyms/:gymId/class-sessions/:id/bookings` with `{ memberId }` (booking for a member). `DELETE /gyms/:gymId/bookings/:id` (no charge; `booking.cancelled_by_staff` history).
  - Staff read: `GET /gyms/:gymId/class-sessions/:id/attendees` (the class's trainer or reception) → `{ bookingId, member: { id, firstName, lastName, photoUrl }, status }[]`.
- Errors: `409 Class full`, `409 No membership for classes`, `409 Already booked`, `400` outside the 14-day window or after start, `410` for a cancelled session.

- [ ] **Step 1: Write the failing tests:**
  - `classEligibility`:
    - A time membership with classes → ok, `usesEntry: false`.
    - A class pack with 1 left and 1 reserved → not ok; with 2 left and 1 reserved → ok, `usesEntry: true`.
    - Both kinds present → the time membership is used.
  - API:
    - A member with a class pack (1 entry) books session A → `201`; books session B → `409 No membership for classes`. *(Review Focus 2)*
    - Cancels A 3 h before → `cancelled`; books B → `201`. Cancels B 1 h before → `late_cancelled`, and `visits_used` goes up by 1. *(Review Focus 2)*
    - Capacity 1: two members book concurrently → `201` + `409 Class full`. *(Review Focus 1)*
    - Booking twice → `409 Already booked`. Booking 15 days ahead → `400`. Booking after start → `400`.
    - The owner cancels a session with 3 bookings → all `cancelled`, `visits_used` unchanged. *(Review Focus 3)*
    - Ending a series with a booked future session → that session is cancelled and its bookings cancelled.
    - Reception books for a member → `201`, `booked_by` = reception. A trainer who doesn't run the class `GET attendees` → `403`.
    - Two-gym isolation.
- [ ] **Step 2: Run** `pnpm --filter api test bookings class-eligibility` → FAIL.
- [ ] **Step 3: Implement.** Lock order: the session row, then the member (`lockMember`), then the membership. Consult database-expert.
- [ ] **Step 4: Run** `pnpm --filter api test` → PASS.
- [ ] **Step 5: Commit** `feat: class bookings with capacity, reservations and cancellation rules`.

---

### Task 3: Attendance, no-shows, door access

**Files:**
- Create: `apps/api/src/classes/attendance.controller.ts`, `attendance.service.ts`
- Modify: `apps/api/src/checkin/decide.ts` (second input), `checkin.service.ts` (load today's bookings; mark attended in the same transaction), `classes.job.ts` (no-show pass), shared `CheckInResult` (`classBooking?: { sessionId, typeName, startsAt }`)
- Test: `apps/api/test/checkin/decide.spec.ts` (extend), `apps/api/test/attendance.e2e.spec.ts`

**Interfaces:**
- `decideCheckIn(ms: readonly Membership[], bookingsNow: readonly { bookingId: string; membershipId: string | null }[] = []): CheckInDecision`. The existing rules first; then, if a booking is in its window → `{ valid: true, useMembershipId: booking.membershipId ?? first active membership with classes, consumeVisit: false, bookingId }`. The existing tests stay green without a second argument.
- `AttendanceService.mark(gymId, bookingId, status: 'attended' | 'no_show', byUserId): Promise<void>`. Idempotent: consumes an entry once (`entry_consumed`).
- Routes: `POST /gyms/:gymId/bookings/:id/attendance` `{ status }` (the class's trainer or reception) → `204` + `attendance.marked`.
- No-show pass: for sessions with `ends_at_utc + 30 min ≤ now` and not cancelled → `booked` → `no_show`, consuming entries.

- [ ] **Step 1: Write the failing tests:**
  - `decideCheckIn`: only a class pack with a booking in the window → valid with no visit consumed; the same without a booking → `classes_only`; a time membership still wins.
  - Kiosk check-in by a class-pack-only member 30 min before their booked class → green; the booking is `attended` with `entry_consumed`; `visits_used + 1`. *(Review Focus 4)*
  - 2 hours before → `classes_only`, booking still `booked`. *(Review Focus 4)*
  - The trainer then marks `attended` → no second consumption. *(Review Focus 2)*
  - The no-show pass at end + 30 min marks the rest `no_show` and consumes; running it twice → consumed once. *(Review Focus 5)*
  - DST day: a 09:00 session of 45 min is processed by the pass at 10:15 local (07:15Z), not at 09:45 local. *(Review Focus 5)*
  - Reception marks `no_show` → `204`; a member → `403`.
- [ ] **Step 2: Run** `pnpm --filter api test attendance decide checkin` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter api test` → PASS.
- [ ] **Step 5: Commit** `feat: class attendance, no-shows and door access for booked classes`.

---

### Task 4: Class notifications

**Files:**
- Modify: shared `NOTIFICATION_EVENTS` (+ `class.reminder`, `class.cancelled`), `NOTIFICATION_GROUPS` (+ `classes`), `groupOfEvent`; `notification-prefs` CHECK (migration `0028_class_notifications.sql`); templates (el/en); `classes.job.ts` (a 15-minute reminder pass); `timetable.service.ts` (notify on cancel, after commit)
- Modify: `apps/web/src/features/notifications/NotificationSettingsPage.tsx` (the `Μαθήματα` group)
- Test: `apps/api/test/class-notifications.e2e.spec.ts`, the settings page spec (extend)

**Interfaces:**
- Reminder pass: bookings with status `booked` whose session `starts_at_utc` is within `(now, now + 2 h]` and not cancelled → `notify('class.reminder', dedupe class_reminder:<bookingId>)`. The push `url` is `/classes/my`.
- Cancel: after commit, `notify('class.cancelled', dedupe class_cancelled:<sessionId>:<memberId>)` for each booking that was `booked`.

- [ ] **Step 1: Write the failing tests:**
  - A booking for 18:00: the pass at 15:50 → nothing; 16:05 → one reminder; 16:20 → none (dedupe).
  - A member with the `classes` group switched off for email and push → no reminder, and no dedupe row.
  - Cancelling a session with 2 bookings → 2 `class.cancelled`; retrying the cancel → 0 more. *(Review Focus 3)*
  - The settings page shows the `Μαθήματα` toggles.
- [ ] **Step 2: Run** `pnpm --filter api test class-notifications && pnpm --filter web test notifications` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: class reminders and cancellation notices`.

---

### Task 5: Web, timetable management and session detail (owner, reception)

**Files:**
- Create: `apps/web/src/features/classes/ClassTypesPage.tsx`, `TimetablePage.tsx` (week view), `ClassSeriesDialog.tsx`, `ClassSessionDialog.tsx` (one-off), `SessionDetailPage.tsx` (attendees, mark attendance, book for a member, cancel session)
- Modify: owner and reception nav (`classes`), `apps/web/src/features/desk/CheckInCard.tsx` (shows "Μάθημα: Spinning 18:00" when the check-in came from a booking), gym settings page (cancellation cut-off), router, `el.json`, `en.json`
- Test: one `*.spec.tsx` per component

**Interfaces:**
- `TimetablePage`: Monday–Sunday columns with session blocks (time, type, trainer, `booked/capacity`, cancelled struck through). Owner: add series or one-off, and "αλλαγή από αυτή τη μέρα" / "ακύρωση αυτής της μέρας" like the shift grid. Reception: view and open sessions. On phones: a day list.
- `SessionDetailPage`: an attendee list with photo and status chips, mark attended/no-show buttons (44 px), "Κράτηση για μέλος" (member search reuse), and "Ακύρωση μαθήματος" with a reason and a warning ("Θα ειδοποιηθούν N μέλη").

- [ ] **Step 1: Write the failing tests:** blocks show `booked/capacity`; a cancelled session is struck through; the cancel dialog shows the number of members to be notified; marking attended calls the API and updates the chip; the desk card shows the class line when `classBooking` is present.
- [ ] **Step 2: Run** `pnpm --filter web test classes desk` → FAIL.
- [ ] **Step 3: Implement.** Run ui-ux-reviewer.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): class timetable management and session detail`.

---

### Task 6: Web, trainer's classes

**Files:**
- Create: `apps/web/src/features/classes/MyClassesPage.tsx` (trainer)
- Modify: trainer shell nav (`classes`), `MySchedulePage.tsx` (classes listed alongside shifts), router, `el.json`, `en.json`
- Test: `MyClassesPage.spec.tsx`

**Interfaces:**
- `MyClassesPage`: today's and the next 7 days' classes the trainer runs. Today's sessions open straight into an attendance view (reusing `SessionDetailPage` without the owner actions).

- [ ] **Step 1: Write the failing tests:** only the trainer's sessions are listed; today's session opens the attendance view; past sessions are read-only.
- [ ] **Step 2: Run** `pnpm --filter web test MyClasses` → FAIL.
- [ ] **Step 3: Implement.** Run ui-ux-reviewer (tablet and phone).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): trainer's classes and attendance`.

---

### Task 7: Web, member booking

**Files:**
- Create: `apps/web/src/features/classes/ClassTimetablePage.tsx` (member: "Μαθήματα"), `BookingButton.tsx`, `MyBookingsPage.tsx` (`/classes/my`)
- Modify: member shell nav, member home (next booked class card), router, `el.json`, `en.json`
- Test: one `*.spec.tsx` per component; `e2e/classes.spec.ts`

**Interfaces:**
- `ClassTimetablePage`: day tabs for the next 14 days; session cards (time, type, trainer, room, spots left "3 θέσεις", "Πλήρες").
- `BookingButton` states:
  - "Κράτηση".
  - "Κλεισμένο ✓ · Ακύρωση". Inside the cut-off, the cancel confirm warns "Η ακύρωση τώρα χρεώνει μία είσοδο από το πακέτο σου" (only when paid by a pack).
  - "Πλήρες" (disabled).
  - "Χρειάζεσαι συνδρομή με μαθήματα" (disabled, with a "ρώτα στη ρεσεψιόν" hint).
- `MyBookingsPage`: upcoming bookings with cancel, and past ones with status (παρών / δεν ήρθε / ακυρώθηκε).
- The member home shows "Επόμενο μάθημα: Pilates, Τρίτη 18:00".

- [ ] **Step 1: Write the failing tests:** each button state renders from API data; the late-cancel warning appears only inside the cut-off and only for pack-paid bookings; a `409 Class full` response turns the card to "Πλήρες"; the home card shows the next booking.
  - E2E: the owner creates a spinning series (capacity 2) and sells two members a class pack (1 entry each) and a third a membership with classes → members 1 and 2 book → member 3 sees "Πλήρες" → member 1 cancels on time → member 3 books → member 2 checks in at the kiosk 30 min before → green, and the desk shows the class line → after the class, the no-show pass marks member 3 as no-show → member 2 sees "παρών" in their bookings.
- [ ] **Step 2: Run** `pnpm --filter web test classes && pnpm e2e` → FAIL.
- [ ] **Step 3: Implement.** Run ui-ux-reviewer (375 px, Greek, dark mode).
- [ ] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm -r test && pnpm e2e` → PASS.
- [ ] **Step 5: Manual check** on the phones through the tunnel:
  - Book a class on the iPhone and get the reminder push 2 hours before (use a class starting about 2 hours from now).
  - Check in at the kiosk with a class-pack-only member.
  - If still open: do the phase 4b and 5 phone checks too.
  - Record everything in `PROGRESS.md`.
- [ ] **Step 6: Commit** `feat(web): member class timetable and bookings`.

---

## Self-review notes

- **Spec coverage:**
  - §6.8: class types and schedule with trainer, room, time, capacity → T1, T5; members with classes book and cancel up to a cut-off → T2, T7; a late cancellation or no-show uses an entry → T2, T3; the trainer and reception see the list and take attendance by check-in or ticking → T3, T5, T6.
  - §6.1: class packs count down; includes-classes memberships → T2.
  - §6.11: the class booking reminder → T4.
  - §12: no waitlist; 2 h cut-off configurable → T1, T2.
  - §6.2: the door for class-pack members → T3.
- **Phase 5 deferred minor touched:** a day pass in reminders stays as is. The phase 7 plan (GDPR, polish, pilot, deployment) follows.
