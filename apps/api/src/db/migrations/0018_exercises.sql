CREATE TABLE "exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"name_el" text NOT NULL,
	"name_en" text,
	"muscle_group" text NOT NULL,
	"measure" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exercises_gym_name_el_uq" ON "exercises" USING btree ("gym_id",lower("name_el"));--> statement-breakpoint

ALTER TABLE "exercises" ADD CONSTRAINT "exercises_muscle_group_chk" CHECK ("muscle_group" IN ('chest','back','shoulders','biceps','triceps','legs','glutes','core','cardio','full_body'));--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_measure_chk" CHECK ("measure" IN ('weight_reps','reps','duration'));--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_name_el_chk" CHECK (length(btrim("name_el")) > 0);--> statement-breakpoint

-- Gym-owned: forced RLS on gym_id. Archive-only: no DELETE, and identity columns can't change.
ALTER TABLE "exercises" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "exercises" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "exercises" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT ON "exercises" TO gym_app;--> statement-breakpoint
GRANT UPDATE ("name_el", "name_en", "muscle_group", "measure", "archived_at") ON "exercises" TO gym_app;
-- gym_system (seeding a new gym) gets DML through default privileges.
