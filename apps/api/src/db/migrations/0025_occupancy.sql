ALTER TABLE "gyms" ADD COLUMN "capacity" integer;--> statement-breakpoint
ALTER TABLE "gyms" ADD COLUMN "show_occupancy_count" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_capacity_valid" CHECK ("gyms"."capacity" is null or "gyms"."capacity" between 1 and 2000);
--> statement-breakpoint
GRANT UPDATE ("capacity", "show_occupancy_count") ON "gyms" TO gym_app;
