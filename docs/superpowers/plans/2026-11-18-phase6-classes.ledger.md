# SDD ledger — plan: docs/superpowers/plans/2026-11-18-phase6-classes.md
Pre-flight: T1→T2 (session cancel hook; T2 extends), T1→T3 (ends_at_utc), T2→T3 (entry_consumed, bookings), T2/T3→T4 (notify on cancel). Rule per task when read.
Task 1: complete (commits 2a88f1e..de8b488, tests: pnpm --filter api test →              learn more: https://vitest.dev/guide/improving-performance#test-isolation)
Task 1: Ruling: classes must end before 23:59 (start+duration < 1440), zod + DB check — a 24:00 end cannot be stored in time columns — rejects classes ending exactly at midnight
Task 1: Ruling: class_series dates check relaxed to valid_until >= valid_from - 1 so a series can be ended before it starts (kept as empty row; sessions FK) — costs: none known
Task 1: Ruling: localToUtc: gap time moves forward by the gap; overlap takes first occurrence
Task 1: Ruling: session query range 31 days inclusive both ends; MAX_CLASS_QUERY_DAYS
Task 1: Ruling: "edit from date X" = end old series (lastDate X-1) then create new one, two client calls (no split route in plan); cost: non-atomic if second call fails
Task 1: Ruling: cancelling an ended session → 409, cancelling twice → 204 no-op
Task 1: Ruling: materialise reads series FOR SHARE to serialise with endSeries (review finding)
Task 1: deferred to Task 2: booking must reject sessions with startsAtUtc <= now (series/session may be created for a time already passed today); archived types still generate sessions from existing series (minor, deferred)
Task 2: complete (commits de8b488..0e4ad47, tests: pnpm --filter api test →              learn more: https://vitest.dev/guide/improving-performance#test-isolation)
Task 3: complete (commits 0e4ad47..40bb734, tests: pnpm --filter api test →              learn more: https://vitest.dev/guide/improving-performance#test-isolation)
Task 4: complete (commits 40bb734..12e5532, tests: pnpm --filter api test →              learn more: https://vitest.dev/guide/improving-performance#test-isolation)
Task 2: Ruling: classEligibility(ms, reserved) drops the plan's sessionDate param — memberships are pre-evaluated for the session date (toMembership(row, freezes, sessionDate)) so status==='active' already means valid that day; time/other memberships chosen soonest-end-first
Task 2: Ruling: member endpoints: member books self; reception/owner may pass memberId; staff booking is not audited (no action in plan's list) — minor deferred; 14-day window applies to staff too
Task 2: Ruling: staff cancel allowed any time while status=booked (even after start) — never charged
Task 2: Ruling: 0028_class_bookings_hardening (review): partial index on membership_id,gym_id WHERE booked; CHECKs for cancelled_at/attended_at/consumed→membership
Task 2: Final: minor (deferred): attendees() inner-joins users: a booking whose member lost their role shows in capacity but not in the attendee list
Task 3: Ruling: marking before 60 min ahead of start → 400; no_show allowed from 60 min before start too (reviewer suggested start-only) — minor deferred
Task 3: Ruling: a valid check-in with a booking in its window marks that booking attended even when a time membership opened the door (spec §6.8 "attendance by check-in")
Task 3: Ruling: window bookings read FOR UPDATE inside check-in; a booking's own membership must be active to open the door
Task 3: Final: minor (deferred): duplicate (2-min repeat) check-in result omits classBooking; failed visit-pack race doesn't fall back to the booking; consumeEntry returning false (pack exhausted) is silent
Task 4: Ruling: notification prefs now have 3 groups; PUT body must include `classes` (zod); migration 0029 widens notification_prefs_group_chk
Task 4: Ruling: cancellation notices are dispatched (background) after commit by ClassNotifier.notifyCancelled; reminders run every 15 min in ClassesJob (reminder window (now, now+2h])
Task 5: Ruling: the session detail opens in place inside TimetablePage (no new route) — keeps the shell's flat nav; back returns to the week
Task 5: Ruling: "change from this day" = end old series (day-1) then create; the old series' valid_until is not carried to the new series (the session view doesn't expose it) — minor deferred; a failed second call is retried without re-ending
Task 5: Ruling: cancel reason is a field on the page (ConfirmDialog has no children); the notified count comes from attendees still `booked`
Task 5: Ruling: trainers for the dialogs come from /schedule (staff with the trainer role); reception gets view-only, no types/staff fetch
Task 5: complete (commits 12e5532..2a32d21, tests: pnpm --filter web test →              learn more: https://vitest.dev/guide/improving-performance#test-environments)
Task 6: Ruling: classes are not merged into MySchedulePage (its spec fixes the fetch contract); trainers get a "Μαθήματα" nav section (MyClassesPage) next to their shifts — cost: shifts and classes are on two screens
Task 6: Ruling: only today's non-cancelled classes open into attendance; later days are listed read-only (marking opens 60 min before start in the API); earlier days are not listed
Task 4: Final: fixed notifyCancelled failing the committed cancel (now best effort) — test 'a failure while sending cancellation notices never fails the committed cancel'; reminder text names the date instead of "today"
Task 6: complete (commits 2a32d21..9e165b2, tests: pnpm --filter web test →              learn more: https://vitest.dev/guide/improving-performance#test-environments)
Task 7: Ruling: ClassSessionView.myBooking and BookingView carry usesEntry + late (server computed from the gym cut-off) so the member app can warn only when a late cancel really costs a pack entry; members cannot read gym settings
Task 7: Ruling: the member app decides "needs a membership with classes" from /me/memberships (active/upcoming with includesClasses) and lets the server's 409 have the last word
Task 7: Ruling: e2e classes.spec.ts cancels member 1's booking inside the 120-min cut-off (the class must start within the 60-min door window), asserting the pack-entry warning; skips between 22:00 and midnight gym time; a test-only POST /test/classes/no-shows (NODE_ENV=test, platform admin) stands in for waiting out the class
Task 7: Step 5 (phone checks) NOT done — needs the user's iPhone/Android
Task 7: complete (commits 9e165b2..09c598c, tests: pnpm -r test → apps/web test: Done)
Final: fixed cancelling a class after members were ticked/checked in (attended/no_show bookings are cancelled, spent entries given back, members notified) — test 'cancelling a class after a member checked in gives the entry back and returns the booking' RED→GREEN, suite API 851/851
Final: fixed a member with a visit pack and a class pack paying twice (the booked class is paid by its entry before a gym visit is spent) — decide.spec 'a visit pack next to a class pack…' RED→GREEN
Final: fixed the series-end reason leaking as "series_ended" into emails — class-notifications spec asserts it is absent, RED→GREEN
Final: fixed a class in the spring-forward gap hour failing the UTC check (end = start + length) — timetable spec 'a class in the hour that does not exist…' RED→GREEN
Final: fixed no-show ticked before the start (now 400 until the class starts) — attendance spec 'no-show can only be ticked once the class has started' RED→GREEN
Final: Ruling: a member holding a visit pack and a class pack is let in for a booked class on the class entry, spending no gym visit — one class, one charge; cost if wrong: such a member never spends a gym visit on a day they attend a class
Final: Ruling: a late_cancelled booking is not refunded when the gym then cancels the class (reviewer "declined to judge") — the member chose the late cancel before the gym acted; cost if wrong: one entry
Final: Ruling: cancellation notices are at-most-once (a crash between commit and dispatch loses them) — same trade-off as phase 5 events; cost if wrong: a member not told
Final: minor (deferred): web screens take "today" from the device time zone, not the gym's (same as MySchedulePage)
Final: minor (deferred): desk class line shows the Greek class name in the English UI
Final: minor (deferred): ClassTimetablePage 'names the chosen day…' failed once under full parallel load (passes alone and in 3 full web runs) — timing flake to watch
