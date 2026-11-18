CREATE TABLE "progress_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"taken_on" date NOT NULL,
	"object_key" text NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "progress_photos_object_key_chk" CHECK (char_length("progress_photos"."object_key") between 1 and 300)
);
--> statement-breakpoint
ALTER TABLE "progress_photos" ADD CONSTRAINT "progress_photos_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_photos" ADD CONSTRAINT "progress_photos_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_photos" ADD CONSTRAINT "progress_photos_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "progress_photos_object_key_uq" ON "progress_photos" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "progress_photos_gym_member_taken_idx" ON "progress_photos" USING btree ("gym_id","member_id","taken_on" DESC NULLS LAST,"created_at" DESC NULLS LAST);--> statement-breakpoint

-- Gym-owned: forced RLS on gym_id.
ALTER TABLE "progress_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "progress_photos" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "progress_photos" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint

-- gym_app: photos are immutable (no UPDATE); DELETE serves consent withdrawal and single removal.
GRANT SELECT, INSERT, DELETE ON "progress_photos" TO gym_app;