# Phase 2a: Member Sign-up, Memberships and Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the foundation, then let members sign up with a reception code and let staff sell, renew, freeze and record payments for memberships, with a change history.

**Architecture:** Builds on phase 0–1 (`main` at 4dce865). New gym-owned tables follow the existing pattern (forced RLS on `gym_id`, writes through `withGym`). Writes to the global `users` table move to a new `gym_system` login, so `users` can be locked by RLS. Date logic (membership periods, freezes, status) is pure functions evaluated in the gym's time zone.

**Tech Stack:** as phase 0–1, plus `@nestjs/throttler`.

**Spec:** `docs/superpowers/specs/2026-11-15-gym-management-design.md` §5, §6.0 (sign-up, decided 2026-11-16), §6.1, §6.10, §8. Phase 0–1 decisions: `docs/superpowers/plans/2026-11-15-phase0-1-foundation.ledger.md`.

## Global Constraints

- All phase 0–1 Global Constraints still apply. The RLS policy expression is `gym_id = nullif(current_setting('app.gym_id', true), '')::uuid`.
- Every new gym-owned table: `gym_id uuid NOT NULL`, RLS enabled + forced, the policy above, an isolation test with two gyms, and the database-expert consulted (CLAUDE.md).
- Money: integer euro cents (`*_cents integer NOT NULL CHECK (>= 0)`). Dates of memberships and freezes are `date` columns, meaning calendar days **in the gym's time zone**, end dates inclusive.
- "Today" for a gym = `todayIn(gym.timezone, now)`. Never use the server's local date.
- Sign-up code: 8 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, shown as `XXXX-XXXX`. Input is accepted in any case, with or without the dash or spaces. Valid **24 hours**, single use, stored as a sha256 hash.
- Email verification token: valid **72 hours**, single use, stored hashed.
- Throttling (HTTP 429): `POST /auth/login` **5 per 60 s per IP + email**; `POST /auth/signup` and `POST /auth/verify-email` **10 per 60 s per IP**.
- Phone normalisation: strip spaces, `-`, `(`, `)`; leading `00` → `+`; 10 digits starting with `69` or `2` → prefix `+30`; result must match `^\+[1-9]\d{7,14}$`.
- Date of birth: not in the future, not more than 110 years ago.
- Writes to `users` happen only through `systemDb` (`gym_system`). `gym_app` keeps only `SELECT` on `users`, under RLS.
- Every state change in §6.1 (sale, payment, void, freeze, freeze end, type create/edit/archive) writes one change-history row **in the same transaction**.

## Review Focus

1. **Midnight in Athens:** at 00:30 Athens time on 2027-03-29 (21:30 UTC on the 28th, the night after the DST switch), a membership with `ends_on = 2027-03-28` is **expired**, not active. (Task 6)
2. **One code, two phones at once:** two concurrent sign-ups with the same code give exactly one `201` and one `410`; only one account gets the member role. (Task 3)
3. **Renewing a frozen membership:** selling a new time-based membership while the current one is frozen starts the new one the day after the current one's *extended* end. (Tasks 7, 8)
4. **Archived type:** existing memberships keep their name, kind and price after the type is edited or archived. An archived type can't be sold (`409`). (Tasks 5, 7)
5. **Voiding:** voiding a payment voids its membership. Voiding twice gives `409`. Reception voiding gives `403`. (Task 7)

---

### Task 1: Hardening and GitHub

**Files:**
- Modify: `docker/postgres/init.sql` (role `gym_system`: LOGIN, BYPASSRLS, NOSUPERUSER, no DDL), `.env.example`, `apps/api/src/config/env.ts` (key `DATABASE_SYSTEM_URL`), `apps/api/src/db/client.ts` (`systemDb` uses `DATABASE_SYSTEM_URL`; migrations keep `DATABASE_MIGRATOR_URL`), `apps/api/test/test-env.ts`
- Create: `apps/api/src/db/migrations/0002_users_rls.sql`
- Modify: `apps/api/src/auth/auth.service.ts`, `apps/api/src/invitations/invitations.service.ts` (all `users` reads without a gym, and all `users` writes, go through `systemDb`)
- Create: `apps/api/src/auth/throttle.ts`; Modify: `apps/api/src/app.module.ts`, `apps/api/src/auth/auth.controller.ts`
- Modify: `CLAUDE.md` (policy expression with `nullif`; `systemDb` = `gym_system`, used where no gym is known and for every `users` write), `.github/workflows/ci.yml` (new env key, `gym_system` role)
- Test: `apps/api/test/db/users-rls.spec.ts`, `apps/api/test/db/privileges.spec.ts` (extend), `apps/api/test/throttle.e2e.spec.ts`

**Interfaces:**
- Produces: `systemDb` now connects as `gym_system` (DML on all tables, BYPASSRLS, no CREATE/ALTER/DROP).
- Produces: RLS on `users` for `gym_app`: `FOR SELECT USING (id IN (SELECT user_id FROM gym_roles WHERE gym_id = nullif(current_setting('app.gym_id', true), '')::uuid))`. Revoke `INSERT, UPDATE` on `users` from `gym_app`.
- Produces: `@ThrottleLogin()` and `@ThrottleSignup()` decorators in `auth/throttle.ts` (in-memory storage; comment `shortcut: in-memory throttle store, move to Redis when running more than one API instance`).

- [x] **Step 1: Write the failing tests:**
  - `users-rls.spec.ts`: `withGym(A, tx => tx.select().from(users))` returns only users with a role in gym A. A user of gym B only is absent. With no gym set → `[]`. `db.insert(users)` as `gym_app` rejects with `/permission denied/`.
  - `privileges.spec.ts`: as `gym_system`, `CREATE TABLE x(...)` rejects; `SELECT` from `gym_roles` across gyms works.
  - `throttle.e2e.spec.ts`: 6th wrong login for the same email + IP within 60 s → `429`; a different email from the same IP still gets `401`.
  - Existing suites (`auth`, `invitations`, `access`, `rls`) still pass.
- [x] **Step 2: Run** `pnpm --filter api test` → the new tests FAIL.
- [x] **Step 3: Implement.** Recreate the local DB volume for the new role (`docker compose down -v && docker compose up -d --wait`, documented in PROGRESS.md).
- [x] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm -r test && pnpm e2e` → all PASS.
- [x] **Step 5: Commit** `feat: gym_system role, users RLS, login throttling`.
- [ ] **Step 6: Push to GitHub.** `git remote add origin https://github.com/Tsomaros/Gym_Managment_App.git`, `git push -u origin main` and the working branch. Open the Actions tab. Expected: CI green. If CI fails, fix it on the branch with a commit `ci: …` and push again until green.

---

### Task 2: Person details

**Files:**
- Create: `apps/api/src/db/migrations/0003_person_details.sql` (via `db:generate` + hand edits)
- Modify: `apps/api/src/db/schema/users.ts`, `apps/api/src/db/schema/invitations.ts`
- Modify: `packages/shared/src/schemas/common.ts`, `accounts.ts`, `auth.ts`
- Modify: invitation service, mail template, `/auth/me`, and web invite and platform forms that send `fullName`
- Test: `packages/shared/test/person.spec.ts`, `apps/api/test/db/person.spec.ts`

**Interfaces:**
- `users` gains: `first_name text NOT NULL`, `last_name text NOT NULL`, `phone text NULL`, `date_of_birth date NULL`, `emergency_contact_name text NULL`, `emergency_contact_phone text NULL`, `email_verified_at timestamptz NULL`. `full_name` becomes `GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED`. Migrate existing rows: first word → `first_name`, rest → `last_name` (or `''`). Mark existing users' emails verified (they came through emailed links).
- `invitations`: `full_name` → `first_name`, `last_name`.
- Shared exports: `phoneSchema` (normalises per Global Constraints), `dateOfBirthSchema` (`YYYY-MM-DD`, range per Global Constraints; takes an optional `today` for tests via `makeDateOfBirthSchema(today: string)`), `personNameSchema` (trimmed, 1..60). `InviteSchema` and `CreateGymSchema` replace `fullName`/`ownerFullName` with `firstName`/`lastName` (`ownerFirstName`/`ownerLastName`). `MeResponse` keeps `fullName` and adds `firstName`, `lastName`, `emailVerified: boolean`.

- [x] **Step 1: Write the failing tests:**
  - `phoneSchema`: `'69 1234 5678'` → `'+306912345678'`; `'2634012345'` → `'+302634012345'`; `'0044 7700 900123'` → `'+447700900123'`; `'12345'` rejects; `'+30 691-234-5678'` → `'+306912345678'`.
  - `makeDateOfBirthSchema('2026-11-16')`: `'2026-11-17'` rejects; `'1916-11-15'` rejects; `'1916-11-16'` accepts; `'1990-02-30'` rejects.
  - `personNameSchema`: `'  Γιώργος '` → `'Γιώργος'`; `''` rejects.
  - DB: inserting `first_name 'Γιώργος', last_name 'Παπαδόπουλος'` reads back `full_name 'Γιώργος Παπαδόπουλος'`.
- [x] **Step 2: Run** `pnpm --filter shared test && pnpm --filter api test person` → FAIL.
- [x] **Step 3: Implement**, updating every caller of `fullName` until `pnpm typecheck` passes.
- [x] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm -r test && pnpm e2e` → PASS.
- [x] **Step 5: Commit** `feat: first/last name, phone, date of birth, emergency contact`.

---

### Task 3: Sign-up codes, self sign-up and email confirmation (API)

**Files:**
- Create: `apps/api/src/db/schema/signup-codes.ts`, `email-verifications.ts`; migration `0004_signup.sql`
- Create: `apps/api/src/signup/signup.module.ts`, `signup.controller.ts`, `signup.service.ts`, `signup-code.ts`
- Create: `apps/api/src/mail/templates/verify-email.ts` (el + en)
- Modify: `packages/shared/src/schemas/auth.ts`
- Test: `apps/api/test/signup.e2e.spec.ts`, `apps/api/test/signup-code.spec.ts`, `apps/api/test/db/rls.spec.ts` (extend)

**Interfaces:**
- Tables:
  - `signup_codes(id, gym_id FK, code_hash text UNIQUE, expires_at, used_at NULL, used_by NULL FK users, created_by FK users ON DELETE SET NULL, created_at)`. Gym-owned, RLS.
  - `email_verifications(id, user_id FK, token_hash UNIQUE, expires_at, used_at NULL, created_at)`. Global, no RLS, reached through `systemDb` only.
- `generateSignupCode(): { raw: string; display: string; hash: string }` and `normaliseSignupCode(input: string): string | null` (uppercase, strip `-`/spaces; `null` if not 8 chars from the alphabet) in `signup-code.ts`.
- Shared: `SignupSchema { code: string, firstName, lastName, email, phone, dateOfBirth, password (min 8), emergencyContactName?, emergencyContactPhone? (phoneSchema), acceptPrivacy: literal(true) }`; `SignupResponse = { accessToken: string } | { signInRequired: true }`; `VerifyEmailSchema { token }`.
- Routes:
  - `POST /gyms/:gymId/signup-codes` (`@GymRoles('reception')`) → `201 { code: 'XXXX-XXXX', expiresAt }`.
  - `POST /auth/signup` (`@ThrottleSignup()`, public) → `201 SignupResponse`. In one `systemDb` transaction: claim the code with `UPDATE … SET used_at = now(), used_by = $user WHERE code_hash = $h AND used_at IS NULL AND expires_at > now() RETURNING gym_id`; zero rows → `410 { message: 'Code invalid or expired' }` (same body for unknown, used and expired). New email → create the user (phone, date of birth, emergency contact, password) + `gym_roles(member)`, sign in, send the verification email. Existing email → add `gym_roles(member)` only; ignore the password and details; return `{ signInRequired: true }`. Already a member of that gym → `409`, and the code stays unused (roll back).
  - `POST /auth/verify-email` (`@ThrottleSignup()`) → `204`; sets `email_verified_at`. Used or expired → `410`.
  - `POST /auth/resend-verification` (signed in, `JwtGuard`) → `204`; invalidates earlier tokens.
- Change history: "signup code issued" (by reception) and "member signed up" are written in Task 4 when the history exists. Leave a `// history: Task 4` marker at both points.

- [x] **Step 1: Write the failing tests:**
  - `signup-code.spec.ts`: 1,000 generated codes all match `^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[same]{4}$`; `normaliseSignupCode(' k7p2-qm9x ')` → `'K7P2QM9X'`; `'K7P2QM90'` → `null` (`0` not in alphabet).
  - `signup.e2e.spec.ts`:
    - Reception creates a code. Sign-up with it in lower case without the dash → `201` + access token. `/auth/me` shows the gym with `roles: ['member']`, `emailVerified: false`. A verification email is captured.
    - Same code again → `410`. Code with `expires_at` in the past → `410`. Made-up code → `410` (identical body).
    - Two concurrent sign-ups with one code (`Promise.all`) → status codes `[201, 410]` in some order; exactly one new `gym_roles` row. *(Review Focus 2)*
    - Existing user of gym A signs up to gym B with a B code → `{ signInRequired: true }`; one `users` row; password hash unchanged; both gyms in `/auth/me`.
    - Already a member of gym B → `409`, and the code can still be used by someone else.
    - Trainer creating a code → `403`. A gym B code can't be seen by a gym A query (RLS test in `rls.spec.ts`).
    - `acceptPrivacy: false` → `400`. Date of birth tomorrow → `400`.
    - Verify-email with the captured token → `204`, then `emailVerified: true`; same token again → `410`.
    - 11th sign-up attempt from one IP within 60 s → `429`.
- [x] **Step 2: Run** `pnpm --filter api test signup` → FAIL.
- [x] **Step 3: Implement.** Consult database-expert on the code-claiming `UPDATE` and the indexes.
- [x] **Step 4: Run** `pnpm --filter api test` → PASS.
- [x] **Step 5: Commit** `feat: reception sign-up codes, member self sign-up, email confirmation`.

---

### Task 4: Change history

**Files:**
- Create: `apps/api/src/db/schema/audit-log.ts`, migration `0005_audit_log.sql`
- Create: `apps/api/src/audit/audit.module.ts`, `audit.service.ts`, `audit.controller.ts`
- Modify: `apps/api/src/signup/signup.service.ts`, `apps/api/src/invitations/invitations.service.ts` (record their events)
- Modify: `packages/shared/src/schemas/audit.ts` (new), `index.ts`
- Test: `apps/api/test/audit.e2e.spec.ts`, `apps/api/test/db/rls.spec.ts` (extend), `apps/api/test/db/privileges.spec.ts` (extend)

**Interfaces:**
- Table: `audit_log(id bigserial PK, gym_id uuid NOT NULL FK, actor_id uuid NULL FK users ON DELETE SET NULL, action text NOT NULL, entity text NOT NULL, entity_id uuid NULL, data jsonb NOT NULL DEFAULT '{}', at timestamptz NOT NULL DEFAULT now())`, index `(gym_id, at DESC)`. RLS. `gym_app` gets **only** `SELECT, INSERT` (plus the sequence's `USAGE`).
- Shared: `AUDIT_ACTIONS = ['signup_code.issued','member.signed_up','invitation.sent','invitation.accepted','membership_type.created','membership_type.updated','membership_type.archived','membership.sold','payment.voided','freeze.created','freeze.ended'] as const`; `AuditEntry { id: string; action; entity; entityId: string | null; actor: { id: string; fullName: string } | null; data: Record<string, unknown>; at: string }`.
- `AuditService.record(tx: Tx, e: { gymId: string; actorId: string | null; action: AuditAction; entity: string; entityId?: string; data?: Record<string, unknown> }): Promise<void>`. Always takes the caller's transaction, never opens its own. For `systemDb` paths (sign-up), pass the `systemDb` transaction.
- `GET /gyms/:gymId/audit?before=<id>&limit=50&entity=<entity>&entityId=<uuid>` (`@GymRoles('owner')`) → `{ entries: AuditEntry[]; nextBefore: string | null }`, newest first.

- [x] **Step 1: Write the failing tests:**
  - As `gym_app` inside `withGym(A)`: `UPDATE audit_log …` and `DELETE FROM audit_log …` reject with `/permission denied/`.
  - Two-gym isolation for `audit_log`.
  - After a sign-up with a code: gym history has `signup_code.issued` (actor = receptionist) then `member.signed_up` (actor = new member), and neither entry's `data` contains the password or its hash.
  - When the transaction that records an entry rolls back (sign-up with an already-member email, see Task 3), no `member.signed_up` row exists.
  - `GET /audit` as reception → `403`; as owner with `limit=1` → one entry and a `nextBefore` that returns the next one.
- [x] **Step 2: Run** → FAIL.
- [x] **Step 3: Implement**, replacing the `// history: Task 4` markers.
- [x] **Step 4: Run** `pnpm --filter api test` → PASS.
- [x] **Step 5: Commit** `feat: append-only change history`.

---

### Task 5: Membership types (API + owner screen)

**Files:**
- Create: `apps/api/src/db/schema/membership-types.ts`, migration `0006_membership_types.sql`
- Create: `apps/api/src/memberships/membership-types.controller.ts`, `membership-types.service.ts`, `memberships.module.ts`
- Create: `packages/shared/src/schemas/memberships.ts`
- Create: `apps/web/src/features/membership-types/MembershipTypesPage.tsx`, `MembershipTypeForm.tsx`; Modify: owner shell nav and router, `el.json`, `en.json`
- Test: `apps/api/test/membership-types.e2e.spec.ts`, `packages/shared/test/memberships.spec.ts`, `apps/web/src/features/membership-types/MembershipTypesPage.spec.tsx`, `apps/api/test/db/rls.spec.ts` (extend)

**Interfaces:**
- Table `membership_types(id, gym_id, name text NOT NULL, name_en text NULL, kind text CHECK in ('time','visits','day_pass','classes'), duration_months int NULL, visit_count int NULL, validity_days int NULL, price_cents int NOT NULL CHECK >= 0, max_freeze_days int NOT NULL DEFAULT 0, includes_trainer bool NOT NULL DEFAULT false, includes_classes bool NOT NULL DEFAULT false, archived_at timestamptz NULL, created_at)`. CHECKs:
  - `time` ⇒ `duration_months` 1..36, `visit_count` and `validity_days` NULL.
  - `visits`/`classes` ⇒ `visit_count` 1..500, `validity_days` NULL or 1..730, `duration_months` NULL, `max_freeze_days = 0`.
  - `day_pass` ⇒ all three NULL, `max_freeze_days = 0`.
  - `classes` ⇒ `includes_classes = true`.
- Shared: `MEMBERSHIP_KINDS`; `MembershipTypeInputSchema` (discriminated union on `kind`, same rules as the CHECKs); `MembershipType` (input + `id`, `archived: boolean`).
- Routes (`@GymRoles('owner')` for writes; `@GymRoles('reception')` for `GET`):
  - `GET /gyms/:gymId/membership-types?includeArchived=true|false` (default false).
  - `POST /gyms/:gymId/membership-types` → `201`.
  - `PATCH /gyms/:gymId/membership-types/:id`.
  - `POST /gyms/:gymId/membership-types/:id/archive` → `204`.
  - No delete route; archive replaces it.
- Owner screen: list of types (name, kind, duration or visits, price formatted `el-GR`/`en-GB` EUR, badges for trainer/classes), create/edit form switching fields by kind, archive with a confirm dialog.

- [x] **Step 1: Write the failing tests:**
  - Shared: `{ kind: 'time', durationMonths: 0 }` rejects; `{ kind: 'classes', includesClasses: false }` rejects; `{ kind: 'visits', visitCount: 10, maxFreezeDays: 5 }` rejects.
  - API: owner creates "Μηνιαία" time 1 month 4000 cents → `201`; reception `POST` → `403`; reception `GET` → `200`; archived types are hidden by default and shown with `includeArchived=true`; each change writes `membership_type.created/updated/archived`; two-gym isolation.
  - Web: switching kind to "Πακέτο επισκέψεων" shows the visit-count field and hides months; a price of `4000` cents renders as `40,00 €` in Greek; archiving asks for confirmation before calling the API.
- [x] **Step 2: Run** `pnpm --filter shared test && pnpm --filter api test membership-types && pnpm --filter web test MembershipTypes` → FAIL.
- [x] **Step 3: Implement.** Run ui-ux-reviewer on the new components.
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat: membership types for owners`.

---

### Task 6: Membership dates and status (pure logic)

**Files:**
- Create: `apps/api/src/memberships/dates.ts`, `apps/api/src/memberships/status.ts`
- Test: `apps/api/test/memberships/dates.spec.ts`, `apps/api/test/memberships/status.spec.ts`

**Interfaces:**
- `todayIn(timezone: string, now: Date): string` (ISO date).
- `addDays(date: string, days: number): string`; `daysBetweenInclusive(from: string, to: string): number`.
- `periodEnd(start: string, months: number): string`: the day before the same day-of-month `months` later; if that target day doesn't exist in the target month, the **last day of the target month**.
- `frozenDays(freezes: { startsOn: string; endsOn: string }[]): number` (sum, inclusive).
- `effectiveEnd(baseEndsOn: string | null, freezes): string | null` = `baseEndsOn + frozenDays`.
- `membershipStatus(m: { kind: MembershipKind; startsOn: string; endsOn: string | null; visitsTotal: number | null; visitsUsed: number; voidedAt: Date | null }, freezes: { startsOn: string; endsOn: string }[], today: string): 'voided' | 'upcoming' | 'frozen' | 'active' | 'used_up' | 'expired'`, checked in that order. `endsOn` here is the effective end.
- `remaining(m, freezes, today): { days: number | null; visits: number | null }`.

- [x] **Step 1: Write the failing tests** (values worked out by hand):
  - `periodEnd('2027-01-15', 1)` = `'2027-02-14'`; `periodEnd('2027-01-31', 1)` = `'2027-02-28'`; `periodEnd('2028-01-31', 1)` = `'2028-02-29'`; `periodEnd('2027-03-31', 1)` = `'2027-04-30'`; `periodEnd('2027-11-01', 3)` = `'2028-01-31'`; `periodEnd('2027-01-01', 12)` = `'2027-12-31'`.
  - `todayIn('Europe/Athens', new Date('2027-03-28T21:30:00Z'))` = `'2027-03-29'`; `todayIn('Europe/Athens', new Date('2027-10-30T21:30:00Z'))` = `'2027-10-31'` (DST ends that night, UTC+2).
  - Status with `endsOn '2027-03-28'` and today `'2027-03-29'` → `'expired'`; today `'2027-03-28'` → `'active'`. *(Review Focus 1)*
  - `effectiveEnd('2027-05-31', [{ '2027-05-10'..'2027-05-16' }])` = `'2027-06-07'` (7 days).
  - Today inside a freeze → `'frozen'`; visits 10/10 used → `'used_up'` even before `endsOn`; voided wins over everything; start tomorrow → `'upcoming'`.
  - `remaining` on `endsOn '2027-05-31'`, today `'2027-05-29'` → `{ days: 3, visits: null }`.
- [x] **Step 2: Run** `pnpm --filter api test memberships/dates memberships/status` → FAIL.
- [x] **Step 3: Implement** with `Intl.DateTimeFormat` (`en-CA` gives `YYYY-MM-DD`) and UTC date arithmetic on ISO date strings. No date library.
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat: membership period, freeze and status rules`.

---

### Task 7: Selling memberships, payments and voiding

**Files:**
- Create: `apps/api/src/db/schema/memberships.ts`, `payments.ts`, migration `0007_memberships_payments.sql`
- Create: `apps/api/src/memberships/memberships.controller.ts`, `memberships.service.ts`, `payments.controller.ts`, `payments.service.ts`
- Modify: `packages/shared/src/schemas/memberships.ts`
- Test: `apps/api/test/memberships.e2e.spec.ts`, `apps/api/test/db/rls.spec.ts` (extend)

**Interfaces:**
- Tables:
  - `memberships(id, gym_id, member_id FK users, type_id FK membership_types, name text, kind text, includes_trainer bool, includes_classes bool, max_freeze_days int, price_cents int, starts_on date, base_ends_on date NULL, ends_on date NULL, visits_total int NULL, visits_used int NOT NULL DEFAULT 0 CHECK (visits_used <= visits_total), voided_at timestamptz NULL, created_by FK users, created_at)`. Name, kind, flags and price are a **snapshot** of the type at sale time.
  - `payments(id, gym_id, membership_id FK, member_id FK, amount_cents int CHECK >= 0, method text CHECK in ('cash','card'), paid_at timestamptz DEFAULT now(), recorded_by FK users, voided_at NULL, voided_by NULL FK, void_reason text NULL, CHECK (voided_at IS NULL) = (void_reason IS NULL))`.
  - Both have RLS and indexes on `(gym_id, member_id)`.
- Shared: `SellMembershipSchema { typeId: uuid, startsOn?: ISO date, amountCents: int >= 0, method: 'cash'|'card' }`; `Membership` (snapshot fields + `status`, `remaining`, `effectiveEndsOn`); `Payment`; `VoidPaymentSchema { reason: string 3..200 }`.
- Sale rules (one `withGym` transaction):
  - The type must exist, be unarchived (`409` otherwise), and the member must have the `member` role in the gym (`404` otherwise).
  - Start: `startsOn` if given (must be ≥ today, else `400`). Otherwise, for `time`: the day after the latest effective end among the member's non-voided `time` memberships that end on or after today; else today. For other kinds: today.
  - Ends: `time` → `periodEnd(start, months)`; `day_pass` → `start`, `visits_total = 1`; `visits`/`classes` → `visits_total = visit_count`, ends `start + validity_days - 1` or NULL.
  - Insert membership + payment + `membership.sold` history row (`data`: type name, amount, method, starts/ends).
- Routes:
  - `POST /gyms/:gymId/members/:memberId/memberships` (`@GymRoles('reception')`) → `201 Membership`.
  - `POST /gyms/:gymId/payments/:paymentId/void` (`@GymRoles('owner')`) body `VoidPaymentSchema` → `204`; voids the payment **and** its membership; `payment.voided` history row; already voided → `409`.
  - `GET /gyms/:gymId/payments?from=&to=` (`@GymRoles('owner')`, ISO dates in gym time) → `Payment[]` with member name and recorder name.

- [x] **Step 1: Write the failing tests** (gym `Europe/Athens`; inject "today" through a test clock provider `Clock` with `now(): Date`, overridden in tests):
  - Today 2027-01-31: sell 1-month time type without `startsOn` → `startsOn '2027-01-31'`, `endsOn '2027-02-28'`, status `active`; one cash payment of the given amount; one `membership.sold` row.
  - Sell again the same day → starts `'2027-03-01'` (after the current end), status `upcoming`.
  - Edit the type's price and name, then archive it: existing membership still shows the old name and `price_cents`; selling the archived type → `409`. *(Review Focus 4)*
  - Day pass → `startsOn = endsOn = today`, `visitsTotal 1`. 10-visit pack without validity → `endsOn null`, `remaining.visits 10`.
  - Selling to a user who is not a member of this gym → `404`. `startsOn` yesterday → `400`. Trainer → `403`.
  - Void as owner → `204`; membership status `voided`; payment has `voidedBy` and the reason; second void → `409`; reception void → `403`. *(Review Focus 5)*
  - `GET /payments?from=2027-01-31&to=2027-01-31` lists both payments with member and recorder names. Two-gym isolation for both tables.
- [x] **Step 2: Run** `pnpm --filter api test memberships` → FAIL.
- [x] **Step 3: Implement.** Consult database-expert on the schema and indexes.
- [x] **Step 4: Run** `pnpm --filter api test` → PASS.
- [x] **Step 5: Commit** `feat: sell and renew memberships, record and void payments`.

---

### Task 8: Freezes

**Files:**
- Create: `apps/api/src/db/schema/membership-freezes.ts`, migration `0008_freezes.sql`
- Create: `apps/api/src/memberships/freezes.controller.ts`, `freezes.service.ts`
- Modify: `packages/shared/src/schemas/memberships.ts`
- Test: `apps/api/test/freezes.e2e.spec.ts`, `apps/api/test/db/rls.spec.ts` (extend)

**Interfaces:**
- Table `membership_freezes(id, gym_id, membership_id FK, starts_on date, ends_on date CHECK (ends_on >= starts_on), created_by FK, created_at, ended_early_at timestamptz NULL)`. RLS.
- Shared: `CreateFreezeSchema { startsOn, endsOn }`; `Freeze`.
- Rules (one transaction, row-lock the membership `FOR UPDATE`):
  - Only `time` memberships that aren't voided or expired (`409` otherwise).
  - `startsOn` ≥ today. No overlap with another freeze of the same membership.
  - Total frozen days, including this one, ≤ `max_freeze_days` (`409` with `{ message, remainingFreezeDays }`).
  - On success: `memberships.ends_on = effectiveEnd(base_ends_on, freezes)`.
- Routes (`@GymRoles('reception')`):
  - `POST /gyms/:gymId/memberships/:id/freezes` → `201 Freeze`.
  - `POST /gyms/:gymId/freezes/:id/end` → `204`. A freeze not started yet is deleted. A running freeze gets `ends_on = today − 1` and `ended_early_at = now()`, or is deleted if it started today. Recompute `ends_on`.
  - History rows: `freeze.created` and `freeze.ended`.

- [x] **Step 1: Write the failing tests** (type: 1 month, `max_freeze_days 14`; sold 2027-05-01 → base end 2027-05-31):
  - Freeze 05-10..05-16 → `201`; membership `effectiveEndsOn '2027-06-07'`; status on 05-12 `frozen`.
  - Second freeze 05-20..05-27 (8 days, total 15) → `409` with `remainingFreezeDays: 7`. Overlapping freeze → `409`. Freeze starting yesterday → `400`.
  - Ending the running freeze on 05-12 → freeze becomes 05-10..05-11; `effectiveEndsOn '2027-06-02'`.
  - Freezing a visit pack → `409`.
  - While frozen, selling another 1-month time membership without `startsOn` starts it on `'2027-06-08'`. *(Review Focus 3)*
  - History has `freeze.created` and `freeze.ended`. Two-gym isolation.
- [x] **Step 2: Run** `pnpm --filter api test freezes` → FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run** `pnpm --filter api test` → PASS.
- [x] **Step 5: Commit** `feat: freeze and unfreeze memberships`.

---

### Task 9: Members list, member detail, "my membership" (API)

**Files:**
- Create: `apps/api/src/members/members.module.ts`, `members.controller.ts`, `members.service.ts`
- Modify: `packages/shared/src/schemas/members.ts` (new), `index.ts`
- Test: `apps/api/test/members.e2e.spec.ts`

**Interfaces:**
- Shared:
  - `MemberSummary { userId, firstName, lastName, email, emailVerified, phone, joinedAt, status: 'new' | 'active' | 'frozen' | 'expiring' | 'expired', currentEndsOn: string | null, visitsLeft: number | null }`.
    - `new`: no non-voided membership ever.
    - `expiring`: active, and the effective end is within 7 days, or 2 or fewer visits left.
  - `MemberDetail extends MemberSummary { dateOfBirth, emergencyContactName, emergencyContactPhone, memberships: Membership[], payments: Payment[], freezes: Freeze[] }`.
  - `MyMemberships { memberships: Membership[] }` (non-voided, newest first).
- Routes:
  - `GET /gyms/:gymId/members?q=&status=` (`@GymRoles('reception')`). `q` matches first name, last name, email or phone (case- and accent-insensitive for Greek, using the `unaccent` extension or a normalised search column; database-expert decides). Sorted newest sign-up first. Max 100 results.
  - `GET /gyms/:gymId/members/:memberId` (`@GymRoles('reception')`) → `MemberDetail`. Payments are included only for owner callers (reception sees `payments: []`). Not a member of this gym → `404`.
  - `GET /gyms/:gymId/me/memberships` (`@GymRoles('member')`) → `MyMemberships` for the caller only.

- [x] **Step 1: Write the failing tests:**
  - A fresh sign-up appears with `status: 'new'`. After a sale → `active`. With 5 days left → `expiring`. After the end → `expired`. While frozen → `frozen`.
  - `q=γιωργος` finds "Γιώργος"; `q=6912` finds the phone `+306912345678`; a member of another gym is never listed.
  - Reception detail has `payments: []`; owner detail includes them.
  - A member calling `/me/memberships` gets only their own; a member calling `/members` → `403`.
- [x] **Step 2: Run** `pnpm --filter api test members` → FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run** `pnpm --filter api test` → PASS.
- [x] **Step 5: Commit** `feat: members list and detail, member's own memberships`.

---

### Task 10: Web, sign-up flow

**Files:**
- Create: `apps/web/src/features/signup/NewMemberCodeDialog.tsx` (reception), `apps/web/src/pages/JoinPage.tsx` (`/join`, public), `apps/web/src/pages/VerifyEmailPage.tsx` (`/verify-email/:token`, public), `apps/web/src/components/EmailNotVerifiedBanner.tsx`
- Modify: router, reception shell (button "Νέος κωδικός μέλους"), `el.json`, `en.json`, `apps/api/src/mail/templates/verify-email.ts` (link `${WEB_ORIGIN}/verify-email/<token>`)
- Test: `apps/web/src/features/signup/signup.spec.tsx`, `e2e/signup.spec.ts`

**Interfaces:**
- `NewMemberCodeDialog`: calls `POST signup-codes`, shows the code in large monospace (≥ 48 px), the expiry time in gym time, a "copy" button and a "new code" button.
- `JoinPage`: one-column form for phones. Field order: code, first name, last name, email, mobile, date of birth (native date input), password, optional emergency contact (collapsed by default), privacy checkbox. Uses `SignupSchema` client-side. On `{ signInRequired: true }`, shows "Έχεις ήδη λογαριασμό — συνδέσου" with a link to `/login`. On `410`, shows a message to ask reception for a new code.
- `EmailNotVerifiedBanner`: shown in the member shell when `me.emailVerified` is false, with a "Στείλε ξανά" button.

- [ ] **Step 1: Write the failing tests:**
  - Unit: the dialog shows the code returned by a mocked API; the join form shows field errors in Greek for a 7-character password and an empty phone; a `410` response shows the "new code" message; `signInRequired` shows the login link.
  - E2E: owner invites a receptionist → reception signs in → creates a code → in a new browser context, `/join` with that code → member shell with the not-verified banner → open the verification link from Mailpit → banner gone.
- [ ] **Step 2: Run** `pnpm --filter web test signup && pnpm e2e` → FAIL.
- [ ] **Step 3: Implement.** Run ui-ux-reviewer on the three new components and the page. Check at 375 px in Greek.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): reception sign-up codes, join page, email confirmation`.

---

### Task 11: Web, members, selling, freezes, my membership, payments, history

**Files:**
- Create: `apps/web/src/features/members/MembersPage.tsx`, `MemberDetailPage.tsx`, `SellMembershipDialog.tsx`, `FreezeDialog.tsx`, `StatusBadge.tsx`
- Create: `apps/web/src/features/my-membership/MyMembershipCard.tsx` (member home)
- Create: `apps/web/src/features/payments/PaymentsPage.tsx` (owner, with void dialog), `apps/web/src/features/audit/HistoryPage.tsx` (owner)
- Create: `apps/web/src/lib/format.ts` (`formatMoney(cents, locale)`, `formatDate(iso, locale)`)
- Modify: router, shells, `el.json`, `en.json`
- Test: one `*.spec.tsx` beside each component; `apps/web/src/lib/format.spec.ts`; `e2e/memberships.spec.ts`

**Interfaces:**
- `StatusBadge`: colour **and** text for `new | active | frozen | expiring | expired | upcoming | used_up | voided` (spec: never colour only).
- `SellMembershipDialog`: lists unarchived types, prefills the amount with the type's price (editable for discounts), method cash/card (default cash), optional start date. Shows the computed start/end returned by the API after the sale.
- `FreezeDialog`: start and end date, shows freeze days left (`max_freeze_days − used`).
- `MyMembershipCard`: the current membership's name; a large "N ημέρες" or "N επισκέψεις" remaining; end date; frozen and expired states; the next upcoming membership if any.
- `PaymentsPage`: date range (default today), list with totals for cash and card, and a void action that requires a reason.
- `HistoryPage`: newest first, "load more" using `nextBefore`, readable sentences per action in el/en (e.g. "Η Μαρία πούλησε «Μηνιαία» στον Γιώργο — 40,00 €, μετρητά").

- [ ] **Step 1: Write the failing tests:**
  - `formatMoney(4000, 'el')` = `'40,00 €'`; `formatMoney(4000, 'en')` = `'€40.00'`; `formatDate('2027-02-28', 'el')` = `'28/2/2027'`.
  - `StatusBadge` renders visible text for each status.
  - Sell dialog: the amount prefilled with the type price; changing to card sends `method: 'card'`.
  - `MyMembershipCard`: 3 days left shows "3 ημέρες"; a frozen membership shows the frozen state and the new end date.
  - Payments page: totals per method; void needs a reason before the button enables.
  - E2E: owner creates a type → reception sells it to a signed-up member → the member sees days remaining → reception freezes it → the member sees the frozen state → owner voids the payment → the member sees no active membership → the history shows sale, freeze, void.
- [ ] **Step 2: Run** `pnpm --filter web test && pnpm e2e` → FAIL.
- [ ] **Step 3: Implement.** Run ui-ux-reviewer on each new component (reception screens readable at a glance; member card at 375 px).
- [ ] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm -r test && pnpm e2e` → PASS.
- [ ] **Step 5: Commit** `feat(web): members, selling, freezes, my membership, payments, history`.

---

## Self-review notes

- **Spec coverage:**
  - §6.0 sign-up → T2, T3, T10.
  - §6.1 types → T5; selling and renewal → T6, T7; payments and void → T7, T11; freeze → T6, T8; remaining time → T6, T9, T11.
  - §6.10 history → T4 (+ events in T3, T5, T7, T8); §5 permissions → per-route guards in every task; §8 least privilege → T1, T9 (payments owner-only).
  - Phase 0–1 open questions → T1.
- **Deferred to plan 2b (front desk):** QR check-in, kiosk device account, live reception screen, who's in, renewals list, visit counting on check-in, member photo (MinIO). Reminder emails and push → phase 5 per spec §9.
