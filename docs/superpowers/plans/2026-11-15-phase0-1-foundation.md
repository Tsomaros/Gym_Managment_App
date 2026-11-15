# Phase 0–1: Spike + Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove PWA install + push works on iPhone in Greece, then build the multi-gym foundation: monorepo, database with per-gym isolation, sign-in, roles, account invitations, and a bilingual web app shell per role.

**Architecture:** pnpm monorepo with a NestJS API (`apps/api`), a React/Vite PWA (`apps/web`) and shared types/schemas (`packages/shared`). PostgreSQL enforces gym isolation with Row-Level Security. The API connects as a non-owner role and sets the current gym per request inside a transaction.

**Tech Stack:** Node 22, pnpm 10, TypeScript (strict), NestJS, Drizzle ORM + drizzle-kit, PostgreSQL 17, argon2, jsonwebtoken, zod, Nodemailer, React 19 + Vite, React Router, TanStack Query, i18next, Tailwind + shadcn/ui, vite-plugin-pwa, Vitest, Supertest, Playwright, Docker Compose (Postgres, MinIO, Mailpit).

**Spec:** `docs/superpowers/specs/2026-11-15-gym-management-design.md` (§3, §5, §7 are implemented here; §9 phases 0–1)

## Global Constraints

- TypeScript `strict: true` everywhere. No `any` in exported signatures.
- All timestamps are `timestamptz`, stored UTC. `gyms.timezone` is an IANA name, default `'Europe/Athens'`.
- Every gym-owned table has `gym_id uuid NOT NULL REFERENCES gyms(id)` and RLS enabled **and forced**, with policy `gym_id = current_setting('app.gym_id', true)::uuid`.
- The API's runtime DB role is `gym_app` (not table owner, no `BYPASSRLS`). Migrations run as `gym_owner`.
- Emails are normalised with `trim().toLowerCase()` before storage and lookup.
- Gym roles: `'owner' | 'reception' | 'trainer' | 'member'`. Platform admin is `users.is_platform_admin boolean`.
- Passwords: argon2id. Minimum length 8.
- Access token: JWT, 15 minutes. Refresh token: opaque random 32 bytes, 30 days, stored hashed (sha256), rotated on every use, httpOnly + Secure + SameSite=Strict cookie named `gym_rt`, path `/auth`.
- Invitation tokens: single use, expire after 72 hours, stored hashed.
- UI languages `el` and `en`. Default `el`. Missing keys fall back to `en`.
- Gym context travels in the URL as `/gyms/:gymId/...` for gym-scoped API routes.

## Review Focus

1. **Same person, second gym or second role:** inviting an email that already has an account adds a `gym_roles` row; it never creates a duplicate user or resets their password. (Task 7)
2. **Email casing and spaces:** `" Maria@Example.com"` and `"maria@example.com"` are the same account at login and at invitation. (Tasks 5, 7)
3. **Several requests with an expired access token at once:** the web client performs exactly one refresh and retries all of them; a reused (already rotated) refresh token revokes that whole session. (Tasks 5, 8)
4. **Query with no gym context:** returns zero rows. It never returns all gyms' rows, and inserts fail. (Task 3)
5. **Greek text:** names like "Γιώργος Παπαδόπουλος" round-trip through API and UI unchanged, and a key missing from `el.json` shows the English text rather than the raw key. (Tasks 7, 8)

---

### Task 1: PWA install + push spike (throwaway)

Proves spec §4 option A on real phones before anything else is built. No tests; manual checklist.

**Files:**
- Create: `spike/pwa-push/index.html`, `spike/pwa-push/sw.js`, `spike/pwa-push/manifest.webmanifest`, `spike/pwa-push/server.mjs`, `spike/pwa-push/README.md`
- Create: `docs/spikes/2026-11-pwa-push.md` (result record)

**Interfaces:** none (isolated; nothing later imports it).

- [ ] **Step 1: Build the spike.** `server.mjs` (plain Node + `web-push`) serves the static files, exposes `GET /vapid-public-key`, `POST /subscribe` (keeps subscriptions in memory) and `POST /send` (pushes "Η συνδρομή σου λήγει σε 5 ημέρες" to all). The page has a "Enable notifications" button (permission must be requested from a user tap) and shows `navigator.standalone`/`display-mode` state.
- [ ] **Step 2: Expose over HTTPS.** Run `cloudflared tunnel --url http://localhost:3000` (quick tunnel) and open the URL.
- [ ] **Step 3: Test on an iPhone (iOS ≥ 16.4) with a Greek App Store region and an Android phone.** Checklist, each recorded pass/fail in `docs/spikes/2026-11-pwa-push.md`:
  - Safari → Share → Add to Home Screen; app opens without Safari bars.
  - Tap "Enable notifications" inside the installed app; permission granted.
  - `POST /send` → notification appears on the lock screen with the app closed.
  - Android Chrome: install prompt, permission, notification.
- [ ] **Step 4: Decision gate.** If iPhone push fails in Greece, **stop and report**; spec §4 must be revisited before Task 2. If it passes, commit:

```bash
git add spike docs/spikes && git commit -m "spike: verify PWA install and web push on iOS (GR) and Android"
```

---

### Task 2: Monorepo, local services, API health check, CI

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.eslintrc.cjs`, `.prettierrc`, `.gitignore`, `.env.example`
- Create: `docker-compose.yml` (services `postgres:17`, `minio/minio`, `axllent/mailpit`), `docker/postgres/init.sql`
- Create: `apps/api/` (Nest app: `src/main.ts`, `src/app.module.ts`, `src/health/health.controller.ts`, `src/config/env.ts`)
- Create: `packages/shared/` (`src/index.ts`, `src/roles.ts`)
- Create: `.github/workflows/ci.yml`
- Test: `apps/api/test/health.e2e.spec.ts`

**Interfaces:**
- Produces: `loadEnv(): Env` in `apps/api/src/config/env.ts` (zod-validated; keys `DATABASE_URL`, `DATABASE_MIGRATOR_URL`, `JWT_SECRET`, `WEB_ORIGIN`, `SMTP_URL`, `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD`). Throws on missing keys.
- Produces: `export const GYM_ROLES = ['owner','reception','trainer','member'] as const; export type GymRole = typeof GYM_ROLES[number];` in `packages/shared/src/roles.ts`.
- Produces: `createApp(): Promise<INestApplication>` in `apps/api/src/main.ts` (used by every e2e test).

- [x] **Step 1: Write the failing test** `health.e2e.spec.ts`: `GET /health` → `200`, body `{ status: 'ok' }`.
- [x] **Step 2: Run** `pnpm --filter api test:e2e` → FAIL (no app).
- [x] **Step 3: Implement** the workspace, compose file and Nest app. `docker/postgres/init.sql` creates roles `gym_owner` (owns the DB) and `gym_app` (LOGIN, NOSUPERUSER, NOBYPASSRLS) and database `gym_test` for tests.
- [x] **Step 4: Run** `docker compose up -d && pnpm --filter api test:e2e` → PASS. Run `pnpm lint` → no errors.
- [x] **Step 5: CI.** `ci.yml` on push: setup pnpm, start a `postgres:17` service with `init.sql`, run `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm -r test`.
- [x] **Step 6: Commit** `chore: monorepo, docker services, api health check, CI`.

---

### Task 3: Core schema, migrations and Row-Level Security

**Files:**
- Create: `apps/api/drizzle.config.ts`
- Create: `apps/api/src/db/schema/gyms.ts`, `users.ts`, `gym-roles.ts`, `refresh-tokens.ts`, `invitations.ts`, `index.ts`
- Create: `apps/api/src/db/migrations/0001_rls.sql` (hand-written, runs after generated migration)
- Create: `apps/api/src/db/client.ts`, `apps/api/src/db/tenant.ts`
- Test: `apps/api/test/db/rls.spec.ts`

**Tables:**
- `gyms(id uuid pk default gen_random_uuid(), name text not null, timezone text not null default 'Europe/Athens', created_at timestamptz not null default now())`. RLS: `id = current_setting('app.gym_id', true)::uuid`.
- `users(id uuid pk, email text not null unique, password_hash text null, full_name text not null, locale text not null default 'el', is_platform_admin boolean not null default false, created_at timestamptz)`. **Global, no RLS.** Only reached through the auth service and gym-scoped joins.
- `gym_roles(gym_id uuid fk, user_id uuid fk, role text not null check (role in ('owner','reception','trainer','member')), created_at timestamptz, primary key (gym_id, user_id, role))`. RLS on `gym_id`.
- `refresh_tokens(id uuid pk, user_id uuid fk, family_id uuid not null, token_hash text not null unique, expires_at timestamptz not null, revoked_at timestamptz null, replaced_by uuid null)`. Global (owned by user), no RLS.
- `invitations(id uuid pk, gym_id uuid fk, email text not null, full_name text not null, roles text[] not null, token_hash text not null unique, expires_at timestamptz not null, accepted_at timestamptz null, invited_by uuid fk users)`. RLS on `gym_id`.

**Interfaces:**
- Produces: `db` (Drizzle instance on `DATABASE_URL`, role `gym_app`) and `systemDb` (on `DATABASE_MIGRATOR_URL`; used **only** by platform-admin gym creation and the token lookup paths in Tasks 5 and 7, where no gym is known yet) in `db/client.ts`.
- Produces: `withGym<T>(gymId: string, fn: (tx: Tx) => Promise<T>): Promise<T>` in `db/tenant.ts`. Opens a transaction, runs `select set_config('app.gym_id', $1, true)`, then `fn(tx)`.
- Produces: schema exports `gyms, users, gymRoles, refreshTokens, invitations` and type `Tx`.

- [x] **Step 1: Write the failing tests** in `rls.spec.ts` (seed gyms A and B with one `gym_roles` row each via `systemDb`):
  - `withGym(A, tx => tx.select().from(gymRoles))` returns only A's row.
  - `withGym(A, tx => tx.insert(gymRoles).values({ gymId: B, ... }))` rejects with `/row-level security/`.
  - `db.select().from(gymRoles)` with no gym set returns `[]`. *(Review Focus 4)*
  - `db.insert(gymRoles).values({ gymId: A, ... })` with no gym set rejects.
  - `withGym(A, tx => tx.select().from(gyms))` returns exactly gym A.
- [x] **Step 2: Run** `pnpm --filter api test -- rls` → FAIL.
- [x] **Step 3: Implement** the schema. Generate the migration with `drizzle-kit generate`. Write `0001_rls.sql`: for `gyms`, `gym_roles`, `invitations`: `ENABLE` + `FORCE ROW LEVEL SECURITY`, one policy `FOR ALL USING (...) WITH CHECK (...)`, and `GRANT SELECT, INSERT, UPDATE, DELETE ... TO gym_app`. Grant `gym_app` full DML on `users` and `refresh_tokens`. Add `pnpm --filter api db:migrate` script running as `gym_owner`.
- [x] **Step 4: Run** `pnpm --filter api db:migrate && pnpm --filter api test -- rls` → PASS.
- [x] **Step 5: Commit** `feat(db): core schema with per-gym row-level security`.

---

### Task 4: Shared validation schemas

**Files:**
- Create: `packages/shared/src/schemas/auth.ts`, `packages/shared/src/schemas/accounts.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/schemas.spec.ts`

**Interfaces:**
- Produces (zod, with inferred types of the same name without `Schema`):
  - `emailSchema` = string → `trim().toLowerCase()` → valid email.
  - `LoginSchema { email, password: string min 1 }`
  - `AcceptInviteSchema { token: string min 1, password: string min 8 }`
  - `CreateGymSchema { name: string 1..120, timezone: string (IANA; default 'Europe/Athens'), ownerEmail, ownerFullName: string 1..120 }`
  - `InviteSchema { email, fullName: string 1..120, roles: GymRole[] nonempty }`
  - `MeResponse { id, email, fullName, locale: 'el'|'en', isPlatformAdmin, gyms: { gymId, gymName, roles: GymRole[] }[] }`

- [x] **Step 1: Write the failing tests:** `emailSchema.parse(' Maria@Example.com ') === 'maria@example.com'` *(Review Focus 2)*; `AcceptInviteSchema` rejects a 7-character password; `InviteSchema` rejects `roles: []` and `roles: ['admin']`; `InviteSchema.parse({ fullName: 'Γιώργος Παπαδόπουλος', ... }).fullName` is unchanged *(Review Focus 5)*; `CreateGymSchema` defaults `timezone` to `'Europe/Athens'`.
- [x] **Step 2: Run** `pnpm --filter shared test` → FAIL.
- [x] **Step 3: Implement** the schemas.
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat(shared): validation schemas for auth and accounts`.

---

### Task 5: Sign-in, token refresh, sign-out, `/auth/me`

**Files:**
- Create: `apps/api/src/auth/auth.module.ts`, `auth.controller.ts`, `auth.service.ts`, `password.ts`, `tokens.ts`, `refresh-store.ts`
- Create: `apps/api/src/seed.ts` (creates the platform admin from env if missing)
- Test: `apps/api/test/auth.e2e.spec.ts`

**Interfaces:**
- Consumes: `db`, `systemDb`, `users`, `refreshTokens`, `gymRoles`, `gyms` (Task 3); `LoginSchema`, `MeResponse` (Task 4).
- Produces:
  - `hashPassword(plain: string): Promise<string>`, `verifyPassword(hash: string, plain: string): Promise<boolean>` in `password.ts`.
  - `signAccessToken(p: { sub: string; adm: boolean }): string`, `verifyAccessToken(t: string): { sub: string; adm: boolean }` in `tokens.ts` (15 min).
  - `RefreshStore.issue(userId: string, familyId?: string): Promise<string>`, `RefreshStore.rotate(raw: string): Promise<{ userId: string; raw: string }>`, `RefreshStore.revokeFamily(familyId: string): Promise<void>`.
  - Routes: `POST /auth/login` → `200 { accessToken }` + `gym_rt` cookie; `POST /auth/refresh` (cookie) → `200 { accessToken }` + new cookie; `POST /auth/logout` → `204`, cookie cleared, family revoked; `GET /auth/me` (Bearer) → `MeResponse`. `/auth/me` reads gym memberships through `systemDb` joined on `user_id = sub`.

- [x] **Step 1: Write the failing tests:**
  - Login with wrong password → `401`, same body as unknown email (`{ message: 'Invalid credentials' }`).
  - Login with `'  ADMIN@x.gr '` for seeded `admin@x.gr` → `200`. *(Review Focus 2)*
  - Login sets cookie `gym_rt` with `HttpOnly`, `SameSite=Strict`, `Path=/auth`.
  - `POST /auth/refresh` returns a new access token and a different cookie value.
  - Reusing the **old** refresh cookie → `401`, and the newer cookie from the same family is also rejected afterwards. *(Review Focus 3)*
  - `POST /auth/logout` then `POST /auth/refresh` → `401`.
  - `GET /auth/me` without token → `401`; with token → `MeResponse` with `isPlatformAdmin: true`, `gyms: []`.
- [x] **Step 2: Run** `pnpm --filter api test:e2e -- auth` → FAIL.
- [x] **Step 3: Implement** the module per the interfaces and Global Constraints. Rotation: mark the used row `revoked_at`, set `replaced_by`; on presenting a revoked token call `revokeFamily`.
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat(auth): login, rotating refresh tokens, logout, me`.

---

### Task 6: Access control (gym roles and platform admin)

**Files:**
- Create: `apps/api/src/access/jwt.guard.ts`, `roles.decorator.ts`, `gym-roles.guard.ts`, `platform-admin.guard.ts`, `gym-context.ts`
- Test: `apps/api/test/access.e2e.spec.ts` (registers a test-only controller)

**Interfaces:**
- Consumes: `verifyAccessToken` (Task 5), `withGym`, `gymRoles` (Task 3).
- Produces:
  - `JwtGuard`: sets `req.user = { id: string; isPlatformAdmin: boolean }`.
  - `@GymRoles(...roles: GymRole[])` decorator and `GymRolesGuard`: reads `:gymId`, loads the caller's roles in that gym inside `withGym(gymId, ...)`, sets `req.gym = { id: string; roles: GymRole[] }`, `403` if no intersection. `'owner'` satisfies any `'reception'` requirement (spec §5).
  - `PlatformAdminGuard`: `403` unless `req.user.isPlatformAdmin`.
  - `@CurrentGym()` param decorator returning `req.gym`.
  - Platform admin gets **no** implicit access to gym-scoped routes.

- [x] **Step 1: Write the failing tests** against test routes `GET /gyms/:gymId/_owner` (`@GymRoles('owner')`), `GET /gyms/:gymId/_desk` (`@GymRoles('reception')`), `GET /platform/_ping` (`PlatformAdminGuard`):
  - member of gym A → `/gyms/A/_owner` `403`.
  - owner of gym A → `/gyms/A/_desk` `200` (owner ⊇ reception).
  - owner of gym A → `/gyms/B/_owner` `403`.
  - platform admin → `/platform/_ping` `200`, `/gyms/A/_owner` `403`.
  - malformed `:gymId` (`not-a-uuid`) → `400`, not `500`.
- [x] **Step 2: Run** → FAIL.
- [x] **Step 3: Implement** guards and decorators. Validate `:gymId` with `ParseUUIDPipe`.
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat(access): gym role and platform admin guards`.

---

### Task 7: Gyms, invitations and account creation

**Files:**
- Create: `apps/api/src/gyms/gyms.module.ts`, `platform-gyms.controller.ts`, `gyms.service.ts`
- Create: `apps/api/src/invitations/invitations.module.ts`, `invitations.controller.ts`, `invitations.service.ts`
- Create: `apps/api/src/mail/mail.module.ts`, `mail.service.ts`, `templates/invite.ts` (el + en text)
- Test: `apps/api/test/invitations.e2e.spec.ts`

**Interfaces:**
- Consumes: Tasks 3–6.
- Produces:
  - `MailService.send(msg: { to: string; subject: string; text: string }): Promise<void>` (Nodemailer on `SMTP_URL`; tests replace it with an in-memory fake exposing `sent: Msg[]`).
  - `POST /platform/gyms` (`PlatformAdminGuard`, body `CreateGymSchema`) → `201 { gymId }`; creates the gym via `systemDb` and an owner invitation.
  - `POST /gyms/:gymId/invitations` (`@GymRoles('owner')` for any roles; `@GymRoles('reception')` may only invite `['member']`, else `403`) body `InviteSchema` → `201 { invitationId }`.
  - `POST /auth/accept-invite` body `AcceptInviteSchema` → `200 { accessToken }` + cookie. Looks up the token hash via `systemDb`; creates the user if the email is new (sets password), otherwise **only** adds `gym_roles` rows and ignores the password field; marks invitation accepted.
  - Invite link format: `${WEB_ORIGIN}/invite/${rawToken}`, emailed in the invitee's locale (default `el`).

- [x] **Step 1: Write the failing tests:**
  - Platform admin creates gym "Γυμναστήριο Ναυπάκτου" → owner invite email captured containing `/invite/`.
  - Accepting the invite → `/auth/me` lists that gym with `roles: ['owner']`.
  - Same token accepted twice → `410`. Token older than 72 h (set `expires_at` in the past) → `410`.
  - Reception invites `roles: ['trainer']` → `403`; `roles: ['member']` → `201`.
  - Existing user `maria@x.gr` (member of gym A) invited to gym B as `' Maria@X.gr'` → after accept, `users` still has one row for that email, the password hash is unchanged, `/auth/me` shows both gyms. *(Review Focus 1, 2)*
  - Member full name `'Γιώργος Παπαδόπουλος'` is returned byte-identical by `/auth/me`. *(Review Focus 5)*
- [x] **Step 2: Run** → FAIL.
- [x] **Step 3: Implement.** All gym-scoped writes go through `withGym`.
- [x] **Step 4: Run** → PASS. Manual check: `docker compose up`, create a gym with curl, open Mailpit at `http://localhost:8025` and see the Greek invite email.
- [x] **Step 5: Commit** `feat: gym creation and email invitations for staff and members`.

---

### Task 8: Web app shell (bilingual PWA, sign-in, per-role areas)

**Files:**
- Create: `apps/web/` (Vite React TS): `src/main.tsx`, `src/App.tsx`, `src/router.tsx`
- Create: `src/i18n/index.ts`, `src/i18n/el.json`, `src/i18n/en.json`
- Create: `src/api/client.ts`, `src/auth/AuthProvider.tsx`, `src/auth/RequireAuth.tsx`
- Create: `src/pages/LoginPage.tsx`, `src/pages/AcceptInvitePage.tsx`, `src/pages/GymPickerPage.tsx`
- Create: `src/shells/OwnerShell.tsx`, `ReceptionShell.tsx`, `TrainerShell.tsx`, `MemberShell.tsx`, `PlatformShell.tsx`, `src/components/LanguageSwitch.tsx`
- Modify: `apps/web/vite.config.ts` (vite-plugin-pwa: name "Gym", `display: 'standalone'`, icons 192/512)
- Test: `apps/web/src/api/client.spec.ts`, `apps/web/src/router.spec.tsx`, `apps/web/src/i18n/i18n.spec.ts`, `e2e/foundation.spec.ts` (Playwright, root)

**Interfaces:**
- Consumes: API routes from Tasks 5 and 7; `MeResponse`, `LoginSchema`, `AcceptInviteSchema` (Task 4).
- Produces:
  - `apiFetch<T>(path: string, init?: RequestInit): Promise<T>` in `api/client.ts`: adds the Bearer token; on `401` performs a single shared `POST /auth/refresh` (concurrent callers await the same promise), retries once, otherwise signs out.
  - `useAuth(): { me: MeResponse | null; login(email, password): Promise<void>; logout(): Promise<void> }`.
  - Routes: `/login`, `/invite/:token`, `/gyms` (picker when the user has more than one gym), `/g/:gymId/*` → shell for the highest role in that gym (`owner` > `reception` > `trainer` > `member`), `/platform/*` for platform admins. Each shell is a layout with nav and a placeholder page titled by an i18n key.
  - Language: `LanguageSwitch` toggles `el`/`en` and persists to `localStorage` key `gym.lang` (wrapped in try/catch).

- [x] **Step 1: Write the failing tests:**
  - `client.spec.ts`: three parallel `apiFetch` calls receive `401`, then exactly **one** call to `/auth/refresh` is made and all three resolve after retry. *(Review Focus 3)*
  - `router.spec.tsx`: `me` with roles `['trainer','member']` in one gym → visiting `/` lands on `TrainerShell`; with two gyms → `/gyms` picker; unauthenticated → `/login`.
  - `i18n.spec.ts`: default language `el`; `t('test.onlyInEnglish')` (key present only in `en.json`) returns the English string, not the key. *(Review Focus 5)*
  - `e2e/foundation.spec.ts`: seeded platform admin logs in → creates a gym → opens the invite link from Mailpit's API → sets a password → lands on `OwnerShell` in Greek → switches to English and the nav changes language.
- [x] **Step 2: Run** `pnpm --filter web test` and `pnpm e2e` → FAIL.
- [x] **Step 3: Implement** pages, shells, client and i18n. Platform shell has a "Create gym" form calling `POST /platform/gyms`.
- [x] **Step 4: Run** both → PASS. Manual check: Lighthouse PWA "installable" passes on `pnpm --filter web build && pnpm --filter web preview`.
- [x] **Step 5: Commit** `feat(web): bilingual PWA shell with sign-in, invitations and role areas`.

---

## Self-review notes

- **Spec coverage (phases 0–1):** spike (§9 phase 0) → T1; repo/Docker/CI → T2; RLS/multi-gym (§7) → T3; accounts and sign-in (§7) → T4, T5; roles (§5) → T6; platform admin creates gyms, reception registers members (§7, §12) → T7; i18n el/en (§3), PWA, per-role shells → T8. Kiosk device accounts are deferred to the Phase 2 plan, which builds check-in.
- **Later phases** (memberships, check-in, shifts, plans, notifications, dashboard, classes, GDPR) each get their own plan.
