# SDD ledger — plan: docs/superpowers/plans/2026-11-16-phase2a-memberships.md
Spec: docs/superpowers/specs/2026-11-15-gym-management-design.md (read §5, §6.0, §6.1, §6.10, §8)
Pre-flight:
- T1→T3: @ThrottleSignup decorator consumed by signup/verify routes — consistent.
- T1→T2,T3,T4: every users write via systemDb (gym_system) — T3 sign-up runs in a systemDb tx; T4 AuditService.record takes that tx; gym_system BYPASSRLS so audit insert works. Consistent.
- T2→T3: phoneSchema/dateOfBirthSchema/personNameSchema consumed by SignupSchema — consistent.
- T3→T4: "// history: Task 4" markers replaced in T4 — consistent.
- T4→T5,T7,T8: AuditService.record(tx,…) inside withGym — consistent.
- T6→T7,T8,T9: date/status functions; T7 introduces Clock provider, reused by T8/T9 — consistent.
- T7→T8: sale start uses effective end incl. freezes; T8 updates memberships.ends_on = effectiveEnd — consistent.
Task 1: Ruling: GitHub push (Step 6) deferred to end of run and asked then — outward-facing, remote never set up — cost if wrong: CI first runs later.
Task 1: Ruling: no `docker compose down -v`; create gym_system in the running container via psql, init.sql kept correct for fresh setups/CI — down -v wipes dev data — cost if wrong: none, same end state.
Task 1: complete (commits 126f270..cf53ef0, tests: bash -c 'pnpm lint && pnpm typecheck && pnpm -r test && pnpm e2e' →   1 passed (11.8s))
Task 1: Ruling: privileges.spec "gym_app can create account / change name" flipped to expect permission denied — plan revokes users writes from gym_app — cost if wrong: none, plan-mandated.
Task 1: Ruling: throttle counts every login (not only failures) as plan says; auth.e2e resets the in-memory store in beforeEach via test/throttle-reset.ts — cost if wrong: a person signing in 6× a minute sees 429.
Task 1: Ruling: systemDb pool max 5→10 (code-review: login/refresh/me/guard now share it) — cost if wrong: 5 extra DB connections.
Task 1: Ruling: trust proxy left unset, recorded as a pre-deploy open question in PROGRESS.md — deployment undecided — cost if wrong: behind a proxy the login key collapses to proxy IP.
Task 2: Ruling: drizzle-kit can't answer its rename prompt without a TTY; generated additions and drops separately, merged by hand into 0003_person_details with the snapshot chain re-linked (drizzle-kit generate reports no drift) — cost if wrong: next db:generate shows drift.
Task 2: Ruling: accounts created by accepting an invite get email_verified_at = now() (emailed link proves the address) — cost if wrong: staff never see an "unverified" state.
Task 2: Ruling: InvitePreview keeps fullName (computed first || ' ' || last) so the invite page is unchanged — cost if wrong: none.
Task 2: Ruling (code review): full_name = btrim(first || ' ' || last); gym_app gets column-level SELECT on users excluding password_hash and is_platform_admin (in 0003; local gym/gym_test patched by hand since 0003 was already applied) — cost if wrong: a future users column needs an explicit grant.
Task 2: Ruling: review-fix tests (trailing space, column grants) were written after the fix, not watched RED — cost if wrong: tests might not catch a regression (they assert exact values/permission errors, low risk).
Task 2: complete (commits cf53ef0..c066916, tests: bash -c 'pnpm lint && pnpm typecheck && pnpm -r test && pnpm e2e' →   1 passed (11.6s))
Task 3: Ruling: verification link format `${WEB_ORIGIN}/verify-email/<token>` set now (plan lists it under Task 10) — tests need a link to parse — cost if wrong: none.
Task 3: Ruling: argon2 hash computed before the claim transaction (keeps the code's row lock short); invalid-but-well-formed codes cost one hash, bounded by the 10/min/IP throttle — cost if wrong: CPU under a distributed guess attack.
Task 3: Ruling (code review): /auth/resend-verification throttled with the sign-up limit (10/60 s/IP); verification-mail failure logs the user id, not the email — test for resend 429 written after the fix (not watched RED).
Task 3: Ruling: accepted risk, surfaced to user: someone holding a valid reception code can register another person's (unverified) email with their own password and is signed in; later invites add roles to that account. Mitigated by the code being handed over in person — cost if wrong: account pre-hijack; fix would be "no session until email verified".
Task 3: minor (deferred): gym_app can SELECT signup_codes.code_hash (31^8 unsalted, 24 h); column-level grant would hide it.
Task 3: minor (deferred): no cleanup job for used/expired signup_codes and email_verifications rows.
Task 3: complete (commits c066916..a4c58ae, tests: pnpm --filter api test →    Duration  5.90s (import 60%, tests 37%, transform 3%))
Task 4: Ruling: actor names in GET /audit read through systemDb for the actor ids on the page (users RLS hides people without a role in the gym, e.g. the platform admin who created the gym or departed staff) — cost if wrong: a name of someone outside the gym is shown to the owner (only people who acted in that gym).
Task 4: Ruling: gym_system keeps DELETE on audit_log (account/gym erasure), UPDATE revoked; "append-only" means no API role can edit — cost if wrong: systemDb code could delete history.
Task 4: Ruling (review): invitation.sent stores roles only (no email: history isn't erasable); unknown actor → null; paging fetches limit+1; before ≤ 15 digits; entity index gains id desc (local DBs patched by hand).
Task 4: minor (deferred): bigserial instead of identity column (DB expert's preference); ids follow allocation not commit order (paging could skip a row from a long transaction).
Task 4: complete (commits a4c58ae..7869714, tests: pnpm --filter api test →    Duration  6.87s (import 61%, tests 36%, transform 3%))
Task 5: Ruling: PATCH /membership-types/:id takes the full MembershipTypeInput (a partial update can't be validated against the per-kind rules) — cost if wrong: clients must send every field.
Task 5: Ruling: ShellLayout gets a `pages` prop (nav key → element) so real sections replace placeholders; owner nav gains "membershipTypes" — cost if wrong: none.
Task 5: Ruling: lib/format.ts (formatMoney, formatDate, parseEuros) created now; Task 11 lists it, and its tests come then — cost if wrong: none.
Task 5: Ruling (code review): archived types can't be edited (404); archiving twice is a 204 no-op with one history row; form maps the price limit and has a catch-all error; parseEuros capped at 99,999.99 €.
Task 5: Ruling (ui-ux review): ConfirmDialog traps Tab and keeps onCancel in a ref; focus moves into the form on open and back to the page title on close; errors shown in a red role=alert, success with ✓ in role=status; row buttons disabled while a form is open; archived rows lose opacity (contrast).
Task 5: minor (deferred): no dark-mode classes (app has none yet); no unique name per gym; includes_classes allowed on non-class kinds; ConfirmDialog doesn't make the page behind inert.
Task 5: complete (commits 7869714..35e91e2, tests: bash -c 'pnpm -r test' → apps/api test: Done)
Task 6: minor (deferred): frozenDays double-counts overlapping freezes (Task 8 must reject overlaps); remaining() ignores voidedAt (callers check status first).
Task 6: complete (commits 35e91e2..d765425, tests: pnpm --filter api test memberships →    Duration  655ms (tests 31%, import 24%, transform 17%, setup 16%, worker 11%))
Task 7: Ruling: Membership.endsOn = base end (paid period), effectiveEndsOn = stored ends_on (with freezes) — plan names both fields — cost if wrong: clients may confuse the two.
Task 7: Ruling: injected Clock (common/clock.ts, global) decides "today" and stamps paid_at/voided_at, so the payment lands on the gym day it was sold — cost if wrong: none.
Task 7: Ruling: one per-member advisory lock (lockMember) for sell and void (and Task 8 freezes) instead of row locks — serialises everything that moves a member's end dates — cost if wrong: a little contention per member.
Task 7: Ruling: names of member/recorder/voider read through systemDb (common/names.ts, shared with audit) for ids taken from the gym's rows — departed staff still show — cost if wrong: see Task 4 ruling.
Task 7: Ruling (reviews): amount above the type price → 400 (discounts allowed); payments range ≤ 366 days inclusive; composite FKs (type_id,gym_id) and (membership_id,gym_id); trigger forbids un-voiding; kind CHECK (time ⇒ end date, other ⇒ visits); payments index (gym, member, paid_at desc). 0007 was reapplied locally after editing (tables dropped and migration row removed by hand on gym and gym_test).
Task 7: Ruling: an explicit startsOn is honoured even if it overlaps a current time membership (reception's choice) — cost if wrong: overlapping periods.
Task 7: minor (deferred): voided_by not tied to voided_at by CHECK (ON DELETE SET NULL would break it); voiding doesn't record visits already used.
Task 7: complete (commits d765425..db1b8bd, tests: pnpm --filter api test →    Duration  7.16s (import 57%, tests 39%, transform 3%))
Task 8: Ruling: a freeze must start inside the membership (membership start ≤ freeze start ≤ current effective end), else 400 — plan silent; a freeze after the end is meaningless — cost if wrong: reception can't pre-book a freeze past the end.
Task 8: Ruling: ending a freeze that is already over → 409 (plan covers not-started, started-today and running only) — cost if wrong: none.
Task 8: Ruling: overlap prevention stays in the service under lockMember (no btree_gist exclusion constraint; DB expert agreed) — cost if wrong: a write path skipping the service could overlap.
Task 8: Ruling: OPEN QUESTION for user — freezing a membership that already has an early renewal pushes its end into the renewal's period (frozen days effectively lost); not changed (spec silent; fix = shift later memberships or forbid such freezes) — cost if wrong: members who renew early and then freeze lose days.
Task 8: minor (deferred): end() doesn't check that the membership is voided.
Task 8: complete (commits db1b8bd..8a12058, tests: pnpm --filter api test →    Duration  7.46s (import 57%, tests 40%, transform 2%))
Task 9: Ruling: accent-insensitive search with the unaccent extension (migration 0009, trusted ext created by gym_owner) plus translate(ς→σ), LIKE with escaped % and _ — no index yet (DB expert: fine for a gym's size) — cost if wrong: slow search at tens of thousands of users.
Task 9: Ruling: member status computed in JS from memberships+freezes for the gym's today; without a status filter only 100 members are loaded (SQL limit, tiebreak by user id); with a status filter every matching member is evaluated — cost if wrong: slow filtered lists for very large gyms.
Task 9: Ruling: "expiring" = has an active membership, nothing upcoming, and every active one ends within 7 days (today included) or has ≤ 2 visits; only-upcoming counts as active — plan defines expiring for one membership only — cost if wrong: renewals list slightly different.
Task 9: Ruling: reception sees price, date of birth and emergency contact in member detail (needed to sell and to check the person at the desk); only payments are owner-only — cost if wrong: reception sees more personal data than needed.
Task 9: complete (commits 8a12058..3a47529, tests: pnpm --filter api test →    Duration  8.47s (import 56%, tests 40%, transform 3%))
Task 10: Ruling: the e2e sign-up test was written after the implementation (not watched RED); unit tests were RED first — cost if wrong: e2e might not catch a regression it claims to.
Task 10: Ruling: the code's expiry is shown in the device's local time (the reception tablet is in the gym; /auth/me carries no gym time zone) — cost if wrong: wrong hour shown on a device in another zone.
Task 10: Ruling: "new member code" button also in the owner shell (owner covers reception, spec §5) — cost if wrong: none.
Task 10: Ruling (reviews): VerifyEmailPage refreshes the profile in a separate effect once auth is ready (fixes stale banner on a fresh tab); resend guarded against double taps with a "sending" label; code read letter by letter (aria-label); dialogs render in a portal and make #root inert (Modal helper, also used by ConfirmDialog); code hint says the dash is optional.
Task 10: minor (deferred): no dark-mode classes; "gone" verify state doesn't offer resend inline.
Task 10: complete (commits 3a47529..2a77d63, tests: bash -c 'pnpm --filter web test && pnpm e2e' →   2 passed (12.1s))
Task 11: Ruling: nav links made absolute (/g/:gymId/<key>) — relative links nested under the current section (bug found by the memberships e2e; pre-existing since phase 1, exposed by sections) — cost if wrong: none.
Task 11: Ruling: member home is now "my membership" (nav order myMembership, myWorkouts); sections use `${key}/*` routes so members/:memberId nests — cost if wrong: none.
Task 11: Ruling: history sentences don't name the member sold to (audit data has no member name; history isn't erasable) — cost if wrong: owner reads less detail.
Task 11: Ruling: format.ts tests passed at once (format.ts already written in Task 5) — not RED.
Task 11: reviews run 2026-11-17 (ui-ux, test-auditor, code-reviewer). Ruling (reviews): a failed refresh after a sale/freeze keeps the member page and confirmation (no double sale); focus goes to the void notice (Dialog returnFocusTo), to the sale confirmation title (keyed dialogs), and stays on "load more" while loading; 409 on void says "already voided"; history cursor URL-encoded; Dialog Tab trap covers all focusables; expired/used-up badges red-ringed, expiring amber-ringed, member badge larger; member card fits 375 px with visible "left"; members list announces a count, not the list; payments rows cleared for an invalid range. Tests for these written first and watched RED.
Task 11: Ruling: payments "today", list and history times use the device's time zone (the web app has no gym time zone; the desk/owner device is in the gym) — cost if wrong: wrong day shown on a device in another zone.
Task 11: minor (deferred): no dark-mode classes; choose-type error doesn't move focus to the type list.
