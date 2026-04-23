PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`auto_search_enabled` integer DEFAULT true NOT NULL,
	`auto_download_enabled` integer DEFAULT false NOT NULL,
	`notify_multiple_downloads` integer DEFAULT true NOT NULL,
	`notify_updates` integer DEFAULT true NOT NULL,
	`search_interval_hours` integer DEFAULT 6 NOT NULL,
	`igdb_rate_limit_per_second` integer DEFAULT 3 NOT NULL,
	`download_rules` text,
	`last_auto_search` integer,
	`xrel_scene_releases` integer DEFAULT true NOT NULL,
	`xrel_p2p_releases` integer DEFAULT false NOT NULL,
	`auto_search_unreleased` integer DEFAULT false NOT NULL,
	`steam_sync_failures` integer DEFAULT 0 NOT NULL,
	`enable_post_processing` integer DEFAULT false NOT NULL,
	`auto_unpack` integer DEFAULT false NOT NULL,
	`rename_pattern` text DEFAULT '{Title} ({Region})' NOT NULL,
	`overwrite_existing` integer DEFAULT false NOT NULL,
	`transfer_mode` text DEFAULT 'hardlink' NOT NULL,
	`import_platform_ids` text DEFAULT '[]',
	`ignored_extensions` text DEFAULT '[]',
	`min_file_size` integer DEFAULT 0 NOT NULL,
	`library_root` text DEFAULT '/data' NOT NULL,
	`romm_enabled` integer DEFAULT false NOT NULL,
	`romm_url` text,
	`romm_api_key` text,
	`romm_library_root` text DEFAULT '/data' NOT NULL,
	`romm_platform_routing_mode` text DEFAULT 'slug-subfolder' NOT NULL,
	`romm_platform_bindings` text DEFAULT '{}',
	`romm_platform_aliases` text DEFAULT '{}',
	`romm_move_mode` text DEFAULT 'move' NOT NULL,
	`romm_conflict_policy` text DEFAULT 'rename' NOT NULL,
	`romm_folder_naming_template` text DEFAULT '{title}' NOT NULL,
	`romm_single_file_placement` text DEFAULT 'root' NOT NULL,
	`romm_multi_file_placement` text DEFAULT 'subfolder' NOT NULL,
	`romm_include_region_language_tags` integer DEFAULT false NOT NULL,
	`romm_allowed_slugs` text,
	`romm_allow_absolute_bindings` integer DEFAULT false NOT NULL,
	`romm_binding_missing_behavior` text DEFAULT 'fallback' NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_user_settings`("id", "user_id", "auto_search_enabled", "auto_download_enabled", "notify_multiple_downloads", "notify_updates", "search_interval_hours", "igdb_rate_limit_per_second", "download_rules", "last_auto_search", "xrel_scene_releases", "xrel_p2p_releases", "auto_search_unreleased", "steam_sync_failures", "enable_post_processing", "auto_unpack", "rename_pattern", "overwrite_existing", "transfer_mode", "import_platform_ids", "ignored_extensions", "min_file_size", "library_root", "romm_enabled", "romm_url", "romm_api_key", "romm_library_root", "romm_platform_routing_mode", "romm_platform_bindings", "romm_platform_aliases", "romm_move_mode", "romm_conflict_policy", "romm_folder_naming_template", "romm_single_file_placement", "romm_multi_file_placement", "romm_include_region_language_tags", "romm_allowed_slugs", "romm_allow_absolute_bindings", "romm_binding_missing_behavior", "updated_at") SELECT "id", "user_id", "auto_search_enabled", "auto_download_enabled", "notify_multiple_downloads", "notify_updates", "search_interval_hours", "igdb_rate_limit_per_second", "download_rules", "last_auto_search", "xrel_scene_releases", "xrel_p2p_releases", "auto_search_unreleased", "steam_sync_failures", "enable_post_processing", "auto_unpack", "rename_pattern", "overwrite_existing", "transfer_mode", "import_platform_ids", "ignored_extensions", "min_file_size", "library_root", "romm_enabled", "romm_url", "romm_api_key", "romm_library_root", "romm_platform_routing_mode", "romm_platform_bindings", "romm_platform_aliases", "romm_move_mode", "romm_conflict_policy", "romm_folder_naming_template", "romm_single_file_placement", "romm_multi_file_placement", "romm_include_region_language_tags", "romm_allowed_slugs", "romm_allow_absolute_bindings", "romm_binding_missing_behavior", "updated_at" FROM `user_settings`;--> statement-breakpoint
DROP TABLE `user_settings`;--> statement-breakpoint
ALTER TABLE `__new_user_settings` RENAME TO `user_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `user_settings_user_id_unique` ON `user_settings` (`user_id`);