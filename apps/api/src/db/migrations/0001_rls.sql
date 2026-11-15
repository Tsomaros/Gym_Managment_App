-- Per-gym isolation and gym_app privileges. Runs as gym_owner after 0000_init.sql.
-- The API connects as gym_app (no BYPASSRLS) and sets app.gym_id per transaction (see db/tenant.ts).
-- nullif(..., '') because a transaction-local set_config leaves '' (not NULL) on a pooled
-- connection afterwards; '' must mean "no gym" (zero rows), not a uuid cast error.
-- FORCE also subjects the table owner to the policies; gym_owner skips them only through BYPASSRLS.

ALTER TABLE "gyms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gyms" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "gyms" FOR ALL
  USING ("id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "gym_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gym_roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "gym_roles" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "invitations" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint

-- Gyms are created and deleted only by the platform admin through systemDb (gym_owner).
GRANT SELECT ON "gyms" TO gym_app;--> statement-breakpoint
GRANT UPDATE ("name", "timezone") ON "gyms" TO gym_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "gym_roles", "invitations" TO gym_app;--> statement-breakpoint

-- Global tables, reached only through the auth and invitation services.
-- Accounts are erased (GDPR) through systemDb, so gym_app gets no DELETE on users.
GRANT SELECT, INSERT ON "users" TO gym_app;--> statement-breakpoint
GRANT UPDATE ("email", "password_hash", "full_name", "locale") ON "users" TO gym_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "refresh_tokens" TO gym_app;--> statement-breakpoint

-- INSERT needs every column (Drizzle sends DEFAULT for omitted ones), so a column grant can't keep
-- gym_app away from is_platform_admin on insert; this trigger does. UPDATE is covered by the column grant.
CREATE FUNCTION "forbid_platform_admin_by_gym_app"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.is_platform_admin AND current_user = 'gym_app' THEN
    RAISE EXCEPTION 'is_platform_admin cannot be set by gym_app' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "users_forbid_platform_admin_by_gym_app"
  BEFORE INSERT OR UPDATE OF "is_platform_admin" ON "users"
  FOR EACH ROW EXECUTE FUNCTION "forbid_platform_admin_by_gym_app"();
