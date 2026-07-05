CREATE TABLE `import_task_items` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`item_name` text NOT NULL,
	`result` text NOT NULL,
	`game_id` text,
	`game_title` text,
	`error_message` text,
	`created_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	FOREIGN KEY (`task_id`) REFERENCES `import_tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `import_task_items_task_id_idx` ON `import_task_items` (`task_id`);--> statement-breakpoint
CREATE TABLE `import_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`task_type` text NOT NULL,
	`triggered_by` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	`started_at` integer,
	`completed_at` integer,
	`total_items` integer DEFAULT 0 NOT NULL,
	`added_items` integer DEFAULT 0 NOT NULL,
	`skipped_items` integer DEFAULT 0 NOT NULL,
	`failed_items` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `game_downloads` ADD `error_message` text;--> statement-breakpoint
CREATE UNIQUE INDEX `game_downloads_downloader_hash_idx` ON `game_downloads` (`downloader_id`,`download_hash`);--> statement-breakpoint
ALTER TABLE `games` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `notification_preferences` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `auto_delete_after_import` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` DROP COLUMN `notify_multiple_downloads`;--> statement-breakpoint
ALTER TABLE `user_settings` DROP COLUMN `notify_updates`;