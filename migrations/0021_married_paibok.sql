CREATE TABLE IF NOT EXISTS `import_task_items` (
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
CREATE INDEX IF NOT EXISTS `import_task_items_task_id_idx` ON `import_task_items` (`task_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `import_tasks` (
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
CREATE UNIQUE INDEX IF NOT EXISTS `game_downloads_downloader_hash_idx` ON `game_downloads` (`downloader_id`,`download_hash`);
