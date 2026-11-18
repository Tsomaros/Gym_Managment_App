ALTER TABLE "gyms" ADD COLUMN "reminder_days" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_reminder_days_valid" CHECK ("gyms"."reminder_days" between 1 and 14);
--> statement-breakpoint
GRANT UPDATE ("reminder_days") ON "gyms" TO gym_app;
