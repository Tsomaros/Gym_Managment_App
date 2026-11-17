CREATE TABLE "shift_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"starts_at" time NOT NULL,
	"ends_at" time NOT NULL,
	"valid_from" date NOT NULL,
	"valid_until" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_series_id_gym_staff_uq" UNIQUE("id","gym_id","staff_id"),
	CONSTRAINT "shift_series_weekday_valid" CHECK ("shift_series"."weekday" between 1 and 7),
	CONSTRAINT "shift_series_times_valid" CHECK ("shift_series"."ends_at" > "shift_series"."starts_at"),
	CONSTRAINT "shift_series_dates_valid" CHECK ("shift_series"."valid_until" is null or "shift_series"."valid_until" >= "shift_series"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"date" date NOT NULL,
	"starts_at" time NOT NULL,
	"ends_at" time NOT NULL,
	"series_id" uuid,
	"cancelled" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shifts_series_date_uq" UNIQUE("series_id","date"),
	CONSTRAINT "shifts_times_valid" CHECK ("shifts"."ends_at" > "shifts"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "gyms" ADD COLUMN "reception_can_edit_shifts" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shift_series" ADD CONSTRAINT "shift_series_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_series" ADD CONSTRAINT "shift_series_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_series" ADD CONSTRAINT "shift_series_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_series_same_gym_staff_fk" FOREIGN KEY ("series_id","gym_id","staff_id") REFERENCES "public"."shift_series"("id","gym_id","staff_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shift_series_gym_staff_idx" ON "shift_series" USING btree ("gym_id","staff_id");--> statement-breakpoint
CREATE INDEX "shifts_gym_staff_date_idx" ON "shifts" USING btree ("gym_id","staff_id","date");--> statement-breakpoint
CREATE INDEX "shifts_gym_date_idx" ON "shifts" USING btree ("gym_id","date");--> statement-breakpoint

-- Both tables are gym-owned: forced RLS on gym_id.
ALTER TABLE "shift_series" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shift_series" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "shift_series" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "shifts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shifts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "shifts" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint
-- A series can only be ended (valid_until) or deleted before it starts; changing its pattern is
-- "end it and start a new one", so past dates never change.
GRANT SELECT, INSERT, DELETE ON "shift_series" TO gym_app;--> statement-breakpoint
GRANT UPDATE ("valid_until") ON "shift_series" TO gym_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "shifts" TO gym_app;--> statement-breakpoint
GRANT UPDATE ("starts_at", "ends_at", "cancelled", "note") ON "shifts" TO gym_app;--> statement-breakpoint
GRANT UPDATE ("reception_can_edit_shifts") ON "gyms" TO gym_app;
