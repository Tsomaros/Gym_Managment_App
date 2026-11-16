-- gym_system (created in docker/postgres/init.sql: LOGIN, BYPASSRLS, not superuser, owns nothing)
-- is the systemDb login: DML on every table, no DDL. Default privileges cover tables that later
-- migrations (run as gym_owner) create, so no migration has to remember to grant them.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gym_system;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gym_system;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE gym_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gym_system;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE gym_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO gym_system;--> statement-breakpoint

-- users becomes read-only for gym_app, and only for people who hold a role in the current gym.
-- Every write to users goes through systemDb. Revoking the table privilege also drops the column
-- grants from 0001 (full_name, password_hash, email, locale).
REVOKE INSERT, UPDATE ON "users" FROM gym_app;--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- The subquery runs under gym_roles' own policy too; its primary key (gym_id, user_id, role)
-- serves the lookup. No policy for other roles: anyone without BYPASSRLS sees no users.
CREATE POLICY "users_in_current_gym" ON "users" FOR SELECT TO gym_app
  USING ("id" IN (
    SELECT "user_id" FROM "gym_roles"
    WHERE "gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid
  ));
