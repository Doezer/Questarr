ALTER TABLE "games" ADD COLUMN "upgrade_policy" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "upgrade_policy" text DEFAULT 'notify' NOT NULL;