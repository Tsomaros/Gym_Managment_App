CREATE TABLE "trainer_covers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"trainer_id" uuid NOT NULL,
	"date" date NOT NULL,
	"assigned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trainer_covers_member_date_uq" UNIQUE("gym_id","member_id","date")
);
--> statement-breakpoint
ALTER TABLE "trainer_covers" ADD CONSTRAINT "trainer_covers_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_covers" ADD CONSTRAINT "trainer_covers_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_covers" ADD CONSTRAINT "trainer_covers_trainer_id_users_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainer_covers" ADD CONSTRAINT "trainer_covers_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trainer_covers_gym_trainer_date_idx" ON "trainer_covers" USING btree ("gym_id","trainer_id","date");--> statement-breakpoint

-- Gym-owned: forced RLS on gym_id. Reception assigns (insert, or replace the trainer) and removes.
ALTER TABLE "trainer_covers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trainer_covers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "trainer_covers" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "trainer_covers" TO gym_app;--> statement-breakpoint
GRANT UPDATE ("trainer_id", "assigned_by", "created_at") ON "trainer_covers" TO gym_app;
