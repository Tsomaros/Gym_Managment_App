# Phase 4b: Workout Logging, Progress Charts, Measurements and Progress Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members log their workouts set by set, from their plan or as a free workout, comfortably on a phone and even with poor signal. Members and their trainers see progress charts. Trainers record body measurements, and members and trainers add progress photos, both only with the member's explicit, withdrawable consent.

**Architecture:** Builds on phase 4a (`main` at b7f226d). Sessions and sets use **client-generated UUIDs** and idempotent `PUT`s, so the phone can queue writes offline and replay them safely. Progress numbers come from pure functions over logged sets, which snapshot the exercise's `measure` at log time. Health data (measurements, progress photos) sits behind a per-kind consent record; withdrawing consent deletes that kind of data. Access reuses phase 4a's `planAccess` (primary trainer writes, cover trainer reads that day, member reads and writes their own, owner and reception never).

**Tech Stack:** as phase 4a, plus `recharts` for charts.

**Spec:** `docs/superpowers/specs/2026-11-15-gym-management-design.md` §5, §6.4 (free workouts, cover helps the member log), §6.6, §6.7, §8. Phase 4a decisions: `docs/superpowers/plans/2026-11-17-phase4a-plans.ledger.md` (notably: an exercise's `measure` can change after use; plans can't be erased yet).

## Global Constraints

- All earlier Global Constraints still apply (RLS with a two-gym isolation test per new gym-owned table, history in the same transaction, `Clock`, gym-local dates).
- **Access:**

  | Caller | Sessions and sets | Progress charts | Measurements | Progress photos | Consent |
  |---|---|---|---|---|---|
  | Member (own) | read, write | read | read | read, add, delete | grant, withdraw |
  | Trainer, `'primary'` | read | read | read, write | read, add, delete | read |
  | Trainer, `'cover'` (today) | read | read | read | read | read |
  | Owner, reception, other trainers | — | — | — | — | — |

  No read access → `404`; read without write → `403`. Implement once as `healthAccess(tx, gymId, caller, memberId, today)`, returning `{ read: boolean; writeMeasurements: boolean; writePhotos: boolean; writeSessions: boolean }`, built on `trainerAccess`.
- **Sessions:**
  - `PUT /…/sessions/:id` creates or updates by client UUID. A member has at most **one open session**: opening a new one closes any open one, setting `finished_at` to its last set's `logged_at`, or `started_at` if it has no sets.
  - Sessions older than **12 hours** with no `finished_at` are shown as finished at their last set.
- **Sets:**
  - Upserted by client UUID under their session.
  - Each set stores `exercise_id`, an optional `plan_exercise_id` (`ON DELETE SET NULL`), `measure` (a **snapshot** of the exercise's measure at log time), `set_index`, and `reps`, `weight_kg` and `duration_seconds` as that measure needs, plus `done` and `logged_at`.
  - Value ranges as in phase 4a targets: reps 0–100, kg 0–999.75 in steps of 0.25, duration 1–7200 s.
  - A set whose session belongs to another member → `404`.
- **Free workouts:** members (with or without a trainer) may start a session without a plan and pick exercises from the library. Members get read access to `GET /exercises` (unarchived only).
- **Progress maths** (pure, server-side):
  - **Top set** of an exercise in a session = the done set with the highest `weight_kg` (ties → more reps).
  - **e1RM** (Epley) = `weight × (1 + reps / 30)` for done `weight_reps` sets with 1–12 reps; the session's value is the max; rounded to 0.5 kg.
  - **Weekly volume** = Σ `weight_kg × reps` over done `weight_reps` sets, per ISO week (Monday start, gym time zone). `reps` and `duration` sets don't count.
  - **Attendance** = the number of distinct gym days with a valid check-in, per ISO week.
  - Ranges: `weeks` 4–104 (default 26).
- **Consent:** `health_consents(gym_id, member_id, kind ∈ measurements | photos, granted_at, withdrawn_at)`; the latest row per kind decides.
  - Recording a measurement or adding a photo without current consent → `409 { message: 'No consent' }`.
  - **Withdrawing deletes** all of the member's data of that kind in this gym, in the same transaction (photos: rows now, objects after commit). The UI asks for confirmation first.
  - Consent text version `v1` is stored with each grant.
- **Measurements:** `measured_on` date (≤ today), `weight_kg` 20–400, `body_fat_pct` 2–70, and optional circumferences in cm (waist, hips, chest, arm, thigh: 10–300, one decimal), plus notes ≤ 300. At least one value is required.
- **Progress photos:** the client resizes to at most **1200 px**, JPEG 0.85. Server: JPEG, PNG or WebP by magic bytes, ≤ 3 MB. Object key `gyms/<gymId>/progress/<memberId>/<uuid>.jpg`. Signed GET valid **5 minutes**. Never shown to the owner or reception.
- History actions: `consent.granted`, `consent.withdrawn`, `measurement.recorded`, `measurement.deleted`, `progress_photo.added`, `progress_photo.deleted`. `data` never holds the measured values or photo keys. Workout sessions aren't copied to the history.
- **Offline queue (web):** writes are queued in `localStorage` key `gym.workoutQueue` (wrapped in try/catch) and replayed in order when online. A replayed `PUT` with the same body is a no-op.

## Review Focus

1. **Offline then online:** three sets logged with the network off appear once each on the server after reconnecting, in order, even if the replay runs twice (two tabs, or a retry after a timeout). (Tasks 1, 5)
2. **Consent is enforced:** recording a measurement without consent → `409`. After the member withdraws, the trainer sees no measurements, the rows are gone, and a new recording → `409` until consent is given again. The photos' storage objects are gone too. (Tasks 3, 4)
3. **Week boundaries:** a session at 00:30 Athens on Monday 2027-03-29 (21:30 UTC Sunday) counts towards the week of 2027-03-29, not the week before. (Task 2)
4. **Measure changed later:** an exercise logged as `weight_reps` and later changed to `duration` keeps its old sets in the volume and e1RM charts. New duration sets don't count towards volume. (Task 2)
5. **Who sees health data:** the owner and reception get `404` on sessions, charts, measurements and photos. A cover trainer reads that day but gets `403` on recording a measurement, and `404` the next day. (Tasks 1–4)

---

### Task 1: Workout sessions and sets (API)

**Files:**
- Create: `apps/api/src/db/schema/workout-sessions.ts`, `workout-sets.ts`; migration `0020_workouts.sql`
- Create: `apps/api/src/workouts/workouts.module.ts`, `workouts.controller.ts`, `workouts.service.ts`, `health-access.ts`
- Modify: `apps/api/src/exercises/exercises.controller.ts` (members may `GET` unarchived exercises)
- Create: `packages/shared/src/schemas/workouts.ts`; Modify: `index.ts`
- Test: `apps/api/test/workouts.e2e.spec.ts`, `apps/api/test/health-access.spec.ts`, `apps/api/test/db/rls.spec.ts` (extend)

**Interfaces:**
- Tables (gym-owned, RLS):
  - `workout_sessions(id uuid PK (client-generated), gym_id, member_id FK users, plan_id NULL FK plans ON DELETE SET NULL, plan_day_id NULL FK plan_days ON DELETE SET NULL, started_at, finished_at NULL, notes NULL, created_at, updated_at)`, index `(gym_id, member_id, started_at DESC)`.
  - `workout_sets(id uuid PK (client), gym_id, session_id FK ON DELETE CASCADE, exercise_id FK exercises, plan_exercise_id NULL (composite FK with gym_id, ON DELETE SET NULL (plan_exercise_id)), measure text CHECK, set_index smallint, reps NULL, weight_kg numeric(5,2) NULL, duration_seconds NULL, done bool, logged_at, UNIQUE (session_id, exercise_id, set_index))`, plus CHECKs on which values each `measure` needs.
- Shared: `SessionUpsertSchema { planId?, planDayId?, startedAt, finishedAt?, notes? }`; `SetUpsertSchema { exerciseId, planExerciseId?, setIndex, reps?, weightKg?, durationSeconds?, done, loggedAt }` (the server fills `measure` from the exercise); `WorkoutSession { …, sets: WorkoutSet[] }`; `LastPerformance { exerciseId, sessionDate, sets: { reps, weightKg, durationSeconds }[] }`.
- `healthAccess(...)` per Global Constraints, unit-tested against the table.
- Routes (`@GymRoles('member', 'trainer')` + `healthAccess`):
  - `PUT /gyms/:gymId/members/:memberId/sessions/:sessionId` → `200 WorkoutSession` (write: member only; applies the one-open-session rule).
  - `PUT /gyms/:gymId/members/:memberId/sessions/:sessionId/sets/:setId` → `200`. `DELETE …/sets/:setId` → `204` (idempotent: an unknown id → `204`).
  - `POST /gyms/:gymId/members/:memberId/sessions/:sessionId/finish` → `200`.
  - `GET /gyms/:gymId/members/:memberId/sessions?before=&limit=20` → newest first, with sets.
  - `GET /gyms/:gymId/members/:memberId/last-performance?exerciseIds=a,b` → `LastPerformance[]` from the most recent finished session containing each exercise.
  - `/me/...` aliases for members.

- [x] **Step 1: Write the failing tests:**
  - `health-access.spec.ts`: each table row, including a paused link → no read, and a cover tomorrow → no read.
  - Member M creates session S with a client UUID, then 3 sets → `GET` shows them in order. The same `PUT`s again → still 3 sets, and the bodies are unchanged. *(Review Focus 1)*
  - Opening a new session while S is open → S gets `finished_at` = its last set's `logged_at`.
  - Logging a set for a `weight_reps` exercise without `weightKg` → `400`; for a `duration` exercise without `durationSeconds` → `400`; kg `20.3` → `400`.
  - A set references a plan exercise; after the trainer removes that exercise from the plan, the set keeps `exercise_id` and has `plan_exercise_id: null`.
  - `last-performance` returns the latest finished session's sets for each requested exercise.
  - Primary trainer T reads sessions → `200` and writes → `403`. Cover trainer U reads today → `200`, the next day → `404`. Owner and reception → `404`. *(Review Focus 5)*
  - Another member's session id in the path → `404`. A member `GET /exercises` → `200` (unarchived only). Two-gym isolation.
- [x] **Step 2: Run** `pnpm --filter api test workouts health-access` → FAIL.
- [x] **Step 3: Implement.** Consult database-expert (client UUID keys, composite FK with `SET NULL (column)`, indexes).
- [x] **Step 4: Run** `pnpm --filter api test` → PASS.
- [x] **Step 5: Commit** `feat: workout sessions and sets with idempotent client ids`.

---

### Task 2: Progress maths and progress API

**Files:**
- Create: `apps/api/src/progress/progress-math.ts`, `progress.module.ts`, `progress.controller.ts`, `progress.service.ts`
- Create: `packages/shared/src/schemas/progress.ts`
- Test: `apps/api/test/progress/progress-math.spec.ts`, `apps/api/test/progress.e2e.spec.ts`

**Interfaces:**
- `isoWeekStart(date: string): string` (the Monday).
- `e1rm(weightKg: number, reps: number): number | null`.
- `topSet(sets): { weightKg; reps } | null`.
- `weeklyVolume(sets: { measure; done; reps; weightKg; localDate: string }[], weeks: string[]): { weekStart: string; volumeKg: number }[]`.
- `weeklyAttendance(checkInDates: string[], weeks: string[]): { weekStart: string; days: number }[]`.
- `lastWeeks(today: string, n: number): string[]` (week starts, oldest first, current week included).
- Shared: `ExerciseProgress { exerciseId, points: { date, topSetKg, topSetReps, e1rmKg: number | null }[] }`; `VolumePoint`; `AttendancePoint`; `ProgressExerciseOption { exerciseId, nameEl, nameEn, sessions: number }`.
- Routes (`healthAccess.read`):
  - `GET /gyms/:gymId/members/:memberId/progress/exercises` → `ProgressExerciseOption[]` (exercises with done `weight_reps` sets, most logged first).
  - `GET …/progress/exercises/:exerciseId?weeks=` → `ExerciseProgress`.
  - `GET …/progress/volume?weeks=` → `VolumePoint[]`.
  - `GET …/progress/attendance?weeks=` → `AttendancePoint[]` (from `check_ins` where `valid`).
  - Plus `/me/...` aliases.

- [x] **Step 1: Write the failing tests** (values worked out by hand):
  - `e1rm(100, 5)` = 116.5 (116.67 → nearest 0.5); `e1rm(100, 1)` = 103.5 (103.33 → 103.5); `e1rm(100, 13)` = `null`; `e1rm(0, 10)` = 0.
  - `topSet([{60,8},{70,5},{70,6}])` = `{ 70, 6 }`.
  - `isoWeekStart('2027-03-29')` = `'2027-03-29'`; `isoWeekStart('2027-03-28')` = `'2027-03-22'`.
  - A set logged at `2027-03-28T21:30:00Z` (00:30 Athens on the 29th) counts in week `'2027-03-29'`. *(Review Focus 3)*
  - Volume: 3×10 @ 50 + 2×5 @ 80 = 2300; a `reps` set and an undone set add 0.
  - After the exercise's `measure` is changed to `duration`, its old `weight_reps` sets still count (snapshot), and new duration sets don't. *(Review Focus 4)*
  - Attendance: valid check-ins on Mon, Mon (duplicate day) and Wed → 2 days; invalid check-ins aren't counted.
  - API: `weeks=3` → `400`; owner → `404`; cover trainer today → `200`.
- [x] **Step 2: Run** `pnpm --filter api test progress` → FAIL.
- [x] **Step 3: Implement.** Convert `logged_at` to the gym's local date with `todayIn(timezone, loggedAt)`.
- [x] **Step 4: Run** `pnpm --filter api test` → PASS.
- [x] **Step 5: Commit** `feat: progress maths and progress API`.

---

### Task 3: Consent and body measurements (API)

**Files:**
- Create: `apps/api/src/db/schema/health-consents.ts`, `body-measurements.ts`; migration `0021_consents_measurements.sql`
- Create: `apps/api/src/health/health.module.ts`, `consents.controller.ts`, `consents.service.ts`, `measurements.controller.ts`, `measurements.service.ts`
- Create: `packages/shared/src/schemas/health.ts`; Modify: `audit.ts`
- Test: `apps/api/test/consents.e2e.spec.ts`, `apps/api/test/measurements.e2e.spec.ts`, `apps/api/test/db/rls.spec.ts` (extend)

**Interfaces:**
- Tables (gym-owned, RLS):
  - `health_consents(id, gym_id, member_id, kind text CHECK, text_version text, granted_at, withdrawn_at NULL)`, partial unique index `(gym_id, member_id, kind) WHERE withdrawn_at IS NULL`.
  - `body_measurements(id, gym_id, member_id, measured_on date, weight_kg numeric(5,2) NULL, body_fat_pct numeric(4,1) NULL, waist_cm/hips_cm/chest_cm/arm_cm/thigh_cm numeric(4,1) NULL, notes NULL, recorded_by FK users ON DELETE SET NULL, created_at, CHECK (at least one value NOT NULL))`.
- Shared: `CONSENT_KINDS`, `CONSENT_TEXT_VERSION = 'v1'`, `ConsentState { measurements: { granted: boolean; at: string | null }; photos: {…} }`, `MeasurementInputSchema`, `Measurement`.
- Routes:
  - `GET /gyms/:gymId/members/:memberId/consents` (`healthAccess.read`) → `ConsentState`.
  - `POST /gyms/:gymId/me/consents/:kind` (member) → `201` + `consent.granted` (already granted → `200`, no new row).
  - `DELETE /gyms/:gymId/me/consents/:kind` (member) → `204`; sets `withdrawn_at` and deletes that kind's data per Global Constraints; writes `consent.withdrawn` (`data`: kind and the number of items deleted).
  - `GET /gyms/:gymId/members/:memberId/measurements` (read) → newest first.
  - `POST …/measurements` (`writeMeasurements` + consent) → `201` + `measurement.recorded`.
  - `DELETE …/measurements/:id` (primary trainer) → `204` + `measurement.deleted`.

- [x] **Step 1: Write the failing tests:**
  - T records for M without consent → `409`. M grants → T records 82.5 kg / 18.0 % → `201`; M and T `GET` it.
  - `measured_on` tomorrow → `400`; no values → `400`; body fat 1 → `400`.
  - M withdraws → `204`; T's `GET` → `[]`; the rows are gone from the table; T records → `409`; the history row has the count but no values. *(Review Focus 2)*
  - Granting twice → one active row.
  - Cover trainer `POST` → `403`; the next day `GET` → `404`; owner and reception → `404`. *(Review Focus 5)*
  - Two-gym isolation for both tables.
- [x] **Step 2: Run** `pnpm --filter api test consents measurements` → FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run** `pnpm --filter api test` → PASS.
- [x] **Step 5: Commit** `feat: health consent and body measurements`.

---

### Task 4: Progress photos (API)

**Files:**
- Create: `apps/api/src/db/schema/progress-photos.ts`, migration `0022_progress_photos.sql`
- Create: `apps/api/src/health/progress-photos.controller.ts`, `progress-photos.service.ts`
- Modify: `consents.service.ts` (photo withdrawal deletes objects after commit)
- Test: `apps/api/test/progress-photos.e2e.spec.ts` (needs MinIO; skips with a clear reason without it)

**Interfaces:**
- Table `progress_photos(id, gym_id, member_id, taken_on date, object_key, uploaded_by FK users ON DELETE SET NULL, created_at)`. RLS.
- Routes:
  - `GET /gyms/:gymId/members/:memberId/progress-photos` (read) → `{ id, takenOn, url, uploadedBy }[]`, newest first, with fresh 5-minute links.
  - `POST …/progress-photos` (`writePhotos` + consent; multipart `photo`, plus field `takenOn` ≤ today) → `201` + `progress_photo.added`. Validation: `415` for a wrong type, `413` over 3 MB.
  - `DELETE …/progress-photos/:id` (`writePhotos`) → `204`; the object is removed after commit; `progress_photo.deleted`.

- [x] **Step 1: Write the failing tests:**
  - Without photo consent → `409`. With consent, M uploads → `201`; T lists it with a URL that returns the same bytes.
  - A cover trainer lists it (today) but gets `403` on upload; owner and reception → `404`.
  - M withdraws photo consent → the list is empty and the storage objects are gone. *(Review Focus 2)*
  - A wrong type → `415`; 3.1 MB → `413`; `takenOn` tomorrow → `400`. Two-gym isolation.
- [x] **Step 2: Run** `pnpm --filter api test progress-photos` → FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run** `pnpm --filter api test` → PASS.
- [x] **Step 5: Commit** `feat: progress photos with consent`.

---

### Task 5: Web, the workout logger (member)

**Files:**
- Create: `apps/web/src/features/workout/WorkoutPage.tsx`, `ExerciseLogCard.tsx`, `SetRow.tsx`, `RestTimer.tsx`, `FreeWorkoutPicker.tsx`, `workoutQueue.ts`, `useWorkoutSession.ts`, `WorkoutHistoryPage.tsx`
- Modify: `apps/web/src/features/my-plan/MyPlanPage.tsx` (the "Ξεκίνα προπόνηση" button per day, replacing the reserved spot), member shell (`free workout`, `history`), router, `el.json`, `en.json`
- Test: one `*.spec.tsx` per component; `workoutQueue.spec.ts`; `e2e/workout.spec.ts`

**Interfaces:**
- `workoutQueue`: `enqueue(op: { method: 'PUT' | 'DELETE' | 'POST'; path: string; body?: unknown })`, `flush(send: (op) => Promise<void>): Promise<void>` (in order, stops at the first network failure and keeps the rest), `size(): number`. It flushes on the `online` event, on app start and every 15 s while non-empty. A `4xx` response drops that operation and reports it; a `5xx` or network error keeps it.
- `useWorkoutSession(source: { planDayId } | 'free')`: creates a client UUID session (`crypto.randomUUID()`), prefills rows from plan targets and `last-performance`, and writes every change through the queue (optimistic UI). It resumes an open session found on load.
- `WorkoutPage`:
  - One `ExerciseLogCard` per exercise: name, target ("4 × 8–10 @ 50 kg"), "Την προηγούμενη φορά: 50×10, 50×9…", and `SetRow`s (reps and kg inputs with large +/− steppers, a done checkbox at least 44 px).
  - "Προσθήκη σετ" adds a row. Ticking a set as done starts `RestTimer` with the target rest, a visible countdown and a vibration at zero where supported.
  - "Τέλος προπόνησης" finishes the session and shows a summary.
  - A small status line: "Αποθηκεύτηκε" / "Χωρίς σύνδεση — θα αποθηκευτεί" (with the queue size).
  - `duration` exercises show a seconds field (mm:ss).
  - Free workout: `FreeWorkoutPicker` reuses `ExercisePicker` to add exercises on the fly.
- `WorkoutHistoryPage`: past sessions (date, plan day or "Ελεύθερη", exercises, sets).

- [x] **Step 1: Write the failing tests:**
  - `workoutQueue`: three enqueued `PUT`s flush in order; a network failure on the second keeps ops 2–3; a `400` drops that op and continues.
  - Logger: prefill shows plan targets and last time; ticking "done" starts the rest timer at the target seconds (fake timers); while offline (mocked `navigator.onLine` plus failing fetch), the status shows the queued count, and after `online` the queue is empty.
  - Free workout: picking an exercise adds a card.
  - At 375 px, inputs and steppers are at least 44 px.
  - E2E: a member with an active plan starts Day A → logs 2 sets → the test sets the context offline (`context.setOffline(true)`) → logs a third set → back online → finish → history shows 3 sets, and the API has exactly 3. *(Review Focus 1)*
- [x] **Step 2: Run** `pnpm --filter web test workout && pnpm e2e` → FAIL.
- [x] **Step 3: Implement.** Run ui-ux-reviewer (one-handed phone use mid-workout, Greek, dark mode, big targets).
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat(web): workout logger with offline queue, free workouts, history`.

---

### Task 6: Web, progress charts

**Files:**
- Add dependency: `recharts` (web)
- Create: `apps/web/src/features/progress/ProgressPage.tsx` (member: "Πρόοδος"), `ExerciseChart.tsx`, `VolumeChart.tsx`, `AttendanceChart.tsx`, `MeasurementsChart.tsx`, `chartTheme.ts`
- Modify: `apps/web/src/features/plans/ClientPlansPage.tsx` (trainer: a "Πρόοδος" tab using the same components with `memberId`), member shell, router, `el.json`, `en.json`
- Test: one `*.spec.tsx` per chart (data shaping and empty states; Recharts mocked to a simple renderer), `ProgressPage.spec.tsx`

**Interfaces:**
- `ProgressPage({ memberId? })` (no `memberId` → `/me` endpoints):
  - An exercise selector (from `progress/exercises`), then `ExerciseChart` with the top set line and the e1RM line.
  - `VolumeChart` (weekly bars), `AttendanceChart` (days per week), and `MeasurementsChart` (weight and body fat over time; only if consent was given and data exists).
  - A range switch: 3 / 6 / 12 months → `weeks` 13 / 26 / 52.
- Each chart has: a text summary for screen readers ("Από 60 σε 70 κιλά τους τελευταίους 3 μήνες"), axes formatted for el/en, an empty state ("Δεν υπάρχουν ακόμη καταγραφές"), and works in dark mode.
- Follow the `dataviz` skill for colours and mark specs.

- [x] **Step 1: Write the failing tests:** an empty data set shows the empty state; the exercise selector change refetches with the new id; the summary text names the first and last values; the range switch sends `weeks=52`; the measurements chart is hidden without consent.
- [x] **Step 2: Run** `pnpm --filter web test progress` → FAIL.
- [x] **Step 3: Implement.** Run ui-ux-reviewer (contrast in both themes, readable at 375 px).
- [x] **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `feat(web): progress charts for members and trainers`.

---

### Task 7: Web, consent, measurements and progress photos

**Files:**
- Create: `apps/web/src/features/health/ConsentCard.tsx` (member settings and the first visit to "Πρόοδος"), `WithdrawConsentDialog.tsx`, `MeasurementForm.tsx` (trainer), `MeasurementsList.tsx`, `ProgressPhotos.tsx` (gallery + upload, with a resize to 1200 px reusing the photo-capture canvas helper)
- Modify: `ProgressPage.tsx`, `ClientPlansPage.tsx` (trainer tab), member shell (a "Ρυθμίσεις απορρήτου" entry), router, `el.json`, `en.json`
- Test: one `*.spec.tsx` per component; `e2e/health.spec.ts`

**Interfaces:**
- `ConsentCard(kind)`: a plain-language explanation of what is stored and who sees it (the member and their trainer; never the owner or reception), with "Συμφωνώ" and "Ανάκληση".
- `WithdrawConsentDialog`: "Θα διαγραφούν οριστικά N μετρήσεις/φωτογραφίες" and a confirm button (destructive styling).
- `MeasurementForm` (primary trainer only): date (default today), weight, body fat, and optional circumferences under "Περισσότερα". Disabled with a "Δεν έχει δοθεί συγκατάθεση" note without consent.
- `ProgressPhotos`: a grid of thumbnails with the date, tap for full size, delete with confirm, and "Προσθήκη φωτογραφίας" (`accept="image/*"`, `capture="environment"` optional).

- [x] **Step X: Write the failing tests:**
  - Without consent, the trainer's form is disabled with the note.
  - The withdraw dialog shows the count and calls `DELETE` only after confirmation.
  - Photo upload resizes a 3000×2000 image to 1200×800 (canvas mocked).
  - A cover trainer sees measurements but no form or upload.
  - E2E: a member grants measurement consent → the trainer records a measurement → the member sees it in the chart → the member withdraws → the trainer's tab shows none and the form is disabled. *(Review Focus 2)*
- [x] **Step X: Run** `pnpm --filter web test health && pnpm e2e` → FAIL.
- [x] **Step X: Implement.** Run ui-ux-reviewer.
- [x] **Step X: Run** `pnpm lint && pnpm typecheck && pnpm -r test && pnpm e2e` → PASS.
- [ ] **Step 5: Manual check** on the iPhone through the tunnel:
  - Log a workout with mobile data switched off mid-session, then switch it back on; the sets arrive.
  - Type a weight with a Greek comma (`22,5`) in both the plan editor and the logger (carries the phase 4a ruling).
  - Record both in `PROGRESS.md`.
- [ ] **Step 6: Commit** `feat(web): health consent, measurements and progress photos`.

---

## Self-review notes

- **Spec coverage:**
  - §6.6: logging sets from the plan, one-handed → T1, T5; charts (top set and e1RM, weekly volume, attendance, measurements) → T2, T6; the trainer sees the same charts → T6.
  - §6.4: free workouts for members without a trainer → T1, T5; the cover trainer helps while the member logs → member-owned writes, cover read (T1).
  - §6.7: the trainer records measurements; members see them → T3, T6, T7; progress photos only for the member and trainer, with consent → T4, T7.
  - §8: explicit, withdrawable consent → T3, T7; signed links → T4.
- **Carried from phase 4a:** a changed `measure` is tolerated by snapshotting (T1, T2). The Greek comma check is in T7's manual step. Account erasure stays open (no erasure flow yet; GDPR features are in phase 7).
