# Phase 2b: Front Desk (Check-in, Kiosk, Live Reception) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members check in by showing a rotating QR code to a paired kiosk tablet (or by name at the desk). Reception sees each check-in live, with photo and a clear warning when a membership isn't valid, plus who's in now, today's visitors and the renewals list.

**Architecture:** Builds on phase 2a (`main` at 62b87b4). A pure `decideCheckIn` function decides validity from the member's memberships (reusing `membershipStatus`/`remaining`). The check-in service records every attempt in `check_ins` and consumes a visit only for valid pack check-ins, under a row lock. Kiosk tablets authenticate as **devices** with a revocable token. Reception gets live events over Server-Sent Events. Member photos live in MinIO (S3 API) and are served through short-lived signed links.

**Tech Stack:** as phase 2a, plus `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, a QR generator for the member screen (`qrcode`), and a browser QR scanner for the kiosk (builder's choice per spec §10; it must work in iPad Safari and Android Chrome).

**Spec:** `docs/superpowers/specs/2026-11-15-gym-management-design.md` §5, §6.0 (photo), §6.1 (renewals list), §6.2, §6.10, §8. Phase 2a decisions: `docs/superpowers/plans/2026-11-16-phase2a-memberships.ledger.md`.

## Global Constraints

- All phase 0–1 and 2a Global Constraints still apply (RLS pattern with an isolation test per new gym-owned table, change history in the same transaction, gym-local dates via `todayIn`, `Clock` for "now").
- **Check-in QR token:** `GYM1.<payload>.<sig>`, where `payload` = base64url JSON `{ "m": memberId, "g": gymId, "x": expiryUnixSeconds }` and `sig` = base64url HMAC-SHA256(`GYM1.<payload>`, `CHECKIN_SECRET`). Valid **45 s**. The member app refreshes it every **30 s**. `CHECKIN_SECRET` is a new env key, at least 32 characters, separate from `JWT_SECRET`.
- **Duplicate scan window:** a second check-in of the same member at the same gym within **2 minutes** records nothing new and returns the earlier result with `duplicate: true`.
- **Kiosk device pairing code:** same alphabet and display format as sign-up codes (`XXXX-XXXX`), valid **15 minutes**, single use, stored hashed. **Device token:** 32 random bytes, base64url, stored as sha256, sent as `Authorization: Device <token>`. It doesn't expire and is revocable by the owner.
- **Auto check-out:** `gyms.auto_checkout_minutes` int, default **120**, range 30–600, owner-editable. "Present" = latest valid check-in today (gym time) with `at > now − auto_checkout_minutes` and not checked out.
- **Which membership a check-in uses:**
  1. Any `active` membership of kind `time` → valid, and no visit is consumed.
  2. Otherwise the `active` `visits` or `day_pass` membership with visits left, ordered by `ends_on` ascending (NULLs last), then `created_at` → valid, and one visit is consumed.
  3. Otherwise invalid. Class packs don't grant gym entry; class attendance comes in phase 6.
- **Invalid reasons**, first match wins: `frozen` (any frozen) → `upcoming_only` (any upcoming) → `classes_only` (any active class pack) → `used_up` (any used up) → `expired` (any expired) → `no_membership`.
- **Live updates:** Server-Sent Events, authorised by a single-use **30 s** stream ticket obtained with the normal bearer token (`EventSource` can't send headers). In-process event bus (comment: `shortcut: in-process events, use Postgres LISTEN/NOTIFY or Redis when running more than one API instance`). *Ruling vs spec §7 "WebSocket":* SSE is one-way, which is all reception needs, and it adds no dependency.
- **Member photo:** the client resizes to at most **800 px**, JPEG quality 0.85. The server accepts JPEG, PNG or WebP (checked by magic bytes), at most **2 MB**. Object key `gyms/<gymId>/members/<memberId>/<uuid>.jpg`. Read through a presigned GET valid **5 minutes**. S3 env keys: `S3_ENDPOINT`, `S3_REGION` (default `us-east-1`), `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`. The bucket is created at startup if missing.
- **Kiosk privacy:** the tablet shows only the member's **first name** and pass/fail. Details go to reception's screen.
- Throttles: `POST /kiosk/check-in` **60 per 60 s per device**; `POST /kiosk/pair` **10 per 60 s per IP**.
- New history actions: `device.paired`, `device.revoked`, `check_in.manual`, `check_in.checked_out`, `member.photo_updated`, `member.photo_removed`, `gym.settings_updated`. Kiosk check-ins are not copied into the history: `check_ins` is their record.

## Review Focus

1. **Replay and cross-gym tokens:** a token older than 45 s, a token with a tampered payload, or a valid token of a gym B member scanned at a gym A kiosk → rejected (`invalid_token` / `not_member`), and no `check_ins` row is written. (Tasks 1, 3)
2. **Double scan:** two scans of the same token 5 s apart consume **one** visit and write **one** row. (Task 3)
3. **Last visit, two devices at once:** concurrent valid check-ins of a member with 1 visit left → one `ok`, one `used_up`; `visits_used` never exceeds `visits_total`. (Task 3)
4. **Revoked tablet:** after the owner revokes a device, its very next request gets `401`, and the kiosk screen returns to pairing. (Tasks 2, 7)
5. **Who's in around the limits:** with a 120-minute window, someone who checked in 121 minutes ago isn't present. Someone who checked in at 23:30 isn't present at 00:10 the next gym day, even though only 40 minutes have passed (presence is "today" only). (Task 4)

---

### Task 1: Gym settings and the member's check-in token

**Files:**
- Create: migration `0011_gym_settings.sql` (`gyms.auto_checkout_minutes int NOT NULL DEFAULT 120 CHECK (between 30 and 600)`, grant `UPDATE (auto_checkout_minutes)` to `gym_app`)
- Create: `apps/api/src/checkin/checkin-token.ts`, `apps/api/src/checkin/checkin.module.ts`, `apps/api/src/checkin/member-checkin.controller.ts`
- Create: `apps/api/src/gyms/gym-settings.controller.ts`
- Modify: `apps/api/src/config/env.ts` (`CHECKIN_SECRET`, `S3_*` keys), PROGRESS.md key list, CI env
- Modify: `packages/shared/src/schemas/checkin.ts` (new), `audit.ts` (new actions), `index.ts`
- Test: `apps/api/test/checkin/checkin-token.spec.ts`, `apps/api/test/gym-settings.e2e.spec.ts`

**Interfaces:**
- `signCheckInToken(p: { memberId: string; gymId: string }, now: Date): { token: string; expiresAt: Date }`.
- `verifyCheckInToken(token: string, now: Date): { memberId: string; gymId: string } | null`: `null` for a wrong prefix, bad base64, bad JSON, bad signature (compare with `timingSafeEqual`) or expiry. Never throws.
- `GET /gyms/:gymId/me/check-in-token` (`@GymRoles('member')`) → `{ token, expiresAt }`.
- `GET /gyms/:gymId/settings` (`@GymRoles('reception')`) → `{ name, timezone, autoCheckoutMinutes }`. `PATCH /gyms/:gymId/settings` (`@GymRoles('owner')`, body `{ autoCheckoutMinutes }`) → `200` + `gym.settings_updated` history row.
- Shared: `GymSettingsSchema`, `CheckInTokenResponse`.

- [x] **Step 1: Write the failing tests:**
  - A token signed at `t` verifies at `t + 44 s` and is `null` at `t + 46 s`.
  - Flipping one character of the payload or the signature → `null`. `'GYM2.'` prefix → `null`. `'garbage'` → `null` (no throw).
  - Verifying with a different `CHECKIN_SECRET` → `null`.
  - The endpoint returns a token for the caller's own member id; a trainer → `403`.
  - Settings: reception `GET` → `200` with `autoCheckoutMinutes: 120`; reception `PATCH` → `403`; owner `PATCH 20` → `400`; owner `PATCH 90` → `200` + history row.
- [x] **Step 2: Run** `pnpm --filter api test checkin-token gym-settings` → FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat: gym settings and rotating check-in tokens`.

---

### Task 2: Kiosk devices (pairing, tokens, revoke)

**Files:**
- Create: `apps/api/src/db/schema/devices.ts`, `device-pairing-codes.ts`; migration `0012_devices.sql`
- Create: `apps/api/src/devices/devices.module.ts`, `devices.controller.ts`, `devices.service.ts`, `device.guard.ts`
- Modify: `apps/api/src/auth/throttle.ts` (`@ThrottlePair()`, `@ThrottleKiosk()`), `apps/api/test/route-guards.spec.ts` (kiosk routes must carry `DeviceGuard`)
- Modify: `packages/shared/src/schemas/devices.ts` (new)
- Test: `apps/api/test/devices.e2e.spec.ts`, `apps/api/test/db/rls.spec.ts` (extend)

**Interfaces:**
- Tables (both gym-owned, RLS):
  - `devices(id, gym_id, name text 1..60, token_hash text UNIQUE, created_by FK users ON DELETE SET NULL, created_at, last_seen_at NULL, revoked_at NULL)`.
  - `device_pairing_codes(id, gym_id, name, code_hash UNIQUE, expires_at, used_at NULL, created_by, created_at)`.
- Routes:
  - `POST /gyms/:gymId/devices/pairing-codes` (`@GymRoles('owner')`, body `{ name }`) → `201 { code: 'XXXX-XXXX', expiresAt }`.
  - `GET /gyms/:gymId/devices` (`@GymRoles('owner')`) → `Device[]` (`id, name, createdAt, lastSeenAt, revoked`).
  - `POST /gyms/:gymId/devices/:id/revoke` (`@GymRoles('owner')`) → `204` + `device.revoked`.
  - `POST /kiosk/pair` (public, `@ThrottlePair()`, body `{ code }`) → `201 { deviceToken, gymId, gymName, deviceName }`. Claims the code with the same single `UPDATE … WHERE used_at IS NULL AND expires_at > now() RETURNING` pattern as sign-up codes (through `systemDb`). Unknown, used or expired → `410`. Writes `device.paired` (actor = the owner who created the code).
- `DeviceGuard`: parses `Authorization: Device <token>`, looks up the hash through `systemDb`. Missing, unknown or revoked → `401`. Sets `req.device = { id, gymId }` and updates `last_seen_at` at most once a minute. `@CurrentDevice()` param decorator.
- `GET /kiosk/me` (`DeviceGuard`) → `{ gymId, gymName, deviceName }`. The kiosk calls this at start-up to know whether it's still paired.

- [x] **Step 1: Write the failing tests:**
  - Owner creates a code → `/kiosk/pair` with it in lower case → `201` with a device token; `/kiosk/me` with `Device <token>` → `200` and the gym's name.
  - Same code again → `410`; expired → `410`; reception creating a code → `403`.
  - After revoke, `/kiosk/me` → `401`. *(Review Focus 4)*
  - A bearer user token on `/kiosk/me` → `401`; a device token on a `/gyms/:gymId/...` route → `401`.
  - Two-gym isolation for both tables. 11 pair attempts from one IP in 60 s → `429`.
- [x] **Step 2: Run** `pnpm --filter api test devices` → FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run** `pnpm --filter api test` → PASS.
- [x] **Step 5: Commit** `feat: kiosk device pairing and revocable device tokens`.

---

### Task 3: Check-in rules and recording

**Files:**
- Create: `apps/api/src/checkin/decide.ts`, `apps/api/src/checkin/checkin.service.ts`, `apps/api/src/checkin/kiosk.controller.ts`, `apps/api/src/checkin/staff-checkin.controller.ts`
- Create: `apps/api/src/db/schema/check-ins.ts`, migration `0013_check_ins.sql`
- Modify: `packages/shared/src/schemas/checkin.ts`
- Test: `apps/api/test/checkin/decide.spec.ts`, `apps/api/test/checkin.e2e.spec.ts`, `apps/api/test/db/rls.spec.ts` (extend)

**Interfaces:**
- Table `check_ins(id, gym_id, member_id FK users, at timestamptz DEFAULT now(), method text CHECK in ('kiosk','manual'), device_id NULL FK devices, by_user_id NULL FK users ON DELETE SET NULL, valid bool, reason text NULL CHECK (valid = (reason IS NULL)), membership_id NULL FK memberships, visit_consumed bool NOT NULL DEFAULT false, checked_out_at NULL, checked_out_by NULL FK users)`, indexes `(gym_id, at DESC)` and `(gym_id, member_id, at DESC)`. RLS. `gym_app` gets `SELECT, INSERT, UPDATE (checked_out_at, checked_out_by)`.
- Shared: `CHECK_IN_REASONS = ['frozen','upcoming_only','classes_only','used_up','expired','no_membership'] as const`; `CheckInResult { checkInId: string | null; valid: boolean; reason: CheckInReason | null; duplicate: boolean; member: { id, firstName, lastName, photoUrl: string | null }; membership: Membership | null; at: string }`; `KioskCheckInResult { valid: boolean; firstName: string | null; reason: 'invalid_token' | 'not_member' | CheckInReason | null }`.
- `decideCheckIn(ms: readonly Membership[]): { valid: true; useMembershipId: string; consumeVisit: boolean } | { valid: false; reason: CheckInReason }`. Pure; `Membership` already carries `status` and `remaining` evaluated for today. Rules per Global Constraints.
- `CheckInService.checkIn(input: { gymId: string; memberId: string; method: 'kiosk' | 'manual'; deviceId?: string; byUserId?: string }): Promise<CheckInResult>`. In one `withGym` transaction:
  1. `lockMember` (from 2a).
  2. If the member's latest check-in is within 2 minutes → return it with `duplicate: true`.
  3. Load and evaluate memberships for today, then `decideCheckIn`.
  4. If a visit is consumed: `UPDATE memberships SET visits_used = visits_used + 1 WHERE id = $1 AND visits_used < visits_total`; zero rows → treat as `used_up`.
  5. Insert the row. For a manual check-in, write `check_in.manual` history.
  6. After commit, publish the result on the event bus (Task 4).
- Routes:
  - `POST /kiosk/check-in` (`DeviceGuard`, `@ThrottleKiosk()`, body `{ token }`) → `200 KioskCheckInResult`. `verifyCheckInToken` failing, or `gymId` ≠ device's gym → `{ valid: false, reason: 'invalid_token', firstName: null }`, nothing recorded. Not a member of the gym → `not_member`, nothing recorded.
  - `POST /gyms/:gymId/members/:memberId/check-ins` (`@GymRoles('reception')`) → `201 CheckInResult`. Not a member → `404`.

- [x] **Step 1: Write the failing tests:**
  - `decide.spec.ts` (hand-built `Membership` objects):
    - Active time membership + active pack → valid, `consumeVisit: false`, uses the time membership.
    - Two active packs, ends 06-30 and NULL → uses the 06-30 one.
    - Only a frozen time membership → `frozen`. Frozen + expired → `frozen`. Only an upcoming one → `upcoming_only`. Only an active class pack → `classes_only`. Used-up pack → `used_up`. Expired → `expired`. None → `no_membership`.
  - `checkin.e2e.spec.ts`:
    - Paired device, member with a 10-visit pack: kiosk check-in with a fresh token → `{ valid: true, firstName }`; `visits_used = 1`; one row with `method 'kiosk'` and `device_id`.
    - The same token 5 s later (Clock + 5 s) → `valid: true` and still `visits_used = 1`, one row. *(Review Focus 2)*
    - A token 46 s old → `invalid_token`, no row. Tampered token → `invalid_token`, no row. A gym B member's valid token at a gym A device → `invalid_token`, no row. *(Review Focus 1)*
    - Member with an active 1-month membership → valid, no visit consumed.
    - Member with an expired membership → `valid: false, reason: 'expired'` and a row with `valid = false`.
    - Member with 1 visit left, two devices check in concurrently (`Promise.all`, the second at Clock + 3 min to skip the duplicate rule) → results `ok` and `used_up`; `visits_used = 1 = visits_total`. *(Review Focus 3)*
    - Manual check-in by reception → `201`, `method 'manual'`, `by_user_id` set, `check_in.manual` in history. Trainer → `403`.
    - Two-gym isolation for `check_ins`.
- [x] **Step 2: Run** `pnpm --filter api test checkin` → FAIL.
- [x] **Step 3: Implement.** Consult database-expert on the lock order (member lock, then membership update) and the indexes.
- [x] **Step 4: Run** `pnpm --filter api test` → PASS.
- [x] **Step 5: Commit** `feat: check-in rules, kiosk and manual check-in`.

---

### Task 4: Who's in, today's visitors, check-out, live stream

**Files:**
- Create: `apps/api/src/checkin/presence.service.ts`, `presence.controller.ts`, `checkin-events.ts`, `live.controller.ts`
- Modify: `packages/shared/src/schemas/checkin.ts`
- Test: `apps/api/test/presence.e2e.spec.ts`, `apps/api/test/live.e2e.spec.ts`

**Interfaces:**
- `CheckInEvents` (Nest provider): `publish(gymId: string, e: LiveEvent): void`, `subscribe(gymId: string, fn: (e: LiveEvent) => void): () => void`. `LiveEvent = { type: 'check_in'; result: CheckInResult } | { type: 'check_out'; checkInId: string }`.
- Shared: `PresentMember { checkInId, memberId, firstName, lastName, photoUrl, at, membershipStatus: MemberStatus }`; `VisitorRow { checkInId, memberId, firstName, lastName, at, method, valid, reason, checkedOutAt }`.
- Routes:
  - `GET /gyms/:gymId/check-ins/present` (`@GymRoles('trainer', 'reception')`) → `PresentMember[]`, newest first, per Global Constraints (today in gym time, within `auto_checkout_minutes`, not checked out, one row per member).
  - `GET /gyms/:gymId/check-ins?date=YYYY-MM-DD` (`@GymRoles('reception')`, default today) → `VisitorRow[]`, including invalid ones.
  - `POST /gyms/:gymId/check-ins/:id/check-out` (`@GymRoles('reception')`) → `204`; sets `checked_out_at/by`; `check_in.checked_out` history; publishes `check_out`. Already checked out → `409`.
  - `POST /gyms/:gymId/live/tickets` (`@GymRoles('trainer', 'reception')`) → `{ ticket }` (single use, 30 s, in-memory map keyed by ticket → `{ gymId, userId, expiresAt }`).
  - `GET /gyms/:gymId/live?ticket=…` (no bearer; the ticket is the credential; the ticket's gym must match `:gymId`) → `text/event-stream`. Sends `event: check_in` / `event: check_out` with JSON `data`, plus a `: ping` comment every 25 s. Bad, used or expired ticket → `401`. Unsubscribes on client close.
  - Trainer streams carry the same events (spec §5: trainers see live check-ins).

- [x] **Step 1: Write the failing tests** (gym `Europe/Athens`, auto check-out 120):
  - Check-in at 10:00, Clock 12:00 → present; Clock 12:01 → not present. *(Review Focus 5)*
  - Check-in at 23:30, Clock 00:10 the next day → not present (new gym day). *(Review Focus 5)*
  - A member who checked in twice (11:00 and, after the duplicate window, 11:30) appears once, with the 11:30 check-in.
  - Invalid check-ins aren't present but appear in `?date=` visitors with their reason.
  - Check-out → gone from present; second check-out → `409`; trainer check-out → `403`; trainer `GET present` → `200`.
  - Live: get a ticket, open the stream, perform a manual check-in → the stream receives one `check_in` event with the member's name within 1 s. Reusing the ticket → `401`. A gym B ticket on gym A's URL → `401`. A gym A check-in never reaches a gym B stream.
- [x] **Step 2: Run** `pnpm --filter api test presence live` → FAIL.
- [x] **Step 3: Implement.** Make sure the proxy in `apps/web/vite.config.ts` doesn't buffer `text/event-stream`, and that responses carry `Cache-Control: no-cache` and `X-Accel-Buffering: no`.
- [x] **Step 4: Run** `pnpm --filter api test` → PASS.
- [x] **Step 5: Commit** `feat: who's in, today's visitors, check-out, live check-in stream`.

---

### Task 5: Member photos

**Files:**
- Create: `apps/api/src/storage/storage.module.ts`, `storage.service.ts`
- Create: `apps/api/src/db/schema/member-photos.ts`, migration `0014_member_photos.sql`
- Create: `apps/api/src/members/photos.controller.ts`, `photos.service.ts`
- Modify: `members.service.ts` and `checkin.service.ts`/`presence.service.ts` (fill `photoUrl`), `docker-compose.yml` (MinIO env for the API if needed), PROGRESS.md
- Test: `apps/api/test/photos.e2e.spec.ts` (needs MinIO from Docker; skips with a clear reason if `S3_ENDPOINT` is unreachable), `apps/api/test/db/rls.spec.ts` (extend)

**Interfaces:**
- `StorageService`: `ensureBucket(): Promise<void>` (called on module init), `put(key: string, body: Buffer, contentType: string): Promise<void>`, `remove(key: string): Promise<void>`, `signedGetUrl(key: string, seconds = 300): Promise<string>`. S3 client with `forcePathStyle: true`.
- Table `member_photos(gym_id, member_id FK users, object_key text, updated_at, updated_by, PRIMARY KEY (gym_id, member_id))`. RLS.
- Routes (`@GymRoles('reception')`):
  - `PUT /gyms/:gymId/members/:memberId/photo` (multipart field `photo`): validate per Global Constraints (`415` for a wrong type, `413` over 2 MB). Upload a new key, upsert the row, then delete the old object after commit. Writes `member.photo_updated`.
  - `DELETE /gyms/:gymId/members/:memberId/photo` → `204` + `member.photo_removed`.
- `photoUrl` in `MemberSummary`, `MemberDetail`, `CheckInResult` and `PresentMember` = a presigned URL or `null`.

- [x] **Step 1: Write the failing tests:**
  - Upload a small JPEG → `200`; member detail has a `photoUrl` that, fetched, returns the same bytes. A second upload replaces it and the old object is gone.
  - A text file renamed `.jpg` → `415`. 2.1 MB → `413`. Trainer → `403`. Not a member of this gym → `404`.
  - A manual check-in result carries the `photoUrl`. Two-gym isolation for `member_photos`.
- [x] **Step 2: Run** `pnpm --filter api test photos` → FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run** `pnpm --filter api test` → PASS.
- [x] **Step 5: Commit** `feat: member photos in object storage with signed links`.

---

### Task 6: Web, the member's check-in screen

**Files:**
- Create: `apps/web/src/features/checkin/MemberCheckInPage.tsx`, `useCheckInToken.ts`, `useWakeLock.ts`
- Modify: member shell nav (`checkIn` first), router, `el.json`, `en.json`
- Test: `apps/web/src/features/checkin/MemberCheckInPage.spec.tsx`, `useCheckInToken.spec.ts`

**Interfaces:**
- `useCheckInToken(gymId): { token: string | null; secondsLeft: number; error: boolean }`: fetches on mount and every 30 s, and immediately when the tab becomes visible again (`visibilitychange`). It never shows a token past its `expiresAt`.
- `MemberCheckInPage`:
  - A large QR (at least 260 px, black on white even in dark mode, quiet zone included) generated locally with `qrcode`.
  - The member's name, a small countdown ring, and the current membership summary (`MyMembershipCard` in compact form).
  - Offline or error: "Δεν υπάρχει σύνδεση — η ρεσεψιόν μπορεί να σε περάσει με το όνομά σου" instead of a stale code.
  - Keeps the screen awake with the Wake Lock API where supported (`useWakeLock`, ignored where unsupported).

- [x] **Step 1: Write the failing tests** (fake timers, mocked API):
  - The hook fetches once on mount, again after 30 s, and again on `visibilitychange` to visible.
  - With the API failing, the page shows the offline message and no QR.
  - The QR is rendered for the token returned by the API.
- [x] **Step 2: Run** `pnpm --filter web test checkin` → FAIL.
- [x] **Step 3: Implement.** Run ui-ux-reviewer (375 px, Greek, dark mode).
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat(web): member check-in QR screen`.

---

### Task 7: Web, kiosk tablet and device management

**Files:**
- Create: `apps/web/src/features/kiosk/KioskApp.tsx` (route `/kiosk`, outside `RequireAuth`), `KioskPairing.tsx`, `KioskScanner.tsx`, `KioskResult.tsx`, `kioskStorage.ts`
- Create: `apps/web/src/features/devices/DevicesPage.tsx` (owner)
- Modify: router, owner shell nav (`devices`), `apps/web/src/api/client.ts` (a `kioskFetch` that sends `Authorization: Device …` and never touches user tokens), `el.json`, `en.json`
- Test: `apps/web/src/features/kiosk/kiosk.spec.tsx`, `apps/web/src/features/devices/DevicesPage.spec.tsx`

**Interfaces:**
- `kioskStorage`: `get(): string | null`, `set(token)`, `clear()`, using `localStorage` key `gym.kiosk.device`, wrapped in try/catch.
- `KioskApp`:
  - No token → `KioskPairing` (8-character code input, large keys).
  - Token → `GET /kiosk/me`. `401` → `clear()` and back to pairing *(Review Focus 4)*. Otherwise `KioskScanner`.
- `KioskScanner`: rear camera by default (a switch-camera button), continuous scanning. It ignores the same token for 3 s after a scan, and pauses scanning while a result shows.
- `KioskResult`, shown for 3 s:
  - Green full-screen "Καλώς ήρθες, {firstName}!".
  - Red "Πέρασε από τη ρεσεψιόν" for any invalid reason (no reason text, for privacy).
  - Grey "Ο κωδικός έληξε — άνοιξε ξανά την εφαρμογή" for `invalid_token`.
  - Text, not only colour.
- `DevicesPage`: list (name, last seen, revoked), "Σύνδεση νέου tablet" → name → shows the pairing code and its expiry, and a revoke action with confirmation.

- [x] **Step 1: Write the failing tests:**
  - Without a stored token, the pairing screen shows. A successful pair stores the token and shows the scanner.
  - A stored token with `/kiosk/me` → `401` clears storage and shows pairing.
  - A scan result `{ valid: true, firstName: 'Μαρία' }` shows "Καλώς ήρθες, Μαρία!" and returns to scanning after 3 s (fake timers). `{ valid: false, reason: 'expired' }` shows the reception message and **not** the word "expired"/"έληξε συνδρομή".
  - The same token decoded twice within 3 s causes one API call.
  - Devices page: revoke asks for confirmation; the pairing code shows in large text.
- [x] **Step 2: Run** `pnpm --filter web test kiosk devices` → FAIL.
- [x] **Step 3: Implement.** Run ui-ux-reviewer (tablet landscape and portrait, arm's-length readability, touch targets ≥ 44 px).
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat(web): kiosk tablet pairing and scanning, device management`.

---

### Task 8: Web, the reception desk

**Files:**
- Create: `apps/web/src/features/desk/DeskPage.tsx` (reception's `checkIn` nav item; also in the owner nav), `LiveFeed.tsx`, `CheckInCard.tsx`, `PresentList.tsx`, `VisitorsList.tsx`, `ManualCheckIn.tsx`, `useLiveEvents.ts`
- Create: `apps/web/src/features/members/PhotoCapture.tsx`; Modify: `MemberDetailPage.tsx` (photo, plus a "Check in" button)
- Create: `apps/web/src/features/renewals/RenewalsPage.tsx` (reception and owner nav)
- Create: `apps/web/src/features/settings/GymSettingsPage.tsx` (owner: auto check-out minutes)
- Modify: router, shells, `el.json`, `en.json`
- Test: one `*.spec.tsx` per component, `useLiveEvents.spec.ts`, `e2e/front-desk.spec.ts`

**Interfaces:**
- `useLiveEvents(gymId, onEvent)`: gets a ticket, opens an `EventSource`, and reconnects with a new ticket after an error (backoff 1 s, 2 s, 5 s, then 10 s). It exposes a `connected: boolean` for a visible "live / reconnecting" indicator.
- `DeskPage` layout (desktop ≥ 1280 px):
  - Left: `LiveFeed`, the latest check-in as a large `CheckInCard` with photo, full name, `StatusBadge` and the membership line; invalid ones in a red frame with the reason in words (e.g. "Η συνδρομή έληξε στις 28/2", "Σε πάγωμα έως 16/5"), plus a "Πώληση συνδρομής" button that opens the existing `SellMembershipDialog`. Below it, the previous 10.
  - Right: tabs `PresentList` ("Μέσα τώρα", count, check-out buttons) and `VisitorsList` ("Σήμερα").
  - Top: `ManualCheckIn`, a search box reusing the members list API (debounced 250 ms) with Enter to check in the highlighted member.
  - On first load, the present and visitors lists come from the REST endpoints; afterwards live events update them without a refetch.
- `PhotoCapture`: `<input type="file" accept="image/*" capture="user">` with a preview, client-side resize to 800 px JPEG 0.85 via canvas, upload, remove.
- `RenewalsPage`: members with `status=expiring`, sorted by `currentEndsOn` (add `sort=ending` to `GET /members` if not present, with a test), with phone (a `tel:` link) and a "Πώληση" button.

- [x] **Step 1: Write the failing tests:**
  - `useLiveEvents`: on an `error` event, a new ticket is requested and a new `EventSource` opened after 1 s; `connected` goes false, then true.
  - A `check_in` event with `valid: false, reason: 'frozen'` renders a red card with the frozen-until text and the sell button; a valid one renders the green state with the photo.
  - A `check_out` event removes the member from "Μέσα τώρα".
  - Manual check-in: typing "γιωρ" lists "Γιώργος", Enter calls the check-in endpoint once.
  - Photo capture resizes a 2000×1500 image to 800×600 before upload (canvas mocked).
  - Renewals list is sorted by end date.
  - E2E (two browser contexts): owner pairs a kiosk (context A, `/kiosk` with the code) → a member (context B) opens the check-in screen → the test reads the token from the API as that member and posts it to `/kiosk/check-in` with the device token (camera can't be driven in CI) → the reception desk (context C) shows the check-in live → reception checks the member out → "Μέσα τώρα" is empty.
- [x] **Step 2: Run** `pnpm --filter web test && pnpm e2e` → FAIL.
- [x] **Step 3: Implement.** Run ui-ux-reviewer on each new component (readable at a glance from 1 m, invalid status impossible to miss, colour never alone).
- [x] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm -r test && pnpm e2e` → PASS.
- [ ] **Step 5: Manual check** on the real devices, as in the spike: kiosk on a tablet or the Android phone (`/kiosk` through the cloudflared tunnel), member on the iPhone. A scan gives a green result in under 2 seconds, and the desk updates live. Record it in `PROGRESS.md`.
- [x] **Step 6: Commit** `feat(web): reception desk with live check-ins, photos, renewals, gym settings`.

---

## Self-review notes

- **Spec coverage:**
  - §6.2: QR + kiosk → T1, T2, T3, T6, T7; live reception screen with photo and red warning → T4, T5, T8; invalid check-ins recorded → T3; a visit used only on valid check-ins → T3; manual fallback → T3, T8; who's in with auto check-out → T1, T4, T8.
  - §6.1 renewals list → T8. §6.0 photo → T5, T8. §6.10 new history actions → T1–T5. §5 trainers see live check-ins and who's in → T4. §8 signed expiring links → T5.
- **Not in 2b:**
  - Occupancy indicator for members → phase 5 (spec §9).
  - Class attendance by check-in → phase 6 (class packs are `classes_only` at the door until then).
  - The deferred minors in the 2a ledger stay deferred.
