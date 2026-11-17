# SDD ledger — plan: docs/superpowers/plans/2026-11-17-phase2b-front-desk.md
Pre-flight: T1→T3 (token verify), T2→T3 (DeviceGuard, devices table), T3→T4 (CheckInService event publish), T3/T4→T5 (photoUrl), T1-5→T6-8 (shared schemas); all follow plan interfaces
Task 1: complete (commits bb1a91c..8caa5ff, tests: pnpm --filter api test →    Duration  8.74s (import 56%, tests 41%, transform 3%))
Task 2: complete (commits 8caa5ff..b51615b, tests: pnpm --filter api test →              learn more: https://vitest.dev/guide/improving-performance#test-isolation)
Task 3: complete (commits b51615b..3267e49, tests: pnpm --filter api test →              learn more: https://vitest.dev/guide/improving-performance#test-isolation)
Task 3: Ruling: reason on a refused repeat — a refused latest check-in short-circuits (duplicate) only while the verdict is unchanged; a checked-out row never short-circuits — reviewer found a sale right after a refusal was ignored for 2 min — cost if wrong: an extra refused row per changed verdict.
Task 3: Ruling: check_ins indexes ascending (not DESC) and extra CHECKs (kiosk needs device; visit_consumed needs valid+membership) — DB review: DESC NULLS LAST index would not serve ORDER BY at DESC — cost: none; 0013 regenerated, gym_test row for old 0013 was removed by hand.
Task 3: Ruling: devices gets UNIQUE(id, gym_id) in migration 0013 so check_ins can have a same-gym composite FK — cost: none.
Task 4: Ruling: present boundary is inclusive (at >= now - minutes) so a check-in exactly 120 min old is present and 121 is not — plan text said 'at > now - minutes' but its own test expects 12:00 present for 10:00 — cost: 1 minute difference.
Task 4: Ruling: GET /gyms/:gymId/live has no @GymRoles (ticket is the credential), listed in route-guards PUBLIC_GYM_ROUTES with a reason; the guard test fails if the entry goes stale — cost: none.
Task 4: complete (commits 3267e49..867ff26, tests: pnpm --filter api test →              learn more: https://vitest.dev/guide/improving-performance#test-isolation)
Task 5: Ruling: concurrent first uploads serialised with lockMember (reviewer: second insert would hit the PK and 500) — the new two-parallel-PUT test passes even without the lock (race did not reproduce locally), so it is a regression guard, not proof — cost: none.
Task 5: Ruling: photos test skips with a stated reason when S3_ENDPOINT is unreachable; CI has no MinIO so photo tests are skipped there — cost: photo regressions are only caught locally until a MinIO service is added to CI.
Task 5: minor (deferred): member_photos.member_id is ON DELETE NO ACTION and has no same-gym FK to gym_roles; the GDPR erasure routine must also delete the MinIO objects under gyms/<gym>/members/<id>/ — decide with the erasure feature.
Task 5: complete (commits 867ff26..ae0048b, tests: pnpm --filter api test →              learn more: https://vitest.dev/guide/improving-performance#test-isolation)
Task 6: Ruling: a failed refresh keeps the current code until its own expiry (it is valid 45 s, refreshed every 30 s) and only sets error; the offline panel appears once no valid code remains — plan said 'offline or error: message instead of a stale code', a code that has not expired is not stale; UI reviewer flagged blanking a working code at the door — cost: member may show a code up to 15 s after the refresh failed.
Task 6: Ruling: member home is now the check-in screen; 'my membership' moved to its own nav section — plan: 'member shell nav (checkIn first)' — cost: none.
Task 6: minor (deferred): offline panel text is shown for every failure kind (403/500 too); expiry compares with the device clock (skewed phone clock). Prettier was run over files changed on this branch (formatting only).
Task 6: complete (commits ae0048b..600eaa3, tests: pnpm --filter web test →              at least ~842ms faster with isolate: false — reuses workers across files instead of one per file)
Task 7: Ruling: kioskFetch sends credentials 'omit' and times out after 5 s (rejects with a non-ApiError, so the tablet does not unpair on a slow network) — reviewer found cookies and hung requests — cost: a 5 s+ slow answer shows 'connection problem'.
Task 7: Ruling: the same-token ignore window restarts when the result clears (so a code still held up is not scanned again) — cost: the same member re-scanning deliberately within 3 s of a result must wait.
Task 7: Ruling: scanner uses jsQR (pure JS) because iPad Safari has no BarcodeDetector — decoding itself is not testable in jsdom and is covered by the manual device check in Task 8 step 5.
Task 7: minor (deferred): DevicesPage formats times in the browser time zone, not the gym's (the web app does not expose the gym timezone yet); epoch guard against late answers after unpair has no test (not observable).
Task 7: complete (commits 600eaa3..8610c6d, tests: pnpm --filter web test →              learn more: https://vitest.dev/guide/improving-performance#test-environments)
Task 8: Ruling: desk lists reload after each stream RECONNECT (not on the first connect) — events during a gap are lost; the startup window between load and first connect is left (tiny) — cost: one extra fetch per reconnect.
Task 8: Ruling: the inside/today switch is two toggle buttons (aria-pressed), not ARIA tabs — half a tab pattern is worse than none — cost: none.
Task 8: Ruling: photo links are 5 min; Avatar falls back to initials when an image is refused instead of the desk re-fetching on a timer — cost: avatars of loaded rows may turn to initials after 5 min until the next reload.
Task 8: Ruling: PhotoCapture keeps capture="user" as the plan says (Android phones then offer only the camera) — cost: staff on Android cannot pick from the gallery.
Task 8: Ruling: CheckInResult gained `method` (kiosk|manual) so the desk can add a live check-in to the day list without refetching — cost: none.
Task 8: Ruling: reception home is the desk (nav checkIn first); owner gets it as the "checkIn" section; trainers have no desk UI yet (API ready) — cost: none.
Task 8: minor (deferred): a refused card is replaced on the big card by the next check-in (it stays in the previous list); check-in results are not announced to screen readers; DevicesPage still formats times in the browser time zone.
Task 8: Step 5 (manual check on real devices) NOT done by the agent — needs the user (kiosk on tablet/Android phone via /kiosk through the tunnel, member on iPhone).
Task 8: complete (commits 8610c6d..441a4f3, tests: pnpm -r test → apps/web test: Done)
Final: fixed desk lists never aging out (auto check-out, gym midnight) — DeskPage 'asks again every so often' RED→GREEN (reload every 60 s), suite 60/387/266 + 4 e2e.
Final: fixed trainers receiving membership prices over the live stream and in check-in results — trainer-stream and manual check-in assertions on priceCents RED→GREEN.
Final: fixed open live streams outliving a removed role — live-lifetime.e2e RED→GREEN (streams end after 15 min; the client re-tickets, which re-checks the role).
Final: minor (deferred): QR screen sticks on 'Loading' when the phone clock is >45 s fast (expiry is compared with the device clock; time it from when the answer arrived).
Final: minor (deferred): kiosk does not retry by itself when the API is unreachable at start-up (offline panel with a Retry button only).
Final: minor (deferred): visitors list and check-out are reception-only, spec §5/§6.2 would also let trainers see today's visitors and check out — no ledger decision from the owner yet.
Final: minor (deferred): live-added 'inside' rows show 'active' where a reload may show 'expiring' for a pack with ≤ 2 visits.
Final: minor (deferred): photo links are signed against S3_ENDPOINT (http://localhost:9000): a desk or phone that cannot reach it directly (cloudflared tunnel, other machine) shows initials instead of photos — needs an S3_PUBLIC_ENDPOINT or a proxy before real use.
Final: minor (deferred): members list/renewals sign a photo link for every member before the filter and the 100-row cut.
Final: minor (deferred): env.ts doc comment for COOKIE_PATH now sits above CHECKIN_SECRET.
Final: minor (deferred): migration 0013 was regenerated; any database that applied the old 0013 (only gym_test did, fixed by hand) must delete its last __drizzle_migrations row and drop check_ins and devices_id_gym_id_uq first. The dev `gym` database has none of 0011–0014 yet.
Final: Ruling: photo consent — spec §8 asks explicit consent for progress photos, §6.0 plans the optional ID photo taken by reception at the desk; no consent checkbox was added in 2b — cost: if the owner wants consent recorded for ID photos, it is a small addition.
Final: Ruling: the whole-branch reviewer's 'two devices at once give ok + duplicate' remark — the concurrency test spaces the two attempts 3 minutes apart on purpose; two real scans in the same second give one row and a repeated verdict, which is the intended duplicate rule — cost: none.
