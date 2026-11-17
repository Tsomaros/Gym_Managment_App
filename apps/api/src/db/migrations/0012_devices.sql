CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "devices_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "device_pairing_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_pairing_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_pairing_codes" ADD CONSTRAINT "device_pairing_codes_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_pairing_codes" ADD CONSTRAINT "device_pairing_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devices_gym_id_idx" ON "devices" USING btree ("gym_id");--> statement-breakpoint
CREATE INDEX "device_pairing_codes_gym_id_idx" ON "device_pairing_codes" USING btree ("gym_id");--> statement-breakpoint

-- Both tables are gym-owned: forced RLS on gym_id.
ALTER TABLE "devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "devices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "devices" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "device_pairing_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "device_pairing_codes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "device_pairing_codes" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint
-- A tablet pairs before any gym context exists, so devices are created, claimed and touched
-- (last_seen_at) through systemDb. The owner (gym_app) lists devices, revokes them and issues codes.
GRANT SELECT, UPDATE ("revoked_at") ON "devices" TO gym_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "device_pairing_codes" TO gym_app;