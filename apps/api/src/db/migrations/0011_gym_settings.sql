ALTER TABLE "gyms" ADD COLUMN "auto_checkout_minutes" integer DEFAULT 120 NOT NULL;--> statement-breakpoint
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_auto_checkout_valid" CHECK ("gyms"."auto_checkout_minutes" between 30 and 600);--> statement-breakpoint
GRANT UPDATE ("auto_checkout_minutes") ON "gyms" TO gym_app;
