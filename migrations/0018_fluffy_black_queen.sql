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
	`source_platform_name` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `user_settings` ADD `enable_post_processing` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `auto_unpack` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `rename_pattern` text DEFAULT '{Title} ({Region})' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `overwrite_existing` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `transfer_mode` text DEFAULT 'hardlink' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `import_platform_ids` text DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `user_settings` ADD `ignored_extensions` text DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `user_settings` ADD `min_file_size` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `library_root` text DEFAULT '/data' NOT NULL;