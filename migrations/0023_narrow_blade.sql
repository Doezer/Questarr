ALTER TABLE `user_settings` ADD `steam_sync_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `steam_sync_interval_hours` integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `last_steam_sync` integer;