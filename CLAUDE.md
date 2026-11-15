# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A gym management app for a new gym opening around May 2027, built so other gyms can later sign up and run independently on the same platform (multi-tenant). Roles per gym: owner, reception, trainer, member; plus a platform admin (Dimitris). Members use an installable web app (PWA); a native store app may be added later on the same API.

- Spec: `docs/superpowers/specs/2026-11-15-gym-management-design.md` (source of truth for every decision)
- One detailed plan per phase in `docs/superpowers/plans/`; current: `2026-11-15-phase0-1-foundation.md`
- pnpm monorepo: `apps/api` (NestJS), `apps/web` (React + Vite PWA), `packages/shared` (types and zod schemas), `e2e/` (Playwright)
- Local services via `docker compose up -d`: PostgreSQL 17, MinIO (files), Mailpit (emails at http://localhost:8025)

## Hard rules

- When you finish a task that changes or creates code, always use the **code-reviewer** subagent.
- Whenever a new test is created, always use the **test-auditor** subagent on that test.
- Whenever a new frontend component is created, use the **ui-ux-reviewer** subagent to get feedback and improve the new component.
- For new tables, migrations, row-level security policies and slow queries, consult the **database-expert** subagent.

## Project rules (from the spec)

- **Gym isolation.** Every gym-owned table has `gym_id uuid NOT NULL` and row-level security enabled **and forced**, with the policy `gym_id = current_setting('app.gym_id', true)::uuid`. Every new gym-owned table gets an isolation test with at least two gyms.
- The API runs as the DB role `gym_app` (not owner, no `BYPASSRLS`). Gym-scoped reads and writes go through `withGym(gymId, fn)`. `systemDb` (owner role) is used only where no gym is known yet: platform-admin gym creation and token lookups.
- Gym-scoped routes live under `/gyms/:gymId/...` and carry a `@GymRoles(...)` guard. The owner satisfies any reception requirement. The platform admin has no implicit access to gym data.
- Emails are normalised with `trim().toLowerCase()`. Inviting an existing email adds a role; it never creates a second account.
- Timestamps are `timestamptz` in UTC; anything "per day" uses the gym's `timezone` (default `Europe/Athens`).
- Every visible string goes through i18next, with Greek (`el`, default) and English (`en`).
- Personal and health data (measurements, photos) need explicit consent and are served only through signed, expiring links (GDPR).
- Secrets (`JWT_SECRET`, SMTP, DB passwords) come from `.env`, never git. `.env.example` lists every key.
- Tests run offline. API integration tests use the `gym_test` database from Docker.

## Working from two places

Work alternates between Claude Code on this Windows PC and a claude.ai cloud session that reaches this folder through a Linux shell. Both sides share state only through this folder:

- **Progress lives in the files:** tick the plan's checkboxes (`- [x]`) as steps finish, and keep `PROGRESS.md` current (last finished task, what is in progress, open questions). Read both before starting.
- **Commit at the end of every task**, so the other side starts from a clean `git status`.
- **Never share `node_modules` across operating systems:** `node_modules/` belongs to Windows (native modules such as argon2 are built per OS). The Linux side installs and runs tests in its own copy outside the folder (e.g. `rsync -a --exclude node_modules --exclude .git ./ $HOME/gym-linux/`) and edits code only in the folder.
- Docker services run in Docker Desktop on Windows; the Linux shell can't reach them on localhost.
- Line endings are fixed by `.gitattributes` (`* text=auto eol=lf`; `*.ps1 text eol=crlf`).
- The subagents and their PowerShell hooks run only in Claude Code on Windows. On the cloud side, reviews follow the same agent files, run by a fresh agent, without hook enforcement; note that in `PROGRESS.md`.
