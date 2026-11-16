-- First/last name, phone, date of birth, emergency contact and email confirmation on users;
-- first/last name on invitations. Existing names are split at the first space (rest → last name).
ALTER TABLE "users" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "emergency_contact_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "emergency_contact_phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
-- Existing accounts all came through emailed links (invitations) or the seeded admin: verified.
UPDATE "users" SET
  "first_name" = coalesce(substring(btrim("full_name") from '^\S+'), ''),
  "last_name" = coalesce(substring(btrim("full_name") from '^\S+\s+(.*)$'), ''),
  "email_verified_at" = "created_at";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "first_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "last_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "full_name";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "full_name" text
  GENERATED ALWAYS AS (btrim("first_name" || ' ' || "last_name")) STORED NOT NULL;--> statement-breakpoint

-- gym_app reads users column by column: never password_hash or is_platform_admin.
-- A new users column is invisible to gym_app until a migration grants it here.
REVOKE SELECT ON "users" FROM gym_app;--> statement-breakpoint
GRANT SELECT ("id", "email", "first_name", "last_name", "full_name", "phone", "date_of_birth",
  "emergency_contact_name", "emergency_contact_phone", "email_verified_at", "locale", "created_at")
  ON "users" TO gym_app;--> statement-breakpoint

ALTER TABLE "invitations" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "last_name" text;--> statement-breakpoint
UPDATE "invitations" SET
  "first_name" = coalesce(substring(btrim("full_name") from '^\S+'), ''),
  "last_name" = coalesce(substring(btrim("full_name") from '^\S+\s+(.*)$'), '');--> statement-breakpoint
ALTER TABLE "invitations" ALTER COLUMN "first_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ALTER COLUMN "last_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" DROP COLUMN "full_name";
