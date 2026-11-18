CREATE TABLE "health_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text_version" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "health_consents_kind_chk" CHECK ("health_consents"."kind" in ('measurements', 'photos')),
	CONSTRAINT "health_consents_text_version_chk" CHECK (char_length("health_consents"."text_version") between 1 and 20),
	CONSTRAINT "health_consents_withdrawn_chk" CHECK ("health_consents"."withdrawn_at" is null or "health_consents"."withdrawn_at" >= "health_consents"."granted_at")
);
--> statement-breakpoint
CREATE TABLE "body_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"measured_on" date NOT NULL,
	"weight_kg" numeric(5, 2),
	"body_fat_pct" numeric(4, 1),
	"waist_cm" numeric(4, 1),
	"hips_cm" numeric(4, 1),
	"chest_cm" numeric(4, 1),
	"arm_cm" numeric(4, 1),
	"thigh_cm" numeric(4, 1),
	"notes" text,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "body_measurements_weight_chk" CHECK ("body_measurements"."weight_kg" is null or "body_measurements"."weight_kg" between 20 and 400),
	CONSTRAINT "body_measurements_body_fat_chk" CHECK ("body_measurements"."body_fat_pct" is null or "body_measurements"."body_fat_pct" between 2 and 70),
	CONSTRAINT "body_measurements_waist_chk" CHECK ("body_measurements"."waist_cm" is null or "body_measurements"."waist_cm" between 10 and 300),
	CONSTRAINT "body_measurements_hips_chk" CHECK ("body_measurements"."hips_cm" is null or "body_measurements"."hips_cm" between 10 and 300),
	CONSTRAINT "body_measurements_chest_chk" CHECK ("body_measurements"."chest_cm" is null or "body_measurements"."chest_cm" between 10 and 300),
	CONSTRAINT "body_measurements_arm_chk" CHECK ("body_measurements"."arm_cm" is null or "body_measurements"."arm_cm" between 10 and 300),
	CONSTRAINT "body_measurements_thigh_chk" CHECK ("body_measurements"."thigh_cm" is null or "body_measurements"."thigh_cm" between 10 and 300),
	CONSTRAINT "body_measurements_notes_chk" CHECK ("body_measurements"."notes" is null or char_length("body_measurements"."notes") <= 300),
	CONSTRAINT "body_measurements_any_value_chk" CHECK (num_nonnulls("body_measurements"."weight_kg", "body_measurements"."body_fat_pct", "body_measurements"."waist_cm", "body_measurements"."hips_cm", "body_measurements"."chest_cm", "body_measurements"."arm_cm", "body_measurements"."thigh_cm") >= 1)
);
--> statement-breakpoint
ALTER TABLE "health_consents" ADD CONSTRAINT "health_consents_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_consents" ADD CONSTRAINT "health_consents_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "health_consents_active_uq" ON "health_consents" USING btree ("gym_id","member_id","kind") WHERE "health_consents"."withdrawn_at" is null;--> statement-breakpoint
CREATE INDEX "health_consents_gym_member_idx" ON "health_consents" USING btree ("gym_id","member_id");--> statement-breakpoint
CREATE INDEX "body_measurements_gym_member_measured_idx" ON "body_measurements" USING btree ("gym_id","member_id","measured_on" DESC NULLS LAST);--> statement-breakpoint

-- Gym-owned: forced RLS on gym_id for both tables.
ALTER TABLE "health_consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "health_consents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "body_measurements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "body_measurements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "health_consents" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "body_measurements" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint

-- gym_app: a consent is evidence, so no DELETE; only withdrawn_at can change. Measurements are
-- immutable (no UPDATE: correct = delete + re-record); DELETE serves withdrawal and trainer removal.
GRANT SELECT, INSERT ON "health_consents" TO gym_app;--> statement-breakpoint
GRANT UPDATE ("withdrawn_at") ON "health_consents" TO gym_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "body_measurements" TO gym_app;
