CREATE TABLE "membership_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_en" text,
	"kind" text NOT NULL,
	"duration_months" integer,
	"visit_count" integer,
	"validity_days" integer,
	"price_cents" integer NOT NULL,
	"max_freeze_days" integer DEFAULT 0 NOT NULL,
	"includes_trainer" boolean DEFAULT false NOT NULL,
	"includes_classes" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_types_kind_valid" CHECK ("membership_types"."kind" in ('time', 'visits', 'day_pass', 'classes')),
	CONSTRAINT "membership_types_price_valid" CHECK ("membership_types"."price_cents" >= 0),
	CONSTRAINT "membership_types_freeze_valid" CHECK ("membership_types"."max_freeze_days" between 0 and 365),
	CONSTRAINT "membership_types_time_rules" CHECK ("membership_types"."kind" <> 'time' or ("membership_types"."duration_months" between 1 and 36 and "membership_types"."visit_count" is null and "membership_types"."validity_days" is null)),
	CONSTRAINT "membership_types_pack_rules" CHECK ("membership_types"."kind" not in ('visits', 'classes') or ("membership_types"."visit_count" between 1 and 500 and ("membership_types"."validity_days" is null or "membership_types"."validity_days" between 1 and 730) and "membership_types"."duration_months" is null and "membership_types"."max_freeze_days" = 0)),
	CONSTRAINT "membership_types_day_pass_rules" CHECK ("membership_types"."kind" <> 'day_pass' or ("membership_types"."duration_months" is null and "membership_types"."visit_count" is null and "membership_types"."validity_days" is null and "membership_types"."max_freeze_days" = 0)),
	CONSTRAINT "membership_types_classes_rules" CHECK ("membership_types"."kind" <> 'classes' or "membership_types"."includes_classes")
);
--> statement-breakpoint
ALTER TABLE "membership_types" ADD CONSTRAINT "membership_types_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "membership_types_gym_id_idx" ON "membership_types" USING btree ("gym_id");--> statement-breakpoint

-- Gym-owned: forced RLS on gym_id. Owners write through gym_app; no one deletes (archive instead).
ALTER TABLE "membership_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "membership_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "membership_types" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "membership_types" TO gym_app;
