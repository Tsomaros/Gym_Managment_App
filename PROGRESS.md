# Progress

## Last finished
- 2026-11-15: Task 8 (web app shell): bilingual PWA (el default, en), sign-in, invite page, gym picker, one area per role, platform "Create gym" form. Playwright e2e (`pnpm e2e`) covers admin → create gym → Mailpit invite → owner in Greek → English. All 8 tasks of phase 0–1 are done and the whole-branch review is closed (25 shared + 28 web + 99 API tests + 1 e2e).
- 2026-11-15: Task 7 (gym creation by the platform admin, email invitations, account creation on accept). Deviation from the plan, for security: accepting an invite for an **existing** account adds the roles but does not sign in (`{ signInRequired: true }`); the person signs in with their own password. Reception may invite members only. 96 API tests pass. Manual check done: Greek invite email in Mailpit.
- 2026-11-15: Task 6 (access control). Gym routes use `@GymRoles(...)` (owner covers reception; platform admin has no implicit gym access); platform routes use `@PlatformAdmin()`. A test fails if any `/gyms/:gymId` route lacks `@GymRoles`.
- 2026-11-15: Task 5 (sign-in, rotating refresh tokens, sign-out, /auth/me). The API seeds the platform admin from `.env` (PLATFORM_ADMIN_EMAIL/PASSWORD) at startup. 60 API tests pass.
- 2026-11-15: Task 4 (shared zod schemas: email, login, accept-invite, create-gym, invite, /auth/me response). `@gym/shared` is wired into the API: tests and typecheck read its TypeScript source, `nest build` and the running API use its `dist/` (built automatically by `build` / `start:dev`; restart `start:dev` after editing shared).
- 2026-11-15: Task 3 (core schema, migrations, row-level security). Tables gyms, users, gym_roles, refresh_tokens, invitations; RLS forced on gym tables; gym_app limited by column grants and a trigger (cannot make platform admins). 45 API tests pass. Migrations: `pnpm --filter api db:migrate`; tests migrate gym_test themselves.
- 2026-11-15: Task 2 (monorepo, Docker services, API health check, CI) on branch `phase0-1-foundation`. `pnpm lint`, `pnpm typecheck`, `pnpm -r test` (22 tests) pass on Windows. CI workflow written but **not run yet** (repo has no git remote).
- 2026-11-15: Task 1 (PWA push spike): install + push confirmed on iPhone (iOS 27, Greece) and Android 10. Lesson for the real app: subscribe through `navigator.serviceWorker.ready`. Result: `docs/spikes/2026-11-pwa-push.md`.
- 2026-11-15: Design approved, plan for phases 0–1 written, Claude Code agents/hooks/skills adapted from LLM_Movies_Prediction_Model.

## In progress
- Phase 0–1 complete and reviewed (fresh reviewer: "with fixes", both pre-merge fixes done). Branch `phase0-1-foundation` awaits a merge decision. Decisions and rulings: `docs/superpowers/plans/2026-11-15-phase0-1-foundation.ledger.md`.

## Local setup (Windows PC)
- Copy `.env.example` to `.env` and set real passwords (the local `.env` already exists, with random values).
- `docker compose up -d --wait`. Postgres listens on host port **5433** (5432 belongs to another project). Mailpit: http://localhost:8025, MinIO console: http://localhost:9001.
- MinIO image is `cgr.dev/chainguard/minio` (MinIO no longer publishes free images on Docker Hub).
- If you edit `docker/postgres/init.sql`: `docker compose down -v && docker compose up -d --wait`.
- API: `pnpm --filter api start:dev`, health at http://localhost:3000/health. Web: `pnpm --filter web dev` → http://localhost:5173 (calls the API through the /api proxy). E2E: `pnpm e2e` (uses gym_test; run `pnpm exec playwright install chromium` once).

## Execution
- Native (superpowers:executing-plans) on branch `phase0-1-foundation`. Ledger copy (committed): `docs/superpowers/plans/2026-11-15-phase0-1-foundation.ledger.md`. CLAUDE.md hard rules (code-reviewer, test-auditor, ui-ux-reviewer, database-expert) apply per task; one whole-branch review at the end of the plan.

## Environment (Windows PC)
- Node 24.22.1 locally (CI and `.nvmrc` use Node 22), pnpm 10.34.9, Docker 29.9.2. TypeScript is pinned to ~6.0 because typescript-eslint doesn't support 7 yet.

## Open questions
- Before Phase 2 member screens: `users` is readable by every gym (no RLS). Add a users SELECT policy, or a rule + test that gym code reaches users only through gym_roles?
- Before any deployment: the API holds gym_owner (DDL) credentials for systemDb. Add a `gym_system` role (BYPASSRLS, DML only) and DATABASE_SYSTEM_URL.
- CLAUDE.md still shows the RLS policy without `nullif(..., '')`; the code and plan use the nullif form (required on pooled connections).
- Login throttling (brute-force protection) is not in the phase 0–1 plan. Add `@nestjs/throttler` on /auth/login before the pilot?
- Deployment: the web app and API must share a site (refresh cookie is SameSite=Strict). The browser calls /api/*; the production proxy must strip /api, and set COOKIE_PATH=/api/auth.
