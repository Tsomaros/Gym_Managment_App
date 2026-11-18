CREATE TABLE "class_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_en" text,
	"description" text,
	"default_capacity" integer NOT NULL,
	"default_duration_minutes" integer NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_types_id_gym_uq" UNIQUE("id","gym_id"),
	CONSTRAINT "class_types_capacity_valid" CHECK ("class_types"."default_capacity" between 1 and 200),
	CONSTRAINT "class_types_duration_valid" CHECK ("class_types"."default_duration_minutes" between 15 and 240),
	CONSTRAINT "class_types_description_len" CHECK (char_length("class_types"."description") <= 500)
);
--> statement-breakpoint
CREATE TABLE "class_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"class_type_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"starts_at" time NOT NULL,
	"duration_minutes" integer NOT NULL,
	"capacity" integer NOT NULL,
	"trainer_id" uuid,
	"room" text,
	"valid_from" date NOT NULL,
	"valid_until" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_series_id_gym_uq" UNIQUE("id","gym_id"),
	CONSTRAINT "class_series_weekday_valid" CHECK ("class_series"."weekday" between 1 and 7),
	CONSTRAINT "class_series_duration_valid" CHECK ("class_series"."duration_minutes" between 15 and 240),
	CONSTRAINT "class_series_ends_before_midnight" CHECK (extract(epoch from "class_series"."starts_at") / 60 + "class_series"."duration_minutes" < 1440),
	CONSTRAINT "class_series_capacity_valid" CHECK ("class_series"."capacity" between 1 and 200),
	CONSTRAINT "class_series_room_len" CHECK (char_length("class_series"."room") <= 40),
	CONSTRAINT "class_series_dates_valid" CHECK ("class_series"."valid_until" is null or "class_series"."valid_until" >= "class_series"."valid_from" - 1)
);
--> statement-breakpoint
CREATE TABLE "class_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"class_type_id" uuid NOT NULL,
	"series_id" uuid,
	"date" date NOT NULL,
	"starts_at" time NOT NULL,
	"ends_at" time NOT NULL,
	"starts_at_utc" timestamp with time zone NOT NULL,
	"ends_at_utc" timestamp with time zone NOT NULL,
	"capacity" integer NOT NULL,
	"trainer_id" uuid,
	"room" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_sessions_id_gym_uq" UNIQUE("id","gym_id"),
	CONSTRAINT "class_sessions_series_date_uq" UNIQUE("series_id","date"),
	CONSTRAINT "class_sessions_times_valid" CHECK ("class_sessions"."ends_at" > "class_sessions"."starts_at"),
	CONSTRAINT "class_sessions_utc_valid" CHECK ("class_sessions"."ends_at_utc" > "class_sessions"."starts_at_utc"),
	CONSTRAINT "class_sessions_capacity_valid" CHECK ("class_sessions"."capacity" between 1 and 200),
	CONSTRAINT "class_sessions_room_len" CHECK (char_length("class_sessions"."room") <= 40)
);
--> statement-breakpoint
ALTER TABLE "gyms" ADD COLUMN "class_cancel_cutoff_minutes" integer DEFAULT 120 NOT NULL;--> statement-breakpoint
ALTER TABLE "class_types" ADD CONSTRAINT "class_types_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_series" ADD CONSTRAINT "class_series_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_series" ADD CONSTRAINT "class_series_trainer_id_users_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_series" ADD CONSTRAINT "class_series_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_series" ADD CONSTRAINT "class_series_type_same_gym_fk" FOREIGN KEY ("class_type_id","gym_id") REFERENCES "public"."class_types"("id","gym_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_trainer_id_users_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_type_same_gym_fk" FOREIGN KEY ("class_type_id","gym_id") REFERENCES "public"."class_types"("id","gym_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_series_same_gym_fk" FOREIGN KEY ("series_id","gym_id") REFERENCES "public"."class_series"("id","gym_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_series_gym_idx" ON "class_series" USING btree ("gym_id","valid_until");--> statement-breakpoint
CREATE INDEX "class_sessions_gym_date_idx" ON "class_sessions" USING btree ("gym_id","date");--> statement-breakpoint
CREATE INDEX "class_sessions_gym_starts_idx" ON "class_sessions" USING btree ("gym_id","starts_at_utc");--> statement-breakpoint
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_class_cutoff_valid" CHECK ("gyms"."class_cancel_cutoff_minutes" between 0 and 1440);--> statement-breakpoint
-- The three class tables are gym-owned: forced RLS on gym_id.
ALTER TABLE "class_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "class_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "class_types" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "class_series" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "class_series" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "class_series" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "class_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "class_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "class_sessions" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint
-- Types are archived, never deleted. A series is only ended (valid_until), reassigned (trainer_id)
-- or deleted before it starts; changing its pattern is "end it and start a new one".
GRANT SELECT, INSERT ON "class_types" TO gym_app;--> statement-breakpoint
GRANT UPDATE ("name", "name_en", "description", "default_capacity", "default_duration_minutes", "archived_at") ON "class_types" TO gym_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "class_series" TO gym_app;--> statement-breakpoint
GRANT UPDATE ("valid_until", "trainer_id") ON "class_series" TO gym_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "class_sessions" TO gym_app;--> statement-breakpoint
GRANT UPDATE ("cancelled_at", "cancel_reason", "trainer_id") ON "class_sessions" TO gym_app;--> statement-breakpoint
GRANT UPDATE ("class_cancel_cutoff_minutes") ON "gyms" TO gym_app;
