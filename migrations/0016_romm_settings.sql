ALTER TABLE `user_settings` ADD `romm_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_library_root` text DEFAULT '/data' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_platform_routing_mode` text DEFAULT 'slug-subfolder' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_platform_bindings` text DEFAULT '{}';--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_platform_aliases` text DEFAULT '{}';--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_move_mode` text DEFAULT 'move' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_conflict_policy` text DEFAULT 'rename' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_folder_naming_template` text DEFAULT '{title}' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_single_file_placement` text DEFAULT 'root' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_multi_file_placement` text DEFAULT 'subfolder' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_include_region_language_tags` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_allowed_slugs` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_allow_absolute_bindings` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `romm_binding_missing_behavior` text DEFAULT 'fallback' NOT NULL;