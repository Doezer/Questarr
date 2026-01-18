CREATE TABLE `downloaders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`url` text NOT NULL,
	`port` integer,
	`use_ssl` integer DEFAULT 0,
	`url_path` text,
	`username` text,
	`password` text,
	`enabled` integer DEFAULT 1 NOT NULL,
	`priority` integer DEFAULT 1 NOT NULL,
	`download_path` text,
	`category` text DEFAULT 'games',
	`label` text DEFAULT 'Questarr',
	`add_stopped` integer DEFAULT 0,
	`remove_completed` integer DEFAULT 0,
	`post_import_category` text,
	`settings` text,
	`created_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	`updated_at` integer DEFAULT (strftime('%s', 'now') * 1000)
);
--> statement-breakpoint
CREATE TABLE `game_downloads` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`downloader_id` text NOT NULL,
	`download_type` text DEFAULT 'torrent' NOT NULL,
	`download_hash` text NOT NULL,
	`download_title` text NOT NULL,
	`status` text DEFAULT 'downloading' NOT NULL,
	`added_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	`completed_at` integer,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`downloader_id`) REFERENCES `downloaders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `games` (
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
	`hidden` integer DEFAULT 0,
	`added_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `indexers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`api_key` text NOT NULL,
	`protocol` text DEFAULT 'torznab' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`priority` integer DEFAULT 1 NOT NULL,
	`categories` text DEFAULT '[]',
	`rss_enabled` integer DEFAULT 1 NOT NULL,
	`auto_search_enabled` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	`updated_at` integer DEFAULT (strftime('%s', 'now') * 1000)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`read` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `system_config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now') * 1000)
);
--> statement-breakpoint
CREATE TABLE `user_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`auto_search_enabled` integer DEFAULT 1 NOT NULL,
	`auto_download_enabled` integer DEFAULT 0 NOT NULL,
	`notify_multiple_downloads` integer DEFAULT 1 NOT NULL,
	`notify_updates` integer DEFAULT 1 NOT NULL,
	`search_interval_hours` integer DEFAULT 6 NOT NULL,
	`igdb_rate_limit_per_second` integer DEFAULT 3 NOT NULL,
	`download_rules` text,
	`last_auto_search` integer,
	`updated_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_settings_user_id_unique` ON `user_settings` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);