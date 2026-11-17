-- Target of plan_exercises' composite foreign key: a plan exercise can only use its own gym's exercise.
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_id_gym_uq" UNIQUE("id","gym_id");--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"member_id" uuid,
	"author_id" uuid,
	"is_template" boolean DEFAULT false NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"status" text NOT NULL,
	"pdf_object_key" text,
	"activated_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_id_gym_uq" UNIQUE("id","gym_id"),
	CONSTRAINT "plans_title_chk" CHECK (char_length("plans"."title") between 1 and 80),
	CONSTRAINT "plans_notes_chk" CHECK ("plans"."notes" is null or char_length("plans"."notes") <= 1000),
	CONSTRAINT "plans_pdf_key_nonempty_chk" CHECK ("plans"."pdf_object_key" is null or "plans"."pdf_object_key" <> ''),
	CONSTRAINT "plans_status_ts_chk" CHECK (("plans"."status" = 'archived') = ("plans"."archived_at" is not null) and ("plans"."status" <> 'active' or "plans"."activated_at" is not null)),
	CONSTRAINT "plans_kind_chk" CHECK ("plans"."kind" in ('interactive', 'pdf')),
	CONSTRAINT "plans_status_chk" CHECK ("plans"."status" in ('draft', 'active', 'archived')),
	CONSTRAINT "plans_template_chk" CHECK ("plans"."is_template" = ("plans"."member_id" is null)),
	CONSTRAINT "plans_template_kind_chk" CHECK (not "plans"."is_template" or "plans"."kind" = 'interactive'),
	CONSTRAINT "plans_template_status_chk" CHECK (not "plans"."is_template" or "plans"."status" = 'draft'),
	CONSTRAINT "plans_pdf_key_chk" CHECK (("plans"."kind" = 'pdf') = ("plans"."pdf_object_key" is not null))
);
--> statement-breakpoint
CREATE TABLE "plan_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"title" text NOT NULL,
	CONSTRAINT "plan_days_id_gym_uq" UNIQUE("id","gym_id"),
	CONSTRAINT "plan_days_title_chk" CHECK (char_length("plan_days"."title") between 1 and 80),
	CONSTRAINT "plan_days_position_chk" CHECK ("plan_days"."position" between 0 and 13),
	CONSTRAINT "plan_days_plan_position_uq" UNIQUE("plan_id","position") DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TABLE "plan_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"plan_day_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"sets" smallint NOT NULL,
	"reps_min" smallint,
	"reps_max" smallint,
	"to_failure" boolean DEFAULT false NOT NULL,
	"weight_kg" numeric(5, 2),
	"rest_seconds" integer,
	"duration_seconds" integer,
	"notes" text,
	CONSTRAINT "plan_exercises_id_gym_uq" UNIQUE("id","gym_id"),
	CONSTRAINT "plan_exercises_position_chk" CHECK ("plan_exercises"."position" between 0 and 29),
	CONSTRAINT "plan_exercises_day_position_uq" UNIQUE("plan_day_id","position") DEFERRABLE INITIALLY DEFERRED,
	CONSTRAINT "plan_exercises_sets_chk" CHECK ("plan_exercises"."sets" between 1 and 20),
	CONSTRAINT "plan_exercises_reps_chk" CHECK (("reps_min" is null and "reps_max" is null) or (not "to_failure" and "reps_min" is not null and "reps_max" is not null and "reps_min" between 1 and 100 and "reps_max" between 1 and 100 and "reps_min" <= "reps_max")),
	CONSTRAINT "plan_exercises_weight_chk" CHECK ("plan_exercises"."weight_kg" is null or ("plan_exercises"."weight_kg" between 0 and 999.75 and "plan_exercises"."weight_kg" * 4 = trunc("plan_exercises"."weight_kg" * 4))),
	CONSTRAINT "plan_exercises_rest_chk" CHECK ("plan_exercises"."rest_seconds" is null or "plan_exercises"."rest_seconds" between 0 and 900),
	CONSTRAINT "plan_exercises_duration_chk" CHECK ("plan_exercises"."duration_seconds" is null or "plan_exercises"."duration_seconds" between 1 and 7200),
	CONSTRAINT "plan_exercises_notes_chk" CHECK ("plan_exercises"."notes" is null or char_length("plan_exercises"."notes") <= 300)
);
--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_days" ADD CONSTRAINT "plan_days_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_days" ADD CONSTRAINT "plan_days_plan_gym_fk" FOREIGN KEY ("plan_id","gym_id") REFERENCES "public"."plans"("id","gym_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_exercises" ADD CONSTRAINT "plan_exercises_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_exercises" ADD CONSTRAINT "plan_exercises_day_gym_fk" FOREIGN KEY ("plan_day_id","gym_id") REFERENCES "public"."plan_days"("id","gym_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_exercises" ADD CONSTRAINT "plan_exercises_exercise_gym_fk" FOREIGN KEY ("exercise_id","gym_id") REFERENCES "public"."exercises"("id","gym_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plans_one_active_per_member_uq" ON "plans" USING btree ("gym_id","member_id") WHERE "plans"."status" = 'active' and "plans"."member_id" is not null;--> statement-breakpoint
CREATE INDEX "plan_exercises_gym_exercise_idx" ON "plan_exercises" USING btree ("gym_id","exercise_id");--> statement-breakpoint
CREATE INDEX "plans_gym_member_idx" ON "plans" USING btree ("gym_id","member_id");--> statement-breakpoint
CREATE INDEX "plans_gym_template_idx" ON "plans" USING btree ("gym_id") WHERE "plans"."is_template";--> statement-breakpoint

-- Gym-owned: forced RLS on gym_id for all three tables.
ALTER TABLE "plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plan_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plan_days" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plan_exercises" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plan_exercises" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "plans" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "plan_days" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "plan_exercises" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint
-- A member's plans are history (phase 4b logs point at them): only templates can be deleted.
CREATE POLICY "templates_only_delete" ON "plans" AS RESTRICTIVE FOR DELETE
  USING ("is_template");--> statement-breakpoint

-- gym_app: identity columns (gym, member, kind, template flag, author) never change.
GRANT SELECT, INSERT, DELETE ON "plans" TO gym_app;--> statement-breakpoint
GRANT UPDATE ("title", "notes", "status", "pdf_object_key", "activated_at", "archived_at", "updated_at") ON "plans" TO gym_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "plan_days" TO gym_app;--> statement-breakpoint
GRANT UPDATE ("position", "title") ON "plan_days" TO gym_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "plan_exercises" TO gym_app;--> statement-breakpoint
GRANT UPDATE ("plan_day_id", "exercise_id", "position", "sets", "reps_min", "reps_max", "to_failure", "weight_kg", "rest_seconds", "duration_seconds", "notes") ON "plan_exercises" TO gym_app;