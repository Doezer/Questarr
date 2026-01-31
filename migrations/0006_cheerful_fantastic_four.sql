CREATE TABLE `path_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`remote_path` text NOT NULL,
	`local_path` text NOT NULL,
	`remote_host` text
);
--> statement-breakpoint
CREATE TABLE `platform_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`igdb_platform_id` integer NOT NULL,
	`romm_platform_name` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `games` ADD `steam_appid` integer;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `steam_sync_failures` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `enable_post_processing` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `auto_unpack` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `rename_pattern` text DEFAULT '{Title} ({Region})' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `overwrite_existing` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `delete_source` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `ignored_extensions` text DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `user_settings` ADD `min_file_size` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_url` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_api_key` text;--> statement-breakpoint
ALTER TABLE `users` ADD `steam_id_64` text;