-- Renewals follow their predecessor (shiftFollowers): reception may move the start of a
-- not-yet-started membership and of a freeze booked on it.
GRANT UPDATE ("starts_on", "base_ends_on") ON "memberships" TO gym_app;--> statement-breakpoint
GRANT UPDATE ("starts_on") ON "membership_freezes" TO gym_app;
