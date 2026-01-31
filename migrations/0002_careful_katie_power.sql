CREATE TABLE `path_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`remote_path` text NOT NULL,
	`local_path` text NOT NULL,
	`remote_host` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	`updated_at` integer DEFAULT (strftime('%s', 'now') * 1000)
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_downloaders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`url` text NOT NULL,
	`port` integer,
	`use_ssl` integer DEFAULT false,
	`url_path` text,
	`username` text,
	`password` text,
	`enabled` integer DEFAULT true NOT NULL,
	`priority` integer DEFAULT 1 NOT NULL,
	`download_path` text,
	`category` text DEFAULT 'games',
	`label` text DEFAULT 'Questarr',
	`add_stopped` integer DEFAULT false,
	`remove_completed` integer DEFAULT false,
	`post_import_category` text,
	`settings` text,
	`created_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	`updated_at` integer DEFAULT (strftime('%s', 'now') * 1000)
);
--> statement-breakpoint
INSERT INTO `__new_downloaders`("id", "name", "type", "url", "port", "use_ssl", "url_path", "username", "password", "enabled", "priority", "download_path", "category", "label", "add_stopped", "remove_completed", "post_import_category", "settings", "created_at", "updated_at") SELECT "id", "name", "type", "url", "port", "use_ssl", "url_path", "username", "password", "enabled", "priority", "download_path", "category", "label", "add_stopped", "remove_completed", "post_import_category", "settings", "created_at", "updated_at" FROM `downloaders`;--> statement-breakpoint
DROP TABLE `downloaders`;--> statement-breakpoint
ALTER TABLE `__new_downloaders` RENAME TO `downloaders`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_games` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`igdb_id` integer,
	`title` text NOT NULL,
	`summary` text,
	`cover_url` text,
	`release_date` text,
	`rating` real,
	`platforms` text,
	`genres` text,
	`publishers` text,
	`developers` text,
	`screenshots` text,
	`status` text DEFAULT 'wanted' NOT NULL,
	`original_release_date` text,
	`release_status` text DEFAULT 'upcoming',
	`hidden` integer DEFAULT false,
	`added_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_games`("id", "user_id", "igdb_id", "title", "summary", "cover_url", "release_date", "rating", "platforms", "genres", "publishers", "developers", "screenshots", "status", "original_release_date", "release_status", "hidden", "added_at", "completed_at") SELECT "id", "user_id", "igdb_id", "title", "summary", "cover_url", "release_date", "rating", "platforms", "genres", "publishers", "developers", "screenshots", "status", "original_release_date", "release_status", "hidden", "added_at", "completed_at" FROM `games`;--> statement-breakpoint
DROP TABLE `games`;--> statement-breakpoint
ALTER TABLE `__new_games` RENAME TO `games`;--> statement-breakpoint
CREATE TABLE `__new_indexers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`api_key` text NOT NULL,
	`protocol` text DEFAULT 'torznab' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`priority` integer DEFAULT 1 NOT NULL,
	`categories` text DEFAULT '[]',
	`rss_enabled` integer DEFAULT true NOT NULL,
	`auto_search_enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	`updated_at` integer DEFAULT (strftime('%s', 'now') * 1000)
);
--> statement-breakpoint
INSERT INTO `__new_indexers`("id", "name", "url", "api_key", "protocol", "enabled", "priority", "categories", "rss_enabled", "auto_search_enabled", "created_at", "updated_at") SELECT "id", "name", "url", "api_key", "protocol", "enabled", "priority", "categories", "rss_enabled", "auto_search_enabled", "created_at", "updated_at" FROM `indexers`;--> statement-breakpoint
DROP TABLE `indexers`;--> statement-breakpoint
ALTER TABLE `__new_indexers` RENAME TO `indexers`;--> statement-breakpoint
CREATE TABLE `__new_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`read` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_notifications`("id", "user_id", "type", "title", "message", "read", "created_at") SELECT "id", "user_id", "type", "title", "message", "read", "created_at" FROM `notifications`;--> statement-breakpoint
DROP TABLE `notifications`;--> statement-breakpoint
ALTER TABLE `__new_notifications` RENAME TO `notifications`;--> statement-breakpoint
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
	`updated_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_user_settings`("id", "user_id", "auto_search_enabled", "auto_download_enabled", "notify_multiple_downloads", "notify_updates", "search_interval_hours", "igdb_rate_limit_per_second", "download_rules", "last_auto_search", "xrel_scene_releases", "xrel_p2p_releases", "updated_at") SELECT "id", "user_id", "auto_search_enabled", "auto_download_enabled", "notify_multiple_downloads", "notify_updates", "search_interval_hours", "igdb_rate_limit_per_second", "download_rules", "last_auto_search", "xrel_scene_releases", "xrel_p2p_releases", "updated_at" FROM `user_settings`;--> statement-breakpoint
DROP TABLE `user_settings`;--> statement-breakpoint
ALTER TABLE `__new_user_settings` RENAME TO `user_settings`;--> statement-breakpoint
CREATE UNIQUE INDEX `user_settings_user_id_unique` ON `user_settings` (`user_id`);