CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"includes_trainer" boolean DEFAULT false NOT NULL,
	"includes_classes" boolean DEFAULT false NOT NULL,
	"max_freeze_days" integer DEFAULT 0 NOT NULL,
	"price_cents" integer NOT NULL,
	"starts_on" date NOT NULL,
	"base_ends_on" date,
	"ends_on" date,
	"visits_total" integer,
	"visits_used" integer DEFAULT 0 NOT NULL,
	"voided_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_id_gym_id_uq" UNIQUE("id","gym_id"),
	CONSTRAINT "memberships_kind_valid" CHECK ("memberships"."kind" in ('time', 'visits', 'day_pass', 'classes')),
	CONSTRAINT "memberships_price_valid" CHECK ("memberships"."price_cents" >= 0),
	CONSTRAINT "memberships_kind_rules" CHECK (("memberships"."kind" <> 'time' or "memberships"."base_ends_on" is not null) and ("memberships"."kind" = 'time' or "memberships"."visits_total" is not null)),
	CONSTRAINT "memberships_visits_valid" CHECK ("memberships"."visits_used" >= 0 and ("memberships"."visits_total" is null or "memberships"."visits_used" <= "memberships"."visits_total")),
	CONSTRAINT "memberships_dates_valid" CHECK (("memberships"."base_ends_on" is null or "memberships"."base_ends_on" >= "memberships"."starts_on") and ("memberships"."ends_on" is null) = ("memberships"."base_ends_on" is null) and ("memberships"."ends_on" is null or "memberships"."ends_on" >= "memberships"."base_ends_on"))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"method" text NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" uuid,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	CONSTRAINT "payments_amount_valid" CHECK ("payments"."amount_cents" >= 0),
	CONSTRAINT "payments_method_valid" CHECK ("payments"."method" in ('cash', 'card')),
	CONSTRAINT "payments_void_reason" CHECK (("payments"."voided_at" is null) = ("payments"."void_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "membership_types" ADD CONSTRAINT "membership_types_id_gym_id_uq" UNIQUE("id","gym_id");--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_type_same_gym_fk" FOREIGN KEY ("type_id","gym_id") REFERENCES "public"."membership_types"("id","gym_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_membership_same_gym_fk" FOREIGN KEY ("membership_id","gym_id") REFERENCES "public"."memberships"("id","gym_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_gym_member_idx" ON "memberships" USING btree ("gym_id","member_id");--> statement-breakpoint
CREATE INDEX "payments_gym_member_paid_at_idx" ON "payments" USING btree ("gym_id","member_id","paid_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payments_gym_paid_at_idx" ON "payments" USING btree ("gym_id","paid_at");--> statement-breakpoint
CREATE INDEX "payments_membership_id_idx" ON "payments" USING btree ("membership_id");--> statement-breakpoint

-- Both tables are gym-owned: forced RLS on gym_id.
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "memberships" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "payments" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint

-- gym_app: memberships change only by freezes (ends_on), visits (visits_used) and voiding;
-- payments only by voiding. Nothing is deleted.
GRANT SELECT, INSERT ON "memberships", "payments" TO gym_app;--> statement-breakpoint
GRANT UPDATE ("ends_on", "visits_used", "voided_at") ON "memberships" TO gym_app;--> statement-breakpoint
GRANT UPDATE ("voided_at", "voided_by", "void_reason") ON "payments" TO gym_app;
;--> statement-breakpoint

-- Voiding is final: the column grants let gym_app set voided_at, so a trigger stops clearing it.
CREATE FUNCTION "forbid_unvoid"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.voided_at IS NOT NULL AND NEW.voided_at IS DISTINCT FROM OLD.voided_at THEN
    RAISE EXCEPTION '% % cannot be un-voided', TG_TABLE_NAME, OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "memberships_forbid_unvoid" BEFORE UPDATE OF "voided_at" ON "memberships"
  FOR EACH ROW EXECUTE FUNCTION "forbid_unvoid"();--> statement-breakpoint
CREATE TRIGGER "payments_forbid_unvoid" BEFORE UPDATE OF "voided_at" ON "payments"
  FOR EACH ROW EXECUTE FUNCTION "forbid_unvoid"();
