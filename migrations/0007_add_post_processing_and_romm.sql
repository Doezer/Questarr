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
ALTER TABLE `user_settings` ADD `enable_post_processing` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `auto_unpack` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `rename_pattern` text DEFAULT '{Title} ({Region})' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `overwrite_existing` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `delete_source` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `ignored_extensions` text DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `user_settings` ADD `min_file_size` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_url` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_api_key` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `library_root` text DEFAULT '/data' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `transfer_mode` text DEFAULT 'hardlink' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `import_platform_ids` text DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_library_root` text DEFAULT '/data' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_platform_routing_mode` text DEFAULT 'slug-subfolder' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_platform_bindings` text DEFAULT '{}';--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_platform_aliases` text DEFAULT '{}';--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_move_mode` text DEFAULT 'hardlink' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_conflict_policy` text DEFAULT 'rename' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_folder_naming_template` text DEFAULT '{title}' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_single_file_placement` text DEFAULT 'root' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_multi_file_placement` text DEFAULT 'subfolder' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_include_region_language_tags` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_allowed_slugs` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_allow_absolute_bindings` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_binding_missing_behavior` text DEFAULT 'fallback' NOT NULL;