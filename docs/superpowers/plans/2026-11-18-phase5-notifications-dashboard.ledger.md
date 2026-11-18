# SDD ledger — plan: docs/superpowers/plans/2026-11-18-phase5-notifications-dashboard.md
Base: d638143 (branch phase5-notifications-dashboard, main checkout, no worktree - same as earlier phases)
Pre-flight: T1 produces notify()/prefs -> T2 consumes notify(); T1 shared schemas -> T3 web; T6 reuses present-now from 2b -> T4 today tiles. No conflicts known yet.
Task 1: Ruling: dedupe via advisory xact lock (+lock_timeout 5s) taken before sending, because send-then-insert cannot give one email for two concurrent calls — cost if wrong: connection held during SMTP/push
Task 1: Ruling: no usable channel (email off, no push subs) or non-member recipient -> opted_out, no row — avoids hourly retry loop
Task 1: database-expert deferred minors: channels value CHECK, event CHECK, rename group column, retention/DELETE grants
Task 1: code-reviewer: fixed SSRF (https + push-host allow-list, RED->GREEN), 10s push timeout; deferred minors: not_member result, N+1 subs query in scan, gym name in push title, takeover-by-endpoint kept (last subscriber wins, plan-mandated)
Task 1: complete (commits d638143..e2da2be, tests: pnpm --filter api test →              learn more: https://vitest.dev/guide/improving-performance#test-isolation)
Task 2: Ruling: migration 0024 also grants UPDATE(reminder_days) on gyms to gym_app (column grants pattern of 0011/0015)
Task 2: Ruling: web UI for reminderDays moves to Task 6 (with capacity/occupancy settings on GymSettingsPage); API + shared done in Task 2
Task 2: database-expert: no index needed (revisit >50k memberships/gym or per-minute runs); 0024 ok
Task 2: Ruling: reminders stay exact-day (plan + spec 5 days before); a gym-wide outage lasting past midnight loses that day's reminder — widening would email on purchase of short memberships. Deferred minor: catch-up window; self-written plan announce (members cannot write plans)
Task 2: complete (commits e2da2be..16c16fb, tests: pnpm --filter api test →              learn more: https://vitest.dev/guide/improving-performance#test-isolation)
Task 2: complete incl. reviews (code-reviewer, database-expert, test-auditor x2)
Task 3: complete (commits 27f7f65..ad4ba51, tests: pnpm --filter web test →              learn more: https://vitest.dev/guide/improving-performance#test-environments)
Task 3: Ruling: /settings/notifications redirects to the gym notifications page when the person is a member-only (highest role) of exactly one gym, else the gym picker/home; prefs are per gym
Task 3: reviews done (ui-ux, code, test-auditor). Deferred minors: stale VAPID key on resubscribe, shared push state between card and settings page, card dismissal per browser not per user, PWA installability (Lighthouse) not checked
BLOCKER: Docker Desktop not running at end of Task 3; API tests could not be re-run after the last web-only edits (web 690 pass, build ok)
Task 4: reviews: fixed notRenewed-before-end, provisional=latest end+14, quadratic renewal check, id batching. Deferred minors: busy hours aggregation in SQL, bound memberships read (+ (gym_id,ends_on) idx), expiringSoon includes <=2 visits left (memberStatus reuse), unlimited visit packs count active forever, per-gym cache
Task 4: complete (commits ad4ba51..a8e5106, tests: pnpm --filter api test →              learn more: https://vitest.dev/guide/improving-performance#test-isolation)
Task 5: Ruling: heatmap last slot is written 23:00-24:00 (code-reviewer) over the 00:00 an earlier test asserted. Reviews applied: stale-gym race, index series keys, singular check-in wording, darker green + dashed outline for provisional months, heatmap focusable scroller + sticky row labels + visible counts, compact euro axis, month axis without year. Deferred minors: ChartFrame role=img label stays the title (ProgressPage tests), touch readout line for heatmap, tile aria-labels, skeleton loading, summary note when current month provisional
Task 5: complete (commits a8e5106..487c80c, tests: pnpm --filter web test →              learn more: https://vitest.dev/guide/improving-performance#test-environments)
Task 5: note: signup.spec VerifyEmailPage test failed once in a full parallel web run, passed 3x alone and in the ledger run (flaky under load, not related)
Task 6: database-expert: migration ok. Deferred minors: count inside in SQL (DISTINCT ON) and a 5-10s per-gym cache / SSE push instead of polling (only matters at ~2000 polling members), Cache-Control on occupancy, rollback note. Ruling: e2e capacity 5 (not 10) so 3 inside is moderate; members invited, not signed up, in e2e (signup route throttled 10/min/IP)
Task 6: complete (commits 487c80c..3cb0a12, tests: pnpm -r test → apps/api test: Done)
Task 6: Task 6 Step 5 (manual check on real phones) NOT done; reviews (code, db, ui, test-auditor) applied
Final: fixed day pass "visits low" -> test: day pass never mails, RED->GREEN, suite green
Final: fixed SMTP can exhaust pool -> mail transport timeouts + dispatch concurrency cap 3 (tests RED->GREEN)
Final: fixed push survives logout -> dropPushSubscription on sign-out (tests RED->GREEN)
Final: fixed failed visits.low/plan.assigned never retried -> hourly run re-derives them from the last 24h with the same dedupe keys (tests RED->GREEN)
Final: minor (deferred): staff who are also members get reminders but cannot reach settings page
Final: minor (deferred): day passes in selectReminders (expires today / counted as renewal)
Final: minor (deferred): freeze in the last N-1 days can skip the expiring reminder; lowering reminderDays can skip a cycle
Final: minor (deferred): used-up visit pack with an end date counts as active member
Final: minor (deferred): push host allow-list accepts any *.googleapis.com
