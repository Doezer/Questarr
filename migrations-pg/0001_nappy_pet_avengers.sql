ALTER TABLE "games" ADD COLUMN "target_platform_id" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "target_platform_name" text;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "time_to_beat_hastily" double precision;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "time_to_beat_normally" double precision;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "time_to_beat_completely" double precision;