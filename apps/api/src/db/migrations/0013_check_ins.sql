ALTER TABLE "devices" ADD CONSTRAINT "devices_id_gym_id_uq" UNIQUE("id","gym_id");--> statement-breakpoint
CREATE TABLE "check_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"method" text NOT NULL,
	"device_id" uuid,
	"by_user_id" uuid,
	"valid" boolean NOT NULL,
	"reason" text,
	"membership_id" uuid,
	"visit_consumed" boolean DEFAULT false NOT NULL,
	"checked_out_at" timestamp with time zone,
	"checked_out_by" uuid,
	CONSTRAINT "check_ins_method_valid" CHECK ("check_ins"."method" in ('kiosk', 'manual')),
	CONSTRAINT "check_ins_reason_matches_valid" CHECK ("check_ins"."valid" = ("check_ins"."reason" is null)),
	CONSTRAINT "check_ins_visit_consumed_valid" CHECK (not "check_ins"."visit_consumed" or ("check_ins"."valid" and "check_ins"."membership_id" is not null)),
	CONSTRAINT "check_ins_kiosk_has_device" CHECK ("check_ins"."method" <> 'kiosk' or "check_ins"."device_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_checked_out_by_users_id_fk" FOREIGN KEY ("checked_out_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_device_same_gym_fk" FOREIGN KEY ("device_id","gym_id") REFERENCES "public"."devices"("id","gym_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_membership_same_gym_fk" FOREIGN KEY ("membership_id","gym_id") REFERENCES "public"."memberships"("id","gym_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "check_ins_gym_id_at_idx" ON "check_ins" USING btree ("gym_id","at");--> statement-breakpoint
CREATE INDEX "check_ins_gym_id_member_id_at_idx" ON "check_ins" USING btree ("gym_id","member_id","at");--> statement-breakpoint

-- check_ins is gym-owned: forced RLS on gym_id. Check-ins are recorded through withGym (the
-- kiosk's gym comes from its device); the only update is the check-out.
ALTER TABLE "check_ins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "check_ins" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "check_ins" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT ON "check_ins" TO gym_app;--> statement-breakpoint
GRANT UPDATE ("checked_out_at", "checked_out_by") ON "check_ins" TO gym_app;
