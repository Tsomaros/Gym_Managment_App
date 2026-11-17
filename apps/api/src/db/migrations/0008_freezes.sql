CREATE TABLE "membership_freezes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_early_at" timestamp with time zone,
	CONSTRAINT "membership_freezes_dates_valid" CHECK ("membership_freezes"."ends_on" >= "membership_freezes"."starts_on")
);
--> statement-breakpoint
ALTER TABLE "membership_freezes" ADD CONSTRAINT "membership_freezes_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_freezes" ADD CONSTRAINT "membership_freezes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_freezes" ADD CONSTRAINT "membership_freezes_membership_same_gym_fk" FOREIGN KEY ("membership_id","gym_id") REFERENCES "public"."memberships"("id","gym_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "membership_freezes_membership_id_idx" ON "membership_freezes" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "membership_freezes_gym_id_idx" ON "membership_freezes" USING btree ("gym_id");--> statement-breakpoint

-- Gym-owned: forced RLS on gym_id. Reception creates freezes, shortens a running one (ends_on,
-- ended_early_at) and deletes one that hasn't started yet.
ALTER TABLE "membership_freezes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "membership_freezes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "membership_freezes" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "membership_freezes" TO gym_app;--> statement-breakpoint
GRANT UPDATE ("ends_on", "ended_early_at") ON "membership_freezes" TO gym_app;
