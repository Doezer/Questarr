-- Add Steam integration columns
ALTER TABLE `users` ADD COLUMN `steam_id_64` text;
--> statement-breakpoint
ALTER TABLE `user_settings` ADD COLUMN `steam_sync_failures` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `games` ADD COLUMN `steam_appid` integer;
