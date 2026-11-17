# SDD ledger — plan: docs/superpowers/plans/2026-11-17-phase3-staff-shifts.md
Base: 8dddb02 (branch phase3-staff-shifts)
Pre-flight: T1→T3/T4/T5 (role-removal hooks in StaffService), T2→T3 (expandShifts, shared shift types), T4→T5 (trainerAccess, TrainerClient), T3/T4/T5→T6-8 (shared schemas); all follow plan interfaces
Task 1: Ruling: the two-owners race is tested through StaffService (not HTTP) plus a deterministic lock-wait test — over HTTP the loser's role check can already see the winner's commit and answer 403 instead of 409; both keep the gym owner-ful — cost: none.
Task 1: complete (commit c46b572; pnpm --filter api test → 392 passed at the time)
Task 2: complete (commit c46b572; shifts/expand.spec 11 tests + shared 60 pass)
Task 3: Ruling: migration 0015 widened the series FK to (series_id, gym_id, staff_id) so an override cannot name another person than its series (database-expert) — cost: none.
Task 3: Ruling: future shifts are deleted when the trainer role is removed or when the person is left with no staff role (plan says "removing a trainer deletes future shifts"; a reception+trainer person keeps nothing either way for trainer removal) — cost: a person who is both trainer and reception loses their future shifts when only the trainer role goes.
Task 3: Ruling: createSeries refuses a time overlap of two series of one person with 409 (split shifts allowed, touching ends allowed) — plan silent, database-expert advised a service check — cost: none.
Task 3: Ruling: settings PATCH body is now partial (autoCheckoutMinutes and/or receptionCanEditShifts, at least one); GET returns receptionCanEditShifts; one history row per changed field, the receptionCanEditShifts row carries data.setting — cost: none.
Task 3: minor (deferred): createSeries overlap check takes no lock (two concurrent creates for one person could both pass; only owner/reception write); PATCH /shifts/:id with {} writes a history row without a change.
Task 3: complete (tests: pnpm --filter api test → 430 passed, lint, typecheck clean)
Task 4: Ruling: trainer assign and trainer-role removal serialise on a per-trainer advisory lock (lockTrainer) — code review found an orphan-link race — cost: none; tested by holding the lock from another connection.
Task 4: minor (deferred): previousTrainerId in the trainer.assigned history can be stale under two concurrent first assignments (FOR UPDATE on a missing row locks nothing).
Task 4: complete (tests: pnpm --filter api test → 448 passed at Task 5, lint, typecheck clean)
Task 5: Ruling: the check-in result's trainer is hidden when the primary link is paused (reviewer: a paused link gives no access), and a cover for a member already unpaused-primary of the same trainer is not listed twice — cost: the desk shows no trainer line for a member whose trainer membership ended.
Task 5: Ruling: CheckInResult.trainer/cover (first name and id of the trainer, whether on duty) also travel on the live stream to trainers — trainers already see who is inside and whom the visitors are; no health data or prices — cost: a trainer can see whose client a visitor is.
Task 5: Ruling: a trainer cannot cover themselves (400); the cover assign serialises with trainer role removal on the same per-trainer lock — cost: none.
Task 5: minor (deferred): previousTrainerId in cover.assigned history can be stale under two concurrent first covers for one member and date.
Task 5: complete (tests: pnpm --filter api test → 448 passed, lint, typecheck clean)
Task 6: Ruling: the trainer-role warning is its own block (ConfirmDialog `warning` prop) with neutral wording ("οι πελάτες που έχει…") instead of the plan's "Οι πελάτες του…" which assumes a male trainer — cost: none.
Task 6: Ruling: cancelling a pending invitation has no confirmation step (one tap, announced, focus back on the heading) — the invitation can be sent again — cost: a stray tap cancels an invite.
Task 6: Ruling: the reception-shift switch saves on its own PATCH at once (not part of the minutes form), one request at a time — cost: none.
Task 6: complete (tests: pnpm --filter web test → 322 passed incl. Task 7; lint clean)
Task 7: Ruling: POST /shift-series/:id/end with lastDate before validFrom deletes the series (and its overrides) when it has not produced a past day (validFrom ≥ today), else 400 — plan said 400; needed so "from this day on" works on a series' first day — cost: a series starting today loses today's occurrence even if the shift is in progress.
Task 7: Ruling: MySchedulePage takes "today" from the device calendar (trainers cannot read the gym settings, which hold the time zone) — cost: a trainer whose device is in another time zone sees the window shifted by a day near midnight.
Task 7: Ruling: reception's schedule section shows the week schedule, their own shifts and a read-only staff list; the owner's schedule is the week schedule only — cost: none.
Task 7: complete (tests: pnpm --filter web test → 361 passed incl. Task 8)
Task 7: minor (deferred): ShiftDialog defaults to 06:00–14:00.
Task 8: Ruling: the check-in card's cover button also appears on a member's own check-in verdict (member detail page), not only on the desk — same component — cost: none.
Task 8: Ruling: after "needs a personal-training membership → sell", the assignment dialog reopens once the sale is done (and not when the sale is abandoned) — UX review — cost: none.
Task 8: Ruling: e2e signs in and waits for the redirect before navigating (the first run raced the login) — cost: none.
Task 8: complete (tests: pnpm --filter web test → 361 passed; pnpm e2e → 5 passed; lint, typecheck clean)
Final: fixed "change from this day on" reopened an ended weekly shift and dropped later one-day changes — new POST /shift-series/:id/split (one transaction, keeps validUntil, moves later overrides, all-or-nothing on overlap); 4 split tests in shifts.e2e RED→GREEN, web dialog now sends one request, suite 454/360/60 + e2e 5.
Final: fixed shift writes take the per-staff lock (create series/shift, split) and setOccurrence locks the series row; a trainer cannot be their own primary trainer (400) — trainers.e2e test, suite green.
Final: minor (deferred): a paused primary trainer cannot be named cover for that member (400 'already primary'; the UI hides a paused trainer so it is not reachable today).
Final: minor (deferred): past-day errors are 400 for createSeries/endSeries/split but 409 for createShift/setOccurrence/one-off edits (plan text).
Final: minor (deferred): onDuty 'until' takes the first matching shift (back-to-back 06–10, 10–14 shows 'until 10:00' just before 10:00); shiftTimeSchema stops at 23:55 so a shift cannot run to midnight.
Final: minor (deferred): trainers can read check-in visitors of any date (?date=), spec §5 says today's visitors; the plan's test allows ?date=.
Final: minor (deferred): the trainer client list returns photo links for paused clients.
Final: Ruling: the live check-in stream carries trainer and cover first names to trainers — reviewer assessed acceptable (first names and ids only, stream re-checks the role every 15 minutes) — cost: a trainer can see whose client a visitor is.
Final review: fresh whole-branch reviewer (opus); no Critical findings, 1 Important fixed (above).
