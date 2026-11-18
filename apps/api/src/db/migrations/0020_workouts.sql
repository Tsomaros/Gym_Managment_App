CREATE TABLE "workout_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"plan_id" uuid,
	"plan_day_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workout_sessions_id_gym_uq" UNIQUE("id","gym_id"),
	CONSTRAINT "workout_sessions_finished_chk" CHECK ("workout_sessions"."finished_at" is null or "workout_sessions"."finished_at" >= "workout_sessions"."started_at"),
	CONSTRAINT "workout_sessions_notes_chk" CHECK ("workout_sessions"."notes" is null or char_length("workout_sessions"."notes") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "workout_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"plan_exercise_id" uuid,
	"measure" text NOT NULL,
	"set_index" smallint NOT NULL,
	"reps" smallint,
	"weight_kg" numeric(5, 2),
	"duration_seconds" integer,
	"done" boolean NOT NULL,
	"logged_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workout_sets_session_exercise_index_uq" UNIQUE("session_id","exercise_id","set_index"),
	CONSTRAINT "workout_sets_measure_chk" CHECK ("workout_sets"."measure" in ('weight_reps', 'reps', 'duration')),
	CONSTRAINT "workout_sets_index_chk" CHECK ("workout_sets"."set_index" between 0 and 99),
	CONSTRAINT "workout_sets_reps_chk" CHECK ("workout_sets"."reps" is null or "workout_sets"."reps" between 0 and 100),
	CONSTRAINT "workout_sets_weight_chk" CHECK ("workout_sets"."weight_kg" is null or ("workout_sets"."weight_kg" between 0 and 999.75 and "workout_sets"."weight_kg" * 4 = trunc("workout_sets"."weight_kg" * 4))),
	CONSTRAINT "workout_sets_duration_chk" CHECK ("workout_sets"."duration_seconds" is null or "workout_sets"."duration_seconds" between 1 and 7200),
	CONSTRAINT "workout_sets_values_chk" CHECK (("workout_sets"."measure" = 'weight_reps' and "workout_sets"."reps" is not null and "workout_sets"."weight_kg" is not null and "workout_sets"."duration_seconds" is null)
        or ("workout_sets"."measure" = 'reps' and "workout_sets"."reps" is not null and "workout_sets"."weight_kg" is null and "workout_sets"."duration_seconds" is null)
        or ("workout_sets"."measure" = 'duration' and "workout_sets"."duration_seconds" is not null and "workout_sets"."reps" is null and "workout_sets"."weight_kg" is null)),
	CONSTRAINT "workout_sets_done_chk" CHECK (not "workout_sets"."done" or coalesce("workout_sets"."reps", 1) >= 1)
);
--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_plan_gym_fk" FOREIGN KEY ("plan_id","gym_id") REFERENCES "public"."plans"("id","gym_id") ON DELETE set null ("plan_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_plan_day_gym_fk" FOREIGN KEY ("plan_day_id","gym_id") REFERENCES "public"."plan_days"("id","gym_id") ON DELETE set null ("plan_day_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_session_gym_fk" FOREIGN KEY ("session_id","gym_id") REFERENCES "public"."workout_sessions"("id","gym_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_exercise_gym_fk" FOREIGN KEY ("exercise_id","gym_id") REFERENCES "public"."exercises"("id","gym_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_plan_exercise_gym_fk" FOREIGN KEY ("plan_exercise_id","gym_id") REFERENCES "public"."plan_exercises"("id","gym_id") ON DELETE set null ("plan_exercise_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workout_sessions_gym_member_started_idx" ON "workout_sessions" USING btree ("gym_id","member_id","started_at" DESC);--> statement-breakpoint
CREATE INDEX "workout_sessions_open_idx" ON "workout_sessions" USING btree ("gym_id","member_id") WHERE "workout_sessions"."finished_at" is null;--> statement-breakpoint
CREATE INDEX "workout_sessions_plan_day_idx" ON "workout_sessions" USING btree ("plan_day_id") WHERE "workout_sessions"."plan_day_id" is not null;--> statement-breakpoint
CREATE INDEX "workout_sets_plan_exercise_idx" ON "workout_sets" USING btree ("plan_exercise_id") WHERE "workout_sets"."plan_exercise_id" is not null;--> statement-breakpoint

-- Gym-owned: forced RLS on gym_id for both tables.
ALTER TABLE "workout_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workout_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workout_sets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workout_sets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "workout_sessions" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "workout_sets" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint

-- gym_app: sessions are history (no DELETE); identity columns (gym, member, plan links, started_at)
-- never change. Sets can be deleted (a member removes a logged set); set_index, session, exercise
-- and measure are identity (renumbering = delete + insert).
GRANT SELECT, INSERT ON "workout_sessions" TO gym_app;--> statement-breakpoint
GRANT UPDATE ("finished_at", "notes", "updated_at") ON "workout_sessions" TO gym_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "workout_sets" TO gym_app;--> statement-breakpoint
GRANT UPDATE ("reps", "weight_kg", "duration_seconds", "done", "logged_at", "plan_exercise_id", "updated_at") ON "workout_sets" TO gym_app;
