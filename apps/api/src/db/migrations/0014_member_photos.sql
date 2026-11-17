CREATE TABLE "member_photos" (
	"gym_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "member_photos_gym_id_member_id_pk" PRIMARY KEY("gym_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "member_photos" ADD CONSTRAINT "member_photos_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_photos" ADD CONSTRAINT "member_photos_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_photos" ADD CONSTRAINT "member_photos_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Gym-owned: forced RLS on gym_id. Reception adds, replaces (object_key, updated_*) and removes.
ALTER TABLE "member_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_photos" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "member_photos" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "member_photos" TO gym_app;--> statement-breakpoint
GRANT UPDATE ("object_key", "updated_at", "updated_by") ON "member_photos" TO gym_app;