CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "notification_prefs" (
	"gym_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"group" text NOT NULL,
	"email" boolean DEFAULT true NOT NULL,
	"push" boolean DEFAULT true NOT NULL,
	CONSTRAINT "notification_prefs_gym_id_user_id_group_pk" PRIMARY KEY("gym_id","user_id","group"),
	CONSTRAINT "notification_prefs_group_chk" CHECK ("notification_prefs"."group" in ('membership', 'plans'))
);
--> statement-breakpoint
CREATE TABLE "notifications_sent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"channels" text[] NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_sent_gym_key_uq" UNIQUE("gym_id","dedupe_key"),
	CONSTRAINT "notifications_sent_channels_chk" CHECK (cardinality("notifications_sent"."channels") between 1 and 2),
	CONSTRAINT "notifications_sent_key_chk" CHECK (char_length("notifications_sent"."dedupe_key") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications_sent" ADD CONSTRAINT "notifications_sent_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications_sent" ADD CONSTRAINT "notifications_sent_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_sent_gym_user_idx" ON "notifications_sent" USING btree ("gym_id","user_id");--> statement-breakpoint

-- push_subscriptions is global: no RLS, no gym_app grant (reached through gym_system, which gets DML
-- through default privileges).

-- Gym-owned: forced RLS on gym_id.
ALTER TABLE "notification_prefs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_prefs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "notification_prefs" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "notifications_sent" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications_sent" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gym_isolation" ON "notifications_sent" FOR ALL
  USING ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid)
  WITH CHECK ("gym_id" = nullif(current_setting('app.gym_id', true), '')::uuid);--> statement-breakpoint

-- gym_app: prefs are read and upserted; the sent record is append-only.
GRANT SELECT, INSERT, UPDATE ON "notification_prefs" TO gym_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "notifications_sent" TO gym_app;
