CREATE TABLE `import_tasks` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text REFERENCES `users`(`id`) ON DELETE CASCADE,
  `task_type` text NOT NULL,
  `triggered_by` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `created_at` integer DEFAULT (strftime('%s', 'now') * 1000),
  `started_at` integer,
  `completed_at` integer,
  `total_items` integer NOT NULL DEFAULT 0,
  `added_items` integer NOT NULL DEFAULT 0,
  `skipped_items` integer NOT NULL DEFAULT 0,
  `failed_items` integer NOT NULL DEFAULT 0,
  `error_message` text
);

CREATE TABLE `import_task_items` (
  `id` text PRIMARY KEY NOT NULL,
  `task_id` text NOT NULL REFERENCES `import_tasks`(`id`) ON DELETE CASCADE,
  `item_name` text NOT NULL,
  `result` text NOT NULL,
  `game_id` text,
  `game_title` text,
  `error_message` text,
  `created_at` integer DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX `import_tasks_user_created_idx` ON `import_tasks` (`user_id`, `created_at` DESC);

CREATE UNIQUE INDEX IF NOT EXISTS `game_downloads_downloader_hash_idx` ON `game_downloads` (`downloader_id`,`download_hash`);
