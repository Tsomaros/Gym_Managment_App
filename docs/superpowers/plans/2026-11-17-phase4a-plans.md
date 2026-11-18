# Phase 4a: Exercise Library, Workout Plans and Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trainers build workout plans for their clients, either as an uploaded PDF or as an interactive plan (days → exercises with sets, reps, weight, rest and notes) drawn from the gym's exercise library. They can save plans as templates and reuse them. Members see their active plan; a same-day cover trainer can read it but not change it.

**Architecture:** Builds on phase 3 (`main` at 559c7a3). All access to a member's plans goes through `trainerAccess` (phase 3). Plans are saved as one document (`PUT` with the whole structure). Days and exercises keep stable ids across edits, so phase 4b's workout logs stay linked. Templates are plans without a member; creating a plan from a template copies it deeply. PDFs live in MinIO through the existing `StorageService`.

**Tech Stack:** as phase 3. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-15-gym-management-design.md` §5, §6.4 (cover read-only), §6.5, §6.10, §8 (signed links), §10 (seed list left to the builder). Phase 3 decisions: `docs/superpowers/plans/2026-11-17-phase3-staff-shifts.ledger.md`.

## Global Constraints

- All earlier Global Constraints still apply (RLS with a two-gym isolation test per new gym-owned table, history in the same transaction, `Clock`, gym-local dates).
- **Access to a member's plans:**

  | Caller | Read | Write |
  |---|---|---|
  | Trainer, `trainerAccess = 'primary'` | ✅ | ✅ |
  | Trainer, `'cover'` | ✅ | ❌ |
  | Trainer, `null` (incl. a paused link) | ❌ | ❌ |
  | The member themself | ✅ (active + history) | ❌ |
  | Owner, reception | ❌ (spec §5 doesn't grant it; health-adjacent data) | ❌ |

  Errors: no read access → `404` (don't reveal that a plan exists); read but no write → `403`.
- **One active plan per member:** a partial unique index on `(gym_id, member_id) WHERE status = 'active' AND member_id IS NOT NULL`. Activating a new plan archives the previous one in the same transaction.
- **Exercise library:** per gym, seeded with defaults when a gym is created (and backfilled for existing gyms by migration). Names in Greek (required) and English (optional, falls back to Greek). `muscle_group ∈ chest, back, shoulders, biceps, triceps, legs, glutes, core, cardio, full_body`. `measure ∈ weight_reps, reps, duration` (used by phase 4b logging). Trainers and the owner can add and edit; archive is by the owner or the exercise's creator. Archived exercises stay in existing plans but aren't offered in the picker.
- **Plan targets per exercise:**
  - `sets` 1–20.
  - `reps_min` and `reps_max` (1–100, `reps_min ≤ reps_max`), or `to_failure = true` with both NULL ("max").
  - `weight_kg` NULL or 0–999.75 in steps of 0.25.
  - `rest_seconds` NULL or 0–900.
  - `duration_seconds` for `duration` exercises.
  - `notes` ≤ 300 characters.
- Limits per plan: at most 14 days and 30 exercises per day. Title 1–80 characters.
- **Stable ids:** on `PUT`, a day or exercise sent with an existing `id` of the same plan is updated in place; one without `id` is created; any id of this plan not sent is deleted. An id belonging to another plan → `400`.
- **Templates** (`member_id IS NULL`, `is_template = true`) are visible to every trainer in the gym and editable only by their author. Creating a plan from a template copies all days and exercises, with new ids and no link back.
- **PDF plans:** at most **10 MB**; the file must start with `%PDF-`. Object key `gyms/<gymId>/plans/<planId>/<uuid>.pdf`. Read through a presigned GET valid **5 minutes**. Replacing the PDF deletes the old object after commit.
- Every visible exercise name is shown in the viewer's language: `name_en ?? name_el` in English.
- New history actions: `exercise.created`, `exercise.updated`, `exercise.archived`, `plan.created`, `plan.updated`, `plan.activated`, `plan.archived`, `template.created`, `template.updated`, `template.deleted`. History `data` holds titles and counts, never the full plan.

## Review Focus

1. **Cover is read-only:** a cover trainer gets the plan (`200`), but any write → `403`. A trainer with a paused primary link → `404` on read. The same trainer the next gym day → `404`. (Task 3)
2. **Exactly one active plan:** activating plan B archives plan A. Two activations at once leave exactly one active plan. A member's history lists both. (Task 3)
3. **Edits keep ids:** editing an active plan (rename a day, change one exercise's reps, remove another, add one) keeps the ids of untouched and changed items, deletes only the removed one, and gives a new id only to the added one. (Task 3)
4. **Templates are copies:** editing a template after a plan was made from it doesn't change that plan; deleting the template doesn't delete the plan. (Task 4)
5. **Library edges:** an archived exercise still shows in existing plans but isn't in the picker or accepted in new saves (`400`). Another gym's exercise id → `400`. Picker search "πιεσεις" finds "Πιέσεις στήθους". (Tasks 1, 3)

---

### Task 1: Exercise library (API, seeding)

**Files:**
- Create: `apps/api/src/db/schema/exercises.ts`, migration `0018_exercises.sql` (table, RLS, backfill seed for existing gyms)
- Create: `apps/api/src/exercises/exercises.module.ts`, `exercises.controller.ts`, `exercises.service.ts`, `seed-exercises.ts`
- Modify: `apps/api/src/gyms/gyms.service.ts` (seed on gym creation, same transaction)
- Create: `packages/shared/src/schemas/exercises.ts`; Modify: `audit.ts`, `index.ts`
- Test: `apps/api/test/exercises.e2e.spec.ts`, `apps/api/test/db/rls.spec.ts` (extend)

**Interfaces:**
- Table `exercises(id, gym_id, name_el text NOT NULL, name_en text NULL, muscle_group text CHECK, measure text CHECK, archived_at NULL, created_by NULL FK users ON DELETE SET NULL, created_at, UNIQUE (gym_id, lower(name_el)))`, plus an index for accent-insensitive search (reuse the `unaccent` and final-sigma normalisation from `members.service.ts`). RLS.
- `DEFAULT_EXERCISES: readonly { nameEl: string; nameEn: string; muscleGroup: MuscleGroup; measure: Measure }[]` in `seed-exercises.ts`, at least 50 common exercises (builder's choice, spec §10). It must include "Πιέσεις στήθους" / "Bench press" (chest, weight_reps), "Κάμψεις δικεφάλων" / "Biceps curl", "Βαθύ κάθισμα" / "Squat", "Άρσεις θανάτου" / "Deadlift", "Έλξεις" / "Pull-ups" (back, reps), "Σανίδα" / "Plank" (core, duration).
- `seedExercises(tx: Tx, gymId: string): Promise<void>`.
- Shared: `MUSCLE_GROUPS`, `MEASURES`, `ExerciseInputSchema { nameEl, nameEn?, muscleGroup, measure }`, `Exercise { id, nameEl, nameEn, muscleGroup, measure, archived, createdBy: string | null }`.
- Routes:
  - `GET /gyms/:gymId/exercises?q=&muscleGroup=&includeArchived=` (`@GymRoles('trainer')`; owner passes too) → `Exercise[]` sorted by name, at most 200.
  - `POST /gyms/:gymId/exercises` (`@GymRoles('trainer', 'owner')`) → `201`; a duplicate Greek name in the gym → `409`.
  - `PATCH /gyms/:gymId/exercises/:id` (trainer or owner).
  - `POST /gyms/:gymId/exercises/:id/archive` (owner, or the creator) → `204`.

- [x] **Step 1: Write the failing tests:**
  - A newly created gym has the default list (count = `DEFAULT_EXERCISES.length`) and includes "Πιέσεις στήθους". After migration, an existing gym in `gym_test` has them too.
  - `q=πιεσεις` finds "Πιέσεις στήθους"; `q=bench` finds it by its English name. *(Review Focus 5)*
  - A trainer adds "Ώμοι με αλτήρες" → `201` + `exercise.created`; the same name again with different case → `409`.
  - A trainer archiving another trainer's exercise → `403`; the owner → `204`; it's hidden by default and shown with `includeArchived=true`.
  - A member or reception calling `GET` → `403`. Two-gym isolation.
- [x] **Step 2: Run** `pnpm --filter api test exercises` → FAIL.
- [x] **Step 3: Implement.** Consult database-expert on the unique and search indexes.
- [x] **Step 4: Run** `pnpm --filter api test` → PASS.
- [x] **Step 5: Commit** `feat: per-gym exercise library with default seed`.

---

### Task 2: Plan schema and validation

**Files:**
- Create: `apps/api/src/db/schema/plans.ts`, `plan-days.ts`, `plan-exercises.ts`; migration `0019_plans.sql`
- Create: `packages/shared/src/schemas/plans.ts`
- Test: `packages/shared/test/plans.spec.ts`, `apps/api/test/db/plans-schema.spec.ts`, `apps/api/test/db/rls.spec.ts` (extend)

**Interfaces:**
- Tables (all gym-owned, RLS):
  - `plans(id, gym_id, member_id NULL FK users, author_id NULL FK users ON DELETE SET NULL, is_template bool NOT NULL DEFAULT false, kind text CHECK in ('interactive','pdf'), title text, notes text NULL, status text CHECK in ('draft','active','archived'), pdf_object_key text NULL, activated_at NULL, archived_at NULL, created_at, updated_at)`. CHECKs: `is_template = (member_id IS NULL)`; `kind = 'pdf'` ⇒ `NOT is_template`; templates have `status = 'draft'`. The partial unique index for one active plan per member.
  - `plan_days(id, gym_id, plan_id FK ON DELETE CASCADE, position smallint, title text)`, `UNIQUE (plan_id, position) DEFERRABLE INITIALLY DEFERRED`.
  - `plan_exercises(id, gym_id, plan_day_id FK ON DELETE CASCADE, exercise_id FK exercises, position smallint, sets, reps_min, reps_max, to_failure, weight_kg numeric(5,2), rest_seconds, duration_seconds, notes)`, the CHECKs from Global Constraints, `UNIQUE (plan_day_id, position) DEFERRABLE INITIALLY DEFERRED`.
- Shared:
  - `PlanExerciseInput { id?: uuid, exerciseId, sets, repsMin?, repsMax?, toFailure, weightKg?, restSeconds?, durationSeconds?, notes? }`.
  - `PlanDayInput { id?: uuid, title, exercises: PlanExerciseInput[] }`.
  - `PlanInputSchema { title, notes?, days: PlanDayInput[] }`, with the limits and rules from Global Constraints.
  - `Plan { id, memberId, authorId, author: { firstName, lastName } | null, isTemplate, kind, title, notes, status, pdfUrl: string | null, activatedAt, days: PlanDay[] }`, where each exercise also carries `exercise: { nameEl, nameEn, muscleGroup, measure, archived }`.
  - `PlanSummary { id, title, kind, status, activatedAt, archivedAt, authorName }`.

- [x] **Step 1: Write the failing tests:**
  - Shared: `repsMin 12, repsMax 8` rejects; `toFailure: true` with `repsMin` rejects; `weightKg 20.3` rejects and `20.25` accepts; 15 days rejects; a 31-exercise day rejects; a 1-character title accepts and an 81-character title rejects.
  - DB: a template with a `member_id` rejects (CHECK); two `active` plans for one member reject (unique index); swapping the positions of two days inside one transaction succeeds (deferred unique).
  - Two-gym isolation for all three tables.
- [x] **Step 2: Run** `pnpm --filter shared test plans && pnpm --filter api test plans-schema` → FAIL.
- [x] **Step 3: Implement.** Consult database-expert.
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat: workout plan schema and validation`.

---

### Task 3: Plans API (interactive, access, activation)

**Files:**
- Create: `apps/api/src/plans/plans.module.ts`, `plans.controller.ts`, `plans.service.ts`, `plan-access.ts`, `save-plan.ts`
- Test: `apps/api/test/plans.e2e.spec.ts`

**Interfaces:**
- `planAccess(tx, gymId, caller: { userId: string; roles: GymRole[] }, memberId: string, today: string): Promise<'write' | 'read' | null>`, implementing the access table (built on `trainerAccess`).
- `savePlanTree(tx, gymId, planId, input: PlanInput): Promise<void>`, implementing the stable-id rules. It validates every `exerciseId` against this gym's unarchived exercises, except ids already present in this plan (archived exercises may stay). Any other id → `400`.
- Routes (all under `@GymRoles('trainer', 'member')` plus `planAccess` inside):
  - `GET /gyms/:gymId/members/:memberId/plans` → `PlanSummary[]` (active first, then archived by `archived_at` descending).
  - `GET /gyms/:gymId/members/:memberId/plans/active` → `Plan` or `404`.
  - `GET /gyms/:gymId/plans/:planId` → `Plan` (access checked through the plan's member).
  - `POST /gyms/:gymId/members/:memberId/plans` (write) `PlanInput & { activate?: boolean }` → `201 Plan`, `kind 'interactive'`, `status 'draft'`, or `'active'` with `activate: true` (archives the previous active plan).
  - `PUT /gyms/:gymId/plans/:planId` (write) `PlanInput` → `200 Plan`; archived plans are read-only (`409`).
  - `POST /gyms/:gymId/plans/:planId/activate` (write) → `200`. `POST …/archive` (write) → `204`.
  - `GET /gyms/:gymId/me/plans` and `GET /gyms/:gymId/me/plans/active` (`@GymRoles('member')`) → the caller's own.
  - History rows on each write.

- [x] **Step 1: Write the failing tests** (seed: trainer T primary for member M, with a trainer membership; trainer U; reception R):
  - T creates and activates a 2-day plan → `201`; M's `/me/plans/active` returns it in Greek with exercise names; the English names appear in `nameEn`.
  - Edit: rename day 1, change exercise A's reps, remove exercise B, add C → A and the day keep their ids, B is gone, C has a new id. *(Review Focus 3)*
  - T activates plan 2 → plan 1 is `archived`, plan 2 is `active`; two concurrent activations → one active. *(Review Focus 2)*
  - U with a cover today: `GET active` → `200`; `PUT` → `403`; the next day → `404`. *(Review Focus 1)*
  - M's trainer membership expires (paused link): T `GET` → `404`. *(Review Focus 1)*
  - R `GET` → `403`. M `PUT` → `403`. A gym B member's id → `404`.
  - Saving with an archived exercise newly added → `400`; an archived exercise already in the plan stays and saves fine; another gym's exercise id → `400`; another plan's day id → `400`. *(Review Focus 5)*
  - History has `plan.created`, `plan.activated`, `plan.updated`, `plan.archived`, without exercise details.
- [x] **Step 2: Run** `pnpm --filter api test plans` → FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run** `pnpm --filter api test` → PASS.
- [x] **Step 5: Commit** `feat: interactive workout plans with trainer access rules`.

---

### Task 4: Templates and PDF plans

**Files:**
- Create: `apps/api/src/plans/templates.controller.ts`, `templates.service.ts`, `pdf-plans.controller.ts`
- Modify: `plans.service.ts` (fill `pdfUrl`), `packages/shared/src/schemas/plans.ts`
- Test: `apps/api/test/templates.e2e.spec.ts`, `apps/api/test/pdf-plans.e2e.spec.ts` (needs MinIO; skips with a clear reason without it, as the photo tests do)

**Interfaces:**
- Template routes (`@GymRoles('trainer')`):
  - `GET /gyms/:gymId/plan-templates` → `PlanSummary[]` (with author) for the whole gym.
  - `GET /gyms/:gymId/plan-templates/:id` → `Plan`.
  - `POST /gyms/:gymId/plan-templates` `PlanInput` → `201`.
  - `POST /gyms/:gymId/plans/:planId/save-as-template` `{ title }` → `201` (deep copy; needs read access to the source plan).
  - `PUT /gyms/:gymId/plan-templates/:id` and `DELETE …` (author only, `403` otherwise).
  - `POST /gyms/:gymId/members/:memberId/plans/from-template` `{ templateId, activate?: boolean }` (write access) → `201 Plan` (deep copy, new ids).
- PDF routes (write access to the member):
  - `POST /gyms/:gymId/members/:memberId/plans/pdf` (multipart `file`, plus fields `title`, `activate`) → `201 Plan` with `kind 'pdf'` and `days: []`.
  - `PUT /gyms/:gymId/plans/:planId/pdf` (replace the file).
  - Validation per Global Constraints: `415` if it isn't a PDF, `413` over 10 MB.
  - `pdfUrl` is a fresh presigned link on every `GET` (read access).

- [x] **Step 1: Write the failing tests:**
  - T saves M's plan as a template → another trainer V sees it in the list; V's `PUT` on it → `403`.
  - From the template, T creates a plan for member N → new ids throughout. Editing the template afterwards leaves N's plan unchanged; deleting the template leaves N's plan in place. *(Review Focus 4)*
  - Upload a small PDF and activate → M's active plan has `kind 'pdf'` and a `pdfUrl` that returns the same bytes. A PNG renamed `.pdf` → `415`; 10.1 MB → `413`.
  - Replacing the PDF removes the old object. A cover trainer can `GET` the `pdfUrl` but gets `403` on upload.
  - Template history rows are written.
- [x] **Step 2: Run** `pnpm --filter api test templates pdf-plans` → FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run** `pnpm --filter api test` → PASS.
- [x] **Step 5: Commit** `feat: plan templates and PDF plans`.

---

### Task 5: Web, exercise library

**Files:**
- Create: `apps/web/src/features/exercises/ExercisesPage.tsx`, `ExerciseForm.tsx`, `ExercisePicker.tsx`, `exerciseName.ts`
- Modify: trainer and owner shell nav (`exercises`), router, `el.json`, `en.json`
- Test: one `*.spec.tsx` per component; `exerciseName.spec.ts`

**Interfaces:**
- `exerciseName(e: { nameEl: string; nameEn: string | null }, lang: 'el' | 'en'): string`.
- `ExercisesPage`: a searchable list grouped by muscle group, with add and edit (`ExerciseForm`) and archive (owner or creator; confirm dialog).
- `ExercisePicker` (used by the plan editor): a dialog with a search box (debounced 200 ms) and muscle-group filter chips. Keyboard: arrows move, Enter picks. Archived exercises are never offered.

- [x] **Step 1: Write the failing tests:** `exerciseName` falls back to Greek in English when `nameEn` is null; the picker sends `q` after typing and calls `onPick` on Enter; archive shows only for the owner or the creator; the add form requires the Greek name.
- [x] **Step 2: Run** `pnpm --filter web test exercises` → FAIL.
- [x] **Step 3: Implement.** Run ui-ux-reviewer.
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat(web): exercise library`.

---

### Task 6: Web, plan editor, templates, PDF upload (trainer)

**Files:**
- Create: `apps/web/src/features/plans/ClientPlansPage.tsx` (opened from `TrainerClientsPage`), `PlanEditor.tsx`, `PlanDayEditor.tsx`, `PlanExerciseRow.tsx`, `TemplatesPage.tsx`, `NewPlanDialog.tsx`, `PdfPlanUpload.tsx`, `PlanView.tsx` (read-only, shared with Task 7)
- Modify: `TrainerClientsPage.tsx` (link to the client's plans), trainer shell nav (`plans` → `TemplatesPage`), router, `el.json`, `en.json`
- Test: one `*.spec.tsx` per component; `e2e/plans.spec.ts`

**Interfaces:**
- `ClientPlansPage`: the active plan (`PlanView`, with "Επεξεργασία" for write access only), history, and "Νέο πρόγραμμα" → `NewPlanDialog` (blank interactive / from template / upload PDF).
  - With `'cover'` access, a banner "Αντικατάσταση σήμερα — μόνο ανάγνωση" and no edit controls.
- `PlanEditor`: title and notes; days as collapsible sections (add, rename, move up/down, remove with confirm); per day, `PlanExerciseRow`s (picker, sets, reps range or "μέχρι αποτυχίας", kg, rest, notes; move up/down; remove).
  - Fields adapt to `measure`: `duration` shows seconds instead of reps and kg.
  - "Αποθήκευση" sends the whole tree with existing ids; "Αποθήκευση και ενεργοποίηση"; "Αποθήκευση ως πρότυπο".
  - Unsaved changes warn before leaving.
  - Up/down buttons move items; no drag-and-drop library.
- `TemplatesPage`: the gym's templates with author, and create, edit and delete for your own.

- [x] **Step 1: Write the failing tests:**
  - Adding an exercise through the picker adds a row.
  - Moving day 2 up sends days in the new order and keeps their ids.
  - Toggling "μέχρι αποτυχίας" clears and disables the reps fields.
  - A `duration` exercise shows seconds, not reps and kg.
  - Leaving with unsaved changes asks for confirmation.
  - Cover access hides edit controls and shows the banner.
  - E2E: the owner sets up a trainer, and a member with a trainer membership is assigned to them → the trainer creates a 2-day plan from scratch and activates it → saves it as a template → uploads a PDF plan for another client.
- [x] **Step 2: Run** `pnpm --filter web test plans && pnpm e2e` → FAIL.
- [x] **Step 3: Implement.** Run ui-ux-reviewer (the editor must be usable on a tablet; number inputs with `inputmode="decimal"` for kg).
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat(web): plan editor, templates and PDF upload for trainers`.

---

### Task 7: Web, the member's plan

**Files:**
- Create: `apps/web/src/features/my-plan/MyPlanPage.tsx` (member nav `myWorkouts` → "Το πρόγραμμά μου")
- Modify: `PlanView.tsx` (member layout), member shell, router, `el.json`, `en.json`
- Test: `MyPlanPage.spec.tsx`, `e2e/plans.spec.ts` (extend)

**Interfaces:**
- `MyPlanPage`:
  - Interactive: tabs per day ("Ημέρα Α – Πάνω σώμα"). Exercise cards show the name in the member's language, `4 × 8–10 @ 50 kg`, "ανάπαυση 90″" and notes; `μέχρι αποτυχίας` shows as "4 × max".
  - PDF: a large "Άνοιγμα PDF" button (opens the signed link in a new tab) plus "Λήψη".
  - No plan: "Δεν έχεις ακόμη πρόγραμμα — μίλησε με τον γυμναστή σου". Without a trainer, the text says to ask at reception.
  - Older plans are listed under a collapsed "Προηγούμενα προγράμματα".
  - The "Καταγραφή" (log) button is reserved for phase 4b; it isn't rendered yet.

- [x] **Step 1: Write the failing tests:** the target formatting for a range, a single number and max; English names in English; the PDF button opens the signed URL; the empty state text depends on having a trainer; the layout is a single column at 375 px.
- [x] **Step 2: Run** `pnpm --filter web test my-plan && pnpm e2e` → FAIL.
- [x] **Step 3: Implement.** Run ui-ux-reviewer (phone, one-handed, Greek, dark mode).
- [x] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm -r test && pnpm e2e` → PASS.
- [x] **Step 5: Commit** `feat(web): member's workout plan`.

---

## Self-review notes

- **Spec coverage:**
  - §6.5: PDF or interactive plans → T2, T3, T4, T6, T7; exercise library seeded, trainers can add, and plans use library exercises → T1, T5; templates → T4, T6; one active plan with history kept → T2, T3, T7.
  - §6.4: cover is read-only → T3, T6.
  - §8: signed links for PDFs → T4. §6.10: history → T1, T3, T4.
- **Phase 4b (next):** workout logging (plan days and free workouts for members without a trainer), progress charts (top set, estimated 1RM, weekly volume, attendance), body measurements and progress photos with explicit consent (spec §6.6, §6.7, §8). Logs reference `exercise_id` (for charts) and optionally `plan_exercise_id` (ON DELETE SET NULL), which is why Task 3 keeps ids stable.
