# Progress

## Last finished
- 2026-11-15: Task 2 (monorepo, Docker services, API health check, CI) on branch `phase0-1-foundation`. `pnpm lint`, `pnpm typecheck`, `pnpm -r test` (22 tests) pass on Windows. CI workflow written but **not run yet** (repo has no git remote).
- 2026-11-15: Task 1 (PWA push spike): install + push confirmed on iPhone (iOS 27, Greece) and Android 10. Lesson for the real app: subscribe through `navigator.serviceWorker.ready`. Result: `docs/spikes/2026-11-pwa-push.md`.
- 2026-11-15: Design approved, plan for phases 0–1 written, Claude Code agents/hooks/skills adapted from LLM_Movies_Prediction_Model.

## In progress
- Next: Task 3 (core schema, migrations, row-level security). Continue in **Claude Code on Windows**: the cloud side can't install npm packages or reach Docker on this account.
- Notes for Task 3: `gym_app` has no table privileges yet (grant them in `0001_rls.sql`, consult database-expert); RLS tests must connect as `gym_app`, since `gym_owner` has BYPASSRLS.
- Note for Task 4: `@gym/shared` exports `dist/` but nothing builds it and `api` doesn't depend on it yet. Fix that when shared is first imported.

## Local setup (Windows PC)
- Copy `.env.example` to `.env` and set real passwords (the local `.env` already exists, with random values).
- `docker compose up -d --wait`. Postgres listens on host port **5433** (5432 belongs to another project). Mailpit: http://localhost:8025, MinIO console: http://localhost:9001.
- MinIO image is `cgr.dev/chainguard/minio` (MinIO no longer publishes free images on Docker Hub).
- If you edit `docker/postgres/init.sql`: `docker compose down -v && docker compose up -d --wait`.
- API: `pnpm --filter api start:dev`, health at http://localhost:3000/health.

## Execution
- Native (superpowers:executing-plans) on branch `phase0-1-foundation`. Ledger: `.superpowers/sdd/2026-11-15-phase0-1-foundation/progress.md` (git-ignored, on this PC). CLAUDE.md hard rules (code-reviewer, test-auditor, ui-ux-reviewer, database-expert) apply per task; one whole-branch review at the end of the plan.

## Environment (Windows PC)
- Node 24.22.1 locally (CI and `.nvmrc` use Node 22), pnpm 10.34.9, Docker 29.9.2. TypeScript is pinned to ~6.0 because typescript-eslint doesn't support 7 yet.

## Open questions
- None.
