CREATE TABLE "member_trainers" (
	"gym_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"trainer_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" uuid,
	CONSTRAINT "member_trainers_gym_id_member_id_pk" PRIMARY KEY("gym_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "member_trainers" ADD CONSTRAINT "member_trainers_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_trainers" ADD CONSTRAINT "member_trainers_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_trainers" ADD CONSTRAINT "member_trainers_trainer_id_users_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_trainers" ADD CONSTRAINT "member_trainers_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_trainers_gym_trainer_idx" ON "member_trainers" USING btree ("gym_id","trainer_id");--> statement-breakpoint

-- Gym-owned: forced RLS on gym_id. Reception assigns (insert, or replace the trainer) and removes.
ALTER TABLE "member_trainers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_trainers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "member_trainers" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "member_trainers" TO gym_app;--> statement-breakpoint
GRANT UPDATE ("trainer_id", "assigned_at", "assigned_by") ON "member_trainers" TO gym_app;
