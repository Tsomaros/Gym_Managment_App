# Phase 3: Staff, Shifts, Trainer Assignment and Cover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner manages staff and their shifts. Everyone sees the schedules they're allowed to see, and the app knows who is on duty now. Reception assigns each member a primary trainer and, on the day, an on-duty cover trainer. A single access helper decides which trainer may see which member, ready for the plans in phase 4.

**Architecture:** Builds on phase 2b (`main` at 333ec15). Shifts are stored as weekly **series** plus dated **shift rows** (one-offs and per-day overrides of a series). A pure `expandShifts` turns them into concrete shifts for a date range. Trainer links (`member_trainers`) and day covers (`trainer_covers`) are gym-owned tables. Whether a link is *paused* is computed from memberships, not stored.

**Tech Stack:** as phase 2b. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-15-gym-management-design.md` §5, §6.3, §6.4, §6.10. Earlier decisions: the ledgers in `docs/superpowers/plans/`.

## Global Constraints

- All earlier Global Constraints still apply (RLS with a two-gym isolation test per new gym-owned table, history in the same transaction, gym-local dates via `todayIn` and `Clock`).
- **Shift times** are `time` columns in gym-local time, with `ends_at > starts_at`: shifts don't cross midnight. Weekday numbering is ISO: 1 = Monday … 7 = Sunday.
- **A shift series** covers dates from `valid_from` to `valid_until` (NULL = open-ended). Editing a series "from date X" ends the old series at X − 1 and starts a new one at X. Past dates never change.
- **Overrides:** a shift row with `series_id` set and `date` D replaces that series' occurrence on D (other times, or `cancelled = true`). A shift row without `series_id` is a one-off.
- **On duty now** = a staff member whose expanded shift today (gym date) satisfies `starts_at ≤ local time < ends_at`.
- Schedule queries span at most **62 days** (`400` otherwise).
- `gyms.reception_can_edit_shifts boolean NOT NULL DEFAULT false`, owner-editable (spec §6.3 "or reception, if allowed").
- **Primary trainer:** at most one per member per gym. It can be assigned only while the member has a non-voided `active`, `frozen` or `upcoming` membership with `includes_trainer`; otherwise `409`. The link is **paused** while no such membership exists, and resumes by itself on renewal (spec §6.4).
- **Cover:** for one gym date only, the trainer must be on duty at the moment of assigning, and at most one cover per member per date. It ends at the end of that gym date, with no clean-up job.
- **Trainer access helper** (used by phase 4): `trainerAccess(tx, gymId, trainerId, memberId, today): 'primary' | 'cover' | null`.
  - `'primary'`: an unpaused primary link exists.
  - `'cover'`: a cover for `today` exists.
  - A paused primary link gives `null`, unless there is a cover.
- **Removing a staff role:**
  - Removing a trainer ends their primary links and their covers from today on, and deletes their future shift occurrences.
  - Removing the last owner → `409`.
  - The person's other roles and member data are untouched.
- Trainers see today's visitors (spec §5); check-out stays reception-only.
- New history actions: `staff.role_removed`, `invitation.cancelled`, `shift_series.created`, `shift_series.ended`, `shift.created`, `shift.updated`, `shift.cancelled`, `trainer.assigned`, `trainer.unassigned`, `cover.assigned`, `cover.removed`.

## Review Focus

1. **Editing a weekly shift from next week:** past and current-week occurrences keep their old times; future weeks show the new ones; an override on an old-series date isn't lost. (Tasks 2, 3)
2. **Shift edges:** for a 06:00–14:00 shift, the person is on duty at 13:59 and **not** at 14:00. On 2027-03-28 (the DST switch) a 06:00–14:00 shift is still 06:00–14:00 local. (Tasks 2, 3)
3. **Cover expiry:** a cover assigned for 2027-05-12 gives `'cover'` at 23:59 Athens on the 12th and `null` at 00:00 on the 13th. (Task 5)
4. **Paused link:** the member's trainer membership expires → `trainerAccess` is `null`, and the trainer's client list shows the member as paused. A renewal sold with trainer → `'primary'` again, with no re-assignment. (Task 4)
5. **Removing a trainer:** their clients become unassigned, today's and future covers go, future shifts disappear, and their next request to a gym route gets `403`. Removing the only owner → `409`. (Task 1)

---

### Task 1: Staff management API (and trainers see today's visitors)

**Files:**
- Create: `apps/api/src/staff/staff.module.ts`, `staff.controller.ts`, `staff.service.ts`
- Modify: `apps/api/src/invitations/invitations.service.ts` + controller (cancel), `apps/api/src/checkin/presence.controller.ts` (visitors: `@GymRoles('trainer', 'reception')`)
- Create: `packages/shared/src/schemas/staff.ts`; Modify: `audit.ts`, `index.ts`
- Test: `apps/api/test/staff.e2e.spec.ts`, `apps/api/test/presence.e2e.spec.ts` (extend)

**Interfaces:**
- Shared: `StaffMember { userId, firstName, lastName, email, phone, roles: ('owner'|'reception'|'trainer')[], since: string }`; `PendingInvitation { id, email, firstName, lastName, roles, expiresAt }`.
- Routes:
  - `GET /gyms/:gymId/staff` (`@GymRoles('reception')`) → `{ staff: StaffMember[]; pending: PendingInvitation[] }`. Reception gets `pending: []`.
  - `DELETE /gyms/:gymId/staff/:userId/roles/:role` (`@GymRoles('owner')`, role ∈ owner|reception|trainer) → `204`. In one transaction, lock the gym's owner rows (`FOR UPDATE`) to count owners safely, then apply the removal rules from Global Constraints and write `staff.role_removed`. The shift and cover clean-up hooks are added in Tasks 3 and 5. Leave a marker comment, and a test there extends this suite.
  - `POST /gyms/:gymId/invitations/:id/cancel` (`@GymRoles('owner')`) → `204` + `invitation.cancelled`; the token stops working (`410` on accept).

- [x] **Step 1: Write the failing tests:**
  - The staff list shows the owner and an accepted trainer with roles; a member-only person isn't listed; the owner sees a pending invite and reception doesn't.
  - Remove the trainer role from a trainer who is also a member → `204`; their gym route as trainer → `403`; their member routes still work; one `staff.role_removed` row.
  - The only owner removing their own owner role → `409`. Two owners removing each other concurrently (`Promise.all`) → exactly one `204` and one `409`.
  - Reception removing a role → `403`. Removing `member` through this route → `400`.
  - Cancelled invite → accept gives `410`.
  - A trainer `GET /check-ins?date=` → `200`; a trainer check-out → `403`.
- [x] **Step 2: Run** `pnpm --filter api test staff presence` → FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run** `pnpm --filter api test` → PASS.
- [x] **Step 5: Commit** `feat: staff list, role removal, invitation cancel`.

---

### Task 2: Shift model and expansion (pure)

**Files:**
- Create: `apps/api/src/shifts/expand.ts`
- Create: `packages/shared/src/schemas/shifts.ts`
- Test: `apps/api/test/shifts/expand.spec.ts`

**Interfaces:**
- Shared:
  - `ShiftSeries { id, staffId, weekday: 1..7, startsAt: 'HH:MM', endsAt: 'HH:MM', validFrom, validUntil: string | null }`.
  - `ShiftRow { id, staffId, date, startsAt, endsAt, seriesId: string | null, cancelled: boolean, note: string | null }`.
  - `ExpandedShift { staffId, date, startsAt, endsAt, seriesId: string | null, shiftId: string | null, note }`.
  - `shiftTimeSchema` (`HH:MM`, 00:00–23:59, minutes in steps of 5).
- `expandShifts(series: readonly ShiftSeries[], rows: readonly ShiftRow[], from: string, to: string): ExpandedShift[]`, sorted by date, then `startsAt`, then `staffId`. Algorithm:
  1. For each date `d` in `[from, to]` and each series with `isoWeekday(d) = weekday` and `validFrom ≤ d ≤ (validUntil ?? ∞)`, emit an occurrence.
  2. Then, for each row with `seriesId` and `date = d`: if `cancelled`, drop that occurrence; otherwise replace its times and set its `shiftId`.
  3. Then add each one-off row (`seriesId = null`, not cancelled) dated in range.
- `isOnDuty(shifts: readonly ExpandedShift[], staffId: string, date: string, time: 'HH:MM'): boolean`. The start is inclusive, the end exclusive.
- `isoWeekday(date: string): 1..7`.

- [x] **Step 1: Write the failing tests** (values by hand):
  - Series Monday 06:00–14:00 from `2027-05-03`, expanded over `2027-05-01..2027-05-16` → `2027-05-03` and `2027-05-10` only.
  - The same series with `validUntil 2027-05-09` → only `2027-05-03`. A second series Monday 08:00–16:00 from `2027-05-10` → `05-03` at 06:00 and `05-10` at 08:00. *(Review Focus 1)*
  - Override row for `2027-05-10` with 10:00–18:00 → that day shows 10:00–18:00 with its `shiftId`. A cancelled override → the day is gone.
  - One-off `2027-05-05` 09:00–12:00 is included; a one-off outside the range isn't.
  - `isOnDuty(…, '13:59')` true, `'14:00'` false, `'06:00'` true. *(Review Focus 2)*
  - `isoWeekday('2027-03-28')` = 7 (Sunday, the DST day); a Sunday series 06:00–14:00 on that date expands to 06:00–14:00. *(Review Focus 2)*
  - `shiftTimeSchema`: `'24:00'` rejects, `'09:07'` rejects, `'09:05'` accepts.
- [x] **Step 2: Run** `pnpm --filter api test shifts/expand && pnpm --filter shared test` → FAIL.
- [x] **Step 3: Implement** with ISO date-string arithmetic (reuse `addDays` from `memberships/dates.ts`).
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat: shift series, overrides and expansion rules`.

---

### Task 3: Shifts API, schedule views, on duty now

**Files:**
- Create: `apps/api/src/db/schema/shift-series.ts`, `shifts.ts`; migration `0015_shifts.sql` (also `gyms.reception_can_edit_shifts`)
- Create: `apps/api/src/shifts/shifts.module.ts`, `shifts.controller.ts`, `shifts.service.ts`, `can-edit-shifts.guard.ts`
- Modify: `apps/api/src/gyms/gym-settings.controller.ts` + shared `GymSettingsSchema` (`receptionCanEditShifts`), `apps/api/src/staff/staff.service.ts` (role removal deletes future occurrences)
- Test: `apps/api/test/shifts.e2e.spec.ts`, `apps/api/test/staff.e2e.spec.ts` (extend), `apps/api/test/db/rls.spec.ts` (extend)

**Interfaces:**
- Tables (both gym-owned, RLS, indexed on `(gym_id, staff_id)`):
  - `shift_series(id, gym_id, staff_id FK users, weekday smallint CHECK 1..7, starts_at time, ends_at time CHECK (ends_at > starts_at), valid_from date, valid_until date NULL CHECK (valid_until >= valid_from), created_by, created_at)`.
  - `shifts(id, gym_id, staff_id FK users, date date, starts_at time, ends_at time, series_id NULL FK shift_series, cancelled bool DEFAULT false, note text NULL, created_by, created_at, UNIQUE (series_id, date))`.
- `CanEditShiftsGuard` (after `@GymRoles('reception')`): owners always pass; reception passes only when `reception_can_edit_shifts`; `403` otherwise.
- Routes:
  - Read: `GET /gyms/:gymId/schedule?from=&to=` (`@GymRoles('reception')`) → `{ shifts: ExpandedShift[]; staff: { userId, firstName, lastName, roles }[] }` for all staff.
  - Read: `GET /gyms/:gymId/me/schedule?from=&to=` (`@GymRoles('trainer', 'reception')`) → the caller's own `ExpandedShift[]`.
  - Read: `GET /gyms/:gymId/on-duty` (`@GymRoles('trainer', 'reception')`) → `{ userId, firstName, lastName, roles, until: 'HH:MM' }[]` for right now.
  - Write (`CanEditShiftsGuard`): `POST /gyms/:gymId/shift-series` `{ staffId, weekday, startsAt, endsAt, validFrom, validUntil? }` → `201`. The staff member must hold a staff role in the gym (`404` otherwise), and `validFrom` must be ≥ today (`400`).
  - Write: `POST /gyms/:gymId/shift-series/:id/end` `{ lastDate }` → `204`. Sets `valid_until = lastDate` (≥ today − 1, and ≥ `valid_from`, else `400`) and deletes override rows after `lastDate`. "Edit from X" in the UI = end at X − 1 plus create a new series from X.
  - Write: `POST /gyms/:gymId/shifts` `{ staffId, date, startsAt, endsAt, note? }` → one-off.
  - Write: `PUT /gyms/:gymId/shift-series/:id/occurrences/:date` `{ startsAt, endsAt, note? } | { cancelled: true }` → upserts the override.
  - Write: `PATCH /gyms/:gymId/shifts/:id` and `DELETE /gyms/:gymId/shifts/:id` (one-offs). Past dates are read-only (`409`).
  - Each write records its history action. The settings `PATCH` accepts `receptionCanEditShifts` (owner only).
- Role removal (Task 1 hook): end the person's series at yesterday (or delete them if they haven't started) and delete their rows dated today or later.

- [x] **Step 1: Write the failing tests** (Clock pinned, gym `Europe/Athens`):
  - Owner creates a Monday series 06:00–14:00. On Monday at 13:59 local, `/on-duty` includes the person `until '14:00'`; at 14:00, not. *(Review Focus 2)*
  - "Edit from next week": end at Sunday plus a new series from Monday 08:00 → `/schedule` shows this week at 06:00 and next week at 08:00. *(Review Focus 1)*
  - Cancel one occurrence → gone from the schedule; uncancel (PUT with times) → back with the new times.
  - Writing a past date → `409`; a series starting yesterday → `400`; a range over 62 days → `400`; `ends_at ≤ starts_at` → `400`.
  - Reception creating a shift → `403`; after the owner sets `receptionCanEditShifts: true` → `201`.
  - A trainer `GET /me/schedule` sees only their own shifts; a trainer `GET /schedule` → `403`.
  - Removing a trainer role (Task 1 route) removes their occurrences from today on but keeps yesterday's. *(Review Focus 5)*
  - Two-gym isolation for both tables; a staff id from gym B → `404`.
- [x] **Step 2: Run** `pnpm --filter api test shifts staff` → FAIL.
- [x] **Step 3: Implement.** Consult database-expert on the schema and indexes.
- [x] **Step 4: Run** `pnpm --filter api test` → PASS.
- [x] **Step 5: Commit** `feat: shift scheduling, schedule views, on-duty now`.

---

### Task 4: Primary trainer assignment

**Files:**
- Create: `apps/api/src/db/schema/member-trainers.ts`, migration `0016_member_trainers.sql`
- Create: `apps/api/src/trainers/trainers.module.ts`, `trainers.controller.ts`, `trainers.service.ts`, `trainer-access.ts`
- Modify: `apps/api/src/members/members.service.ts` (`MemberDetail.trainer`), `apps/api/src/staff/staff.service.ts` (role removal deletes links)
- Modify: `packages/shared/src/schemas/trainers.ts` (new), `members.ts`
- Test: `apps/api/test/trainers.e2e.spec.ts`, `apps/api/test/staff.e2e.spec.ts` (extend), `apps/api/test/db/rls.spec.ts` (extend)

**Interfaces:**
- Table `member_trainers(gym_id, member_id FK users, trainer_id FK users, assigned_at, assigned_by FK users ON DELETE SET NULL, PRIMARY KEY (gym_id, member_id))`, index `(gym_id, trainer_id)`. RLS.
- `hasTrainerMembership(ms: readonly Membership[]): boolean`: some non-voided membership with `includesTrainer` and status `active | frozen | upcoming`.
- `trainerAccess(tx: Tx, gymId: string, trainerId: string, memberId: string, today: string): Promise<'primary' | 'cover' | null>` in `trainer-access.ts`. Covers are added in Task 5; until then it returns `'primary'` or `null`.
- Shared: `MemberDetail.trainer: { userId, firstName, lastName, paused: boolean } | null`; `TrainerClient { memberId, firstName, lastName, photoUrl, paused: boolean, membershipStatus: MemberStatus, assignedAt }`.
- Routes:
  - `PUT /gyms/:gymId/members/:memberId/trainer` (`@GymRoles('reception')`, body `{ trainerId }`) → `200`. The trainer must hold the `trainer` role in this gym (`404` otherwise), and the member must pass `hasTrainerMembership` (`409 { message: 'No membership with personal training' }`). Replaces any existing link. Writes `trainer.assigned` (`data`: previous trainer id).
  - `DELETE /gyms/:gymId/members/:memberId/trainer` (`@GymRoles('reception')`) → `204` + `trainer.unassigned`.
  - `GET /gyms/:gymId/trainer/clients` (`@GymRoles('trainer')`) → the caller's `TrainerClient[]`, paused ones last.
- Role removal (Task 1 hook): delete the trainer's links, with one `trainer.unassigned` row per member.

- [x] **Step 1: Write the failing tests:**
  - Member with a 1-month membership where `includes_trainer = true`: assign trainer T → `200`; `trainerAccess` → `'primary'`; T's client list has the member, not paused; member detail shows T.
  - Member whose only membership lacks the trainer flag → `409`.
  - Pin the Clock past the membership end → the client list shows `paused: true`; `trainerAccess` → `null`. Sell a new trainer membership → `'primary'` again with no new assignment. *(Review Focus 4)*
  - Reassign to trainer U → T's list no longer has the member; history has both assignments.
  - Assigning a gym B trainer → `404`; a trainer calling `PUT` → `403`; a member calling `/trainer/clients` → `403`.
  - Removing T's trainer role → the member has `trainer: null`. *(Review Focus 5)*
  - Two-gym isolation.
- [x] **Step 2: Run** `pnpm --filter api test trainers staff` → FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run** `pnpm --filter api test` → PASS.
- [x] **Step 5: Commit** `feat: primary trainer assignment with paused links`.

---

### Task 5: Day cover

**Files:**
- Create: `apps/api/src/db/schema/trainer-covers.ts`, migration `0017_trainer_covers.sql`
- Create: `apps/api/src/trainers/covers.controller.ts`, `covers.service.ts`
- Modify: `trainer-access.ts`, `trainers.service.ts` (client list includes today's covers), `apps/api/src/checkin/checkin.service.ts` + shared `CheckInResult` (`trainer: { userId, firstName, onDuty: boolean } | null; cover: { trainerId, firstName } | null`), `apps/api/src/staff/staff.service.ts` (role removal deletes covers from today on)
- Test: `apps/api/test/covers.e2e.spec.ts`, `apps/api/test/staff.e2e.spec.ts` (extend), `apps/api/test/db/rls.spec.ts` (extend)

**Interfaces:**
- Table `trainer_covers(id, gym_id, member_id FK users, trainer_id FK users, date date, assigned_by FK users ON DELETE SET NULL, created_at, UNIQUE (gym_id, member_id, date))`. RLS.
- Routes (`@GymRoles('reception')`):
  - `PUT /gyms/:gymId/members/:memberId/cover` `{ trainerId }` → `200`, for **today** (gym date). The trainer must be on duty now (`409 { message: 'Trainer not on duty' }`) and must not be the member's primary trainer (`400`). The member needs no trainer membership check (the cover only reads; spec §6.4). Replaces today's cover. Writes `cover.assigned`.
  - `DELETE /gyms/:gymId/members/:memberId/cover` → `204` + `cover.removed`.
- `trainerAccess` adds `'cover'` when a row for `(gymId, memberId, today)` with this trainer exists. `'primary'` wins when both apply.
- The trainer client list adds today's covered members with `cover: true` (shared `TrainerClient.cover?: boolean`).
- The check-in result carries the member's primary trainer, whether that trainer is on duty now, and any cover today, so the desk can offer "assign cover" (Task 8).

- [x] **Step 1: Write the failing tests** (Clock pinned):
  - On 2027-05-12 at 10:00, trainer U is on duty: assign cover → `200`; `trainerAccess(U)` → `'cover'` at 23:59 Athens; at 00:00 on the 13th → `null`. *(Review Focus 3)*
  - Trainer not on duty → `409`. The member's own primary trainer → `400`. A second cover the same day replaces the first (one row).
  - U's client list on the 12th includes the member with `cover: true`; on the 13th, not.
  - The check-in result for a member whose primary trainer T is off duty → `trainer.onDuty: false`; after the cover → `cover.firstName` = U's.
  - Removing U's trainer role deletes today's cover. *(Review Focus 5)*
  - Two-gym isolation.
- [x] **Step 2: Run** `pnpm --filter api test covers staff` → FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run** `pnpm --filter api test` → PASS.
- [x] **Step 5: Commit** `feat: same-day cover trainers`.

---

### Task 6: Web, staff page

**Files:**
- Create: `apps/web/src/features/staff/StaffPage.tsx`, `InviteStaffDialog.tsx` (reuse the existing invite API), `RemoveRoleDialog.tsx`
- Modify: owner shell (`staff` nav item), reception shell (read-only staff list under `schedule`), router, `el.json`, `en.json`, `apps/web/src/features/settings/GymSettingsPage.tsx` (switch "Η ρεσεψιόν μπορεί να αλλάζει βάρδιες")
- Test: `StaffPage.spec.tsx`, `InviteStaffDialog.spec.tsx`, `RemoveRoleDialog.spec.tsx`

**Interfaces:**
- `StaffPage`: rows with name, role chips, phone (a `tel:` link) and email; a pending invitations section (owner) with cancel; an "Πρόσκληση προσωπικού" button.
- `InviteStaffDialog`: first name, last name, email, role checkboxes (owner / reception / trainer, at least one).
- `RemoveRoleDialog`: per-role removal with a warning text for trainers ("Οι πελάτες του θα μείνουν χωρίς γυμναστή και οι μελλοντικές βάρδιες θα διαγραφούν"). On `409` for the last owner, show a clear message.

- [x] **Step 1: Write the failing tests:** the list renders role chips in Greek; the invite form needs at least one role; removing a trainer role shows the warning before calling the API; a `409` shows the last-owner message; reception sees no invite or remove controls.
- [x] **Step 2: Run** `pnpm --filter web test staff` → FAIL.
- [x] **Step 3: Implement.** Run ui-ux-reviewer.
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat(web): staff page`.

---

### Task 7: Web, schedules

**Files:**
- Create: `apps/web/src/features/schedule/SchedulePage.tsx` (owner and reception), `WeekGrid.tsx`, `ShiftDialog.tsx`, `MySchedulePage.tsx` (trainer and reception), `OnDutyPanel.tsx`
- Modify: `apps/web/src/features/desk/DeskPage.tsx` (add `OnDutyPanel`), shells (`schedule`), router, `el.json`, `en.json`
- Test: one `*.spec.tsx` per component

**Interfaces:**
- `SchedulePage`: week navigation (Monday–Sunday, gym time), with `WeekGrid` rows per staff member and columns per day showing shift blocks (`06:00–14:00`).
  - Editors (owner, or reception with the setting on) click an empty cell → `ShiftDialog` (one-off or "κάθε εβδομάδα"). Clicking a block offers "μόνο αυτή τη μέρα" (override or cancel) or "από αυτή τη μέρα και μετά" (end + new series).
  - Past days are greyed and read-only.
  - On phones (< 640 px), the grid becomes a day list.
- `MySchedulePage`: the next 14 days of the caller's shifts as a list, today highlighted.
- `OnDutyPanel` on the desk: "Σε βάρδια τώρα" with names, roles and the end time, refreshed every minute.

- [x] **Step 1: Write the failing tests:**
  - The grid places a Monday 06:00–14:00 shift under Monday.
  - Choosing "από αυτή τη μέρα και μετά" calls `end` with the previous day, then `POST` a new series with the new times. "μόνο αυτή τη μέρα" calls the occurrence `PUT`.
  - Past cells have no edit action. Reception without the setting sees no edit actions.
  - `OnDutyPanel` lists the API's people with "έως 14:00" and refetches after 60 s (fake timers).
  - At 375 px, the schedule renders as a day list.
- [x] **Step 2: Run** `pnpm --filter web test schedule desk` → FAIL.
- [x] **Step 3: Implement.** Run ui-ux-reviewer (grid readable on a desktop at a glance; day list at 375 px).
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat(web): schedules, my schedule, on-duty panel`.

---

### Task 8: Web, trainer assignment, trainer clients, cover from the desk

**Files:**
- Create: `apps/web/src/features/trainers/AssignTrainerDialog.tsx`, `TrainerClientsPage.tsx` (trainer `members` nav item), `CoverDialog.tsx`
- Modify: `apps/web/src/features/members/MemberDetailPage.tsx` (trainer section), `apps/web/src/features/desk/CheckInCard.tsx` (the trainer line and an "Ανάθεση αντικαταστάτη" button), router, shells, `el.json`, `en.json`
- Test: one `*.spec.tsx` per new or changed component; `e2e/staff-shifts.spec.ts`

**Interfaces:**
- `AssignTrainerDialog`: lists the gym's trainers (from `GET /staff`), marks who is on duty now, and shows the `409` message ("Χρειάζεται συνδρομή με personal trainer") with a "Πώληση συνδρομής" shortcut.
- Member detail trainer section: the trainer's name, a "σε παύση" badge when paused, and change / remove actions.
- `TrainerClientsPage`: cards with photo, name, membership status, a paused badge, and today's covers under a separate heading "Αντικατάσταση σήμερα".
- `CheckInCard`: "Γυμναστής: Νίκος (εκτός βάρδιας)" when off duty, plus the cover button → `CoverDialog`, which lists only trainers on duty now. After assignment it shows "Αντικαταστάτης σήμερα: Ελένη".

- [x] **Step 1: Write the failing tests:**
  - The assign dialog shows the `409` message and the sell shortcut.
  - The member detail shows the paused badge when `trainer.paused` is true.
  - The trainer clients page separates today's covers.
  - A check-in card with `trainer.onDuty: false` shows the off-duty text and the cover button; `CoverDialog` lists only on-duty trainers.
  - E2E: the owner invites a trainer and creates their shift for now → reception sells a membership with trainer and assigns trainer A (not on shift) → the member checks in → the desk shows "εκτός βάρδιας" → reception assigns on-duty trainer B as cover → B's clients page lists the member under today's covers.
- [x] **Step 2: Run** `pnpm --filter web test && pnpm e2e` → FAIL.
- [x] **Step 3: Implement.** Run ui-ux-reviewer on each new or changed component.
- [x] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm -r test && pnpm e2e` → PASS.
- [x] **Step 5: Commit** `feat(web): trainer assignment, trainer clients, cover from the desk`.

---

## Self-review notes

- **Spec coverage:**
  - §6.3: staff accounts and roles → T1, T6; shifts (one-off and weekly) → T2, T3, T7; reception editing if allowed → T3, T6; trainers see their own schedule, reception sees all → T3, T7; on duty now → T3, T7.
  - §6.4: primary trainer, gated by trainer membership, paused and resumed → T4, T8; free workouts for members without a trainer → phase 4; cover for a day, read-only, ends at midnight → T5, T8 (read-only enforcement happens where plans are read, through `trainerAccess`, in phase 4); assignments and covers in history → T4, T5.
  - §5: trainers see today's visitors → T1.
- **Phase 2b deferred minors:** the trainers-see-visitors one is resolved here (T1); the others stay deferred. Before real use, `S3_PUBLIC_ENDPOINT` for photo links is still needed (deployment phase).
