CREATE TABLE "gym_roles" (
	"gym_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_roles_gym_id_user_id_role_pk" PRIMARY KEY("gym_id","user_id","role"),
	CONSTRAINT "gym_roles_role_valid" CHECK ("gym_roles"."role" in ('owner', 'reception', 'trainer', 'member'))
);
--> statement-breakpoint
CREATE TABLE "gyms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Europe/Athens' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"roles" text[] NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invitations_email_normalised" CHECK ("invitations"."email" = lower(btrim("invitations"."email"))),
	CONSTRAINT "invitations_roles_valid" CHECK (cardinality("invitations"."roles") > 0 and "invitations"."roles" <@ array['owner', 'reception', 'trainer', 'member']::text[])
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"full_name" text NOT NULL,
	"locale" text DEFAULT 'el' NOT NULL,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_email_normalised" CHECK ("users"."email" = lower(btrim("users"."email"))),
	CONSTRAINT "users_locale_valid" CHECK ("users"."locale" in ('el', 'en'))
);
--> statement-breakpoint
ALTER TABLE "gym_roles" ADD CONSTRAINT "gym_roles_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_roles" ADD CONSTRAINT "gym_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replaced_by_refresh_tokens_id_fk" FOREIGN KEY ("replaced_by") REFERENCES "public"."refresh_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gym_roles_user_id_idx" ON "gym_roles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitations_gym_id_idx" ON "invitations" USING btree ("gym_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_pending_gym_email_uq" ON "invitations" USING btree ("gym_id","email") WHERE "invitations"."accepted_at" is null;--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens" USING btree ("family_id");