CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"gym_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_gym_id_id_idx" ON "audit_log" USING btree ("gym_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_gym_entity_idx" ON "audit_log" USING btree ("gym_id","entity","entity_id","id" DESC NULLS LAST);--> statement-breakpoint

-- Gym-owned, append-only: forced RLS on gym_id; gym_app may read and insert, never edit or delete.
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "audit_log" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT ON "audit_log" TO gym_app;--> statement-breakpoint
GRANT USAGE ON SEQUENCE "audit_log_id_seq" TO gym_app;--> statement-breakpoint
-- gym_system writes entries on systemDb paths (sign-up, invitation accept) and keeps DELETE for
-- account and gym erasure, but no one edits an entry.
REVOKE UPDATE ON "audit_log" FROM gym_system;
