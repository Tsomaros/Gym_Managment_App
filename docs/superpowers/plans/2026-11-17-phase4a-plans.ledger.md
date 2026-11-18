# SDD ledger — plan: docs/superpowers/plans/2026-11-17-phase4a-plans.md
Base: dea32ed (branch phase4a-plans). Executed inline (superpowers:executing-plans); CLAUDE.md hard rules applied per task (code-reviewer, test-auditor, ui-ux-reviewer, database-expert); one whole-branch review at the end.
Pre-flight: T1→T2 (exercises table → plan_exercises FK, no cascade: archive-only), T2→T3 (shared Plan types, tables → save-plan/plan-access), T3→T4 (planAccess, savePlanTree → templates copy, pdf), T1/T3/T4→T5–T7 (shared types, routes). No conflicts found.
Task 1: Ruling: GET /exercises uses @GymRoles('trainer','owner') — the guard lets owner satisfy only 'reception', plan says "owner passes too" — none.
Task 1: Ruling: unique index is plain lower(name_el) (no IMMUTABLE unaccent wrapper) plus an accent/final-sigma pre-check in the service (409), per database-expert — accent-only twin could race in; costs a rare duplicate.
Task 1: Ruling: no search index (≤500 rows/gym, unaccent is STABLE) — database-expert + code-reviewer agree — slower search only if a gym had thousands.
Task 1: Ruling: existing gyms are backfilled by seedGymsWithoutExercises() at API startup (main.ts), not SQL in the migration, so the default list has one source of truth in TS — a gym that exists but whose API never restarts has no list until restart.
Task 1: Ruling: archived exercises keep their name reserved (409 on reuse).
Task 1: complete (commits dea32ed..29de3a2, tests: pnpm -r test → apps/web test: Done)
Task 2: Ruling: PlanInput requires 1–14 days (blank plan starts with one day); duration 1–7200 s; a non-failure exercise may have both reps null (duration exercises); one id may appear once per save — spec silent — a plan with zero days can't be saved.
Task 2: Ruling: positions are 0-based (days 0–13, exercises 0–29, DB CHECKs) — database-expert — Task 3 savePlanTree must write 0-based positions.
Task 2: Ruling: composite (id, gym_id) FKs keep days/exercises/exercise refs in their plan's gym; UNIQUE(id,gym_id) added on exercises, plans, plan_days, plan_exercises — database-expert — none.
Task 2: Ruling: gym_app may UPDATE plan_exercises.plan_day_id so a moved exercise keeps its id (phase 4b log links) — database-expert — none.
Task 2: Ruling: restrictive RLS policy templates_only_delete (only templates deletable by gym_app) and privileges.spec RLS guard skips RESTRICTIVE policies (they only narrow access) — keeps member plans as history — none.
Task 2: Ruling: status/timestamps CHECK (archived ⇔ archived_at; active ⇒ activated_at); title/notes length CHECKs — database-expert — Task 3 must set the timestamps with status.
Task 2: Ruling: two-gym isolation for the plan tables lives in test/db/plans-schema.spec.ts, not rls.spec.ts — same coverage plus privilege checks — none.
Task 2: Ruling: positions' deferrable unique constraints exist only in the SQL (drizzle-kit can't express DEFERRABLE) — none.
Task 2 note for Task 3: lock per member (pg_advisory_xact_lock) around activation, archive old before activating new, map 23505 on plans_one_active_per_member_uq and deferred position uniques (fail at COMMIT) to 409; planAccess must verify the member holds the member role in the gym.
Flaky (pre-existing, not ours): signup.e2e 11th-attempt 429 test times out at 5 s under full-suite load; passes alone.
Task 2: complete (commits 29de3a2..d316fb3, tests: pnpm -r test → apps/web test: Done)
Task 3: Ruling: signup.e2e 11th-attempt throttle test given a 30 s timeout (flaky at 5 s under parallel load, unrelated to plans; failure blocked the full-suite gate) — test-only change — none.
Task 3: Ruling: planAccess returns null (404) for a memberId that holds no member role in the gym; owner and reception are blocked by @GymRoles('trainer','member') (403) — spec §5 doesn't grant them plans — none.
Task 3: Ruling: the member sees only plans that were ever activated (activated_at not null), so an archived-never-activated draft stays hidden — code-reviewer finding, fixed RED→GREEN — none.
Task 3: Ruling: activation serialised per member with pg_advisory_xact_lock, archive-old-then-activate-new in one tx, so two concurrent activations both return 200 and the later one wins (no 409/500) — database-expert — none. (Minor: access is not re-checked after taking the lock.)
Task 3: Ruling: PUT/archive/activate on a draft that is archived is idempotent 204 for archive; activating an archived plan is 409; PUT of a pdf plan is 409 (Task 4 may relax) — plan silent — none.
Task 3: complete (commits d316fb3..d35dc89, tests: pnpm -r test → apps/web test: Done)
Task 4: Ruling: a template or plan copied while it holds an archived exercise keeps it (same as existing plans keep archived exercises) — plan silent — a trainer could later copy a template with an exercise no longer in the picker.
Task 4: Ruling: a template whose author account was erased (author_id NULL) can no longer be edited or deleted by anyone, but stays listed/usable — spec says "editable only by their author" — owner cannot clean it up; revisit if it comes up.
Task 4: Ruling: copies lock the source (save-as-template FOR UPDATE on the plan, from-template FOR SHARE on the template) so a concurrent edit/delete can't tear a copy — code-reviewer finding, test RED→GREEN — none.
Task 4: Ruling: a missing PDF file is 415 (not 400); the PDF object is stored inside the try so a timed-out put is cleaned up too — none.
Task 4: Ruling: presigned PDF links are not guaranteed distinct per GET (same-second reads give identical signed URLs); each expires in 300 s — none.
Task 4: Ruling: the template list is available to trainers only (spec lists @GymRoles('trainer')); the owner cannot browse templates — none.
Task 4: complete (commits d35dc89..6603f9c, tests: pnpm -r test → apps/api test: Done)
Task 5: Ruling: the library page calls the API for search (debounced 200 ms, first request immediate) instead of filtering client-side, so accent-insensitive search stays in one place — none.
Task 5: Ruling: Enter and clicks in the picker are ignored while the list on screen is stale (typing pause or request in flight) — ux-reviewer + code-reviewer finding, RED→GREEN — none.
Task 5: Ruling: "Μέτρηση"/Measure relabelled "Καταγραφή ως"/Track by (body measurements are a different feature), cardio group "Αερόβια", names in «» — ux-reviewer — none.
Task 5: Ruling: nav key `exercises` added for owner and trainer shells; reception/member don't see the library — spec §5 (trainers and owner add/edit) — none.
Task 5 note: the plan's `nav.myWorkouts` label is renamed in Task 7.
Task 5: complete (commits 6603f9c..c32b551, tests: pnpm -r test → apps/api test: Done)
Task 6: Ruling: PlanSummary gets authorId (API + shared) so the templates page can tell which templates are the viewer's — plan silent, summary had only authorName — tiny API surface addition, tested.
Task 6: Ruling: the web app uses a plain router (no data router), so react-router's useBlocker is unavailable: unsaved changes are guarded by the Close button's confirmation and the browser's beforeunload only, not by in-app nav clicks or the Back button — ux/code reviewers flagged it — a trainer who clicks another nav tab or presses Back loses an unsaved draft.
Task 6: Ruling: whether the trainer is the primary or a cover trainer comes from /trainer/clients (the `cover` flag); if that list can't be loaded the page shows a load error with retry instead of silently going read-only — code-reviewer — none.
Task 6: Ruling: trainer nav label `plans` renamed "Πρότυπα"/"Templates" (the page is the template list) because "Πρόγραμμα" already names the shift schedule — ux-reviewer — none.
Task 6: Ruling: clearing the Sets field leaves it empty while typing (saving then shows "check the exercises"); the move buttons use aria-disabled so keyboard focus stays on them at the ends; saving keeps the editor's own keys so collapsed days stay collapsed — reviewers — none.
Task 6: deferred UX suggestions (not implemented): wording/sr text for the compact target string, 14 region landmarks for days, day header wrapping at 375 px, prefilled day names, undo for removed exercise, new-plan dialog focus per step, per-field error messages for schema failures.
Task 6: complete (commits c32b551..ec6b0d1, tests: pnpm -r test → apps/web test: Done)
Task 7: Ruling: the exercise target stays exactly as the plan writes it ("4 × 8–10 @ 50 kg", "4 × max", "3 × 45″"); "max" is not translated and screen readers get the symbols as written — plan text fixes the format — Greek members see the English word "max"; revisit with an i18n pass (spoken form).
Task 7: Ruling: the member screen's empty-state and title wording follow the plan ("Δεν έχεις ακόμη πρόγραμμα…", "Το πρόγραμμά μου") rather than adding "προπόνησης" — the plan and spec fix the strings — "Πρόγραμμα" also names the shift schedule for staff, members only see their own area.
Task 7: Ruling: "has a trainer" for the empty state = a membership that is active, frozen or upcoming and includes a trainer (same rule the API uses for a paused link); if the memberships cannot be read the friendlier "talk to your trainer" text is used — no endpoint tells a member who their trainer is — a member with a trainer membership but no assigned trainer is told to talk to a trainer.
Task 7: Ruling: an older plan is opened in the page (not via the URL), so the browser Back button leaves the screen instead of returning to the current plan; the in-page "Πίσω στο τρέχον πρόγραμμα" button gets focus — ux-reviewer suggested a ?plan= param — a member who presses Back leaves My plan.
Task 7: Ruling: a PDF link is refreshed quietly when the page becomes visible again after more than 4 minutes (links last 5), keeping the plan on screen if that fails — code- and ux-reviewer findings, RED→GREEN — none.
Task 7: Ruling: `color-scheme: light` set in index.css (the app has no dark styling anywhere; native controls now match) — ux-reviewer — real dark mode is not part of this phase.
Task 7: deferred (not implemented): remember last viewed day per plan, sticky tab strip, spoken target string, "opens in new tab" hint on the PDF button, offline message, member Back via URL param.
Task 7: complete (commits ec6b0d1..dbb4cfd, tests: pnpm -r test → apps/web test: Done)
Final (pre-review): Ruling: e2e specs run in 6 parallel workers and the login throttle is 5/min per IP+email, so the platform admin signs in once in a Playwright globalSetup (E2E_ADMIN_TOKEN) instead of once per spec; foundation keeps its UI login — adding the plans spec made 6 sign-ins in a minute and failed the suite — none.
Final review: whole-branch review by a fresh reviewer (opus); all five Review Focus items hold in the real code.
Final: fixed a cover trainer could copy a member's plan (notes included) into a gym-wide template — "cover trainer can neither copy it into a template nor create a plan from one" RED→GREEN, save-as-template now needs write access, API suite 30/30 in templates+plans
Final: minor (deferred): an exercise archived by the owner while a trainer's save is in flight can still be added to that plan (savePlanTree reads the exercise without a share lock; fix is `.for('share')`)
Final: minor (deferred): the trainer's client-plans screen does not refresh an expired PDF link (the member screen does; reuse MyPlanPage's visibility refresh)
Final: minor (deferred): the single e2e admin token (15 min lifetime) would make a run longer than 15 minutes fail with 401 at gym set-up
Final: Ruling: weight fields are type=number (Greek comma entry depends on the browser/locale; code accepts a comma) — reviewer could not judge, needs a manual check on iOS Safari with a Greek keyboard — a trainer there may be unable to type 22,5 (use 22.5) and gets "check the exercises" on save.
Final: Ruling: erasing a user with plans is not handled (plans.member_id is NO ACTION and the restrictive policy blocks gym_app deletes): a future erasure flow must delete or anonymise plans through gym_system — no erasure flow exists yet — blocks account erasure for members with plans until built.
Final: Ruling: PUT /plans/:id/pdf (replace file) is API-only for now, no screen calls it — the plan lists it as a route and the UI tasks do not mention it — a trainer who wants a new PDF uploads a new plan and archives the old one.
Final: Ruling: any trainer can PATCH an exercise's `measure` even when plans already use it — spec lets trainers edit the library — phase 4b logging must tolerate a changed measure.
Final: Ruling: PUT /plans/:id is last-write-wins (row lock prevents torn writes, no version check) — one trainer per plan in practice — two tabs of the same trainer can overwrite each other.
