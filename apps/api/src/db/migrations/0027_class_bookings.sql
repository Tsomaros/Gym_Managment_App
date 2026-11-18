CREATE TABLE "class_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"membership_id" uuid,
	"status" text DEFAULT 'booked' NOT NULL,
	"entry_consumed" boolean DEFAULT false NOT NULL,
	"booked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"attended_at" timestamp with time zone,
	"marked_by" uuid,
	"booked_by" uuid NOT NULL,
	CONSTRAINT "class_bookings_status_valid" CHECK ("class_bookings"."status" in ('booked', 'attended', 'no_show', 'cancelled', 'late_cancelled'))
);
--> statement-breakpoint
ALTER TABLE "class_bookings" ADD CONSTRAINT "class_bookings_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_bookings" ADD CONSTRAINT "class_bookings_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_bookings" ADD CONSTRAINT "class_bookings_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_bookings" ADD CONSTRAINT "class_bookings_booked_by_users_id_fk" FOREIGN KEY ("booked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_bookings" ADD CONSTRAINT "class_bookings_session_same_gym_fk" FOREIGN KEY ("session_id","gym_id") REFERENCES "public"."class_sessions"("id","gym_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_bookings" ADD CONSTRAINT "class_bookings_membership_same_gym_fk" FOREIGN KEY ("membership_id","gym_id") REFERENCES "public"."memberships"("id","gym_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "class_bookings_session_member_live_uq" ON "class_bookings" USING btree ("session_id","member_id") WHERE "class_bookings"."status" in ('booked', 'attended');--> statement-breakpoint
CREATE INDEX "class_bookings_gym_member_status_idx" ON "class_bookings" USING btree ("gym_id","member_id","status");--> statement-breakpoint
CREATE INDEX "class_bookings_session_idx" ON "class_bookings" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "class_bookings_membership_idx" ON "class_bookings" USING btree ("membership_id");--> statement-breakpoint

-- Gym-owned: forced RLS on gym_id.
ALTER TABLE "class_bookings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "class_bookings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "class_bookings" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint
-- Bookings are never deleted: they change status. Who and what they belong to never changes.
GRANT SELECT, INSERT ON "class_bookings" TO gym_app;--> statement-breakpoint
GRANT UPDATE ("status", "entry_consumed", "cancelled_at", "attended_at", "marked_by") ON "class_bookings" TO gym_app;
