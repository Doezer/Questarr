CREATE TABLE `game_files` (
  `id` text PRIMARY KEY NOT NULL,
  `game_id` text NOT NULL REFERENCES `games`(`id`) ON DELETE cascade,
  `download_id` text NOT NULL REFERENCES `game_downloads`(`id`) ON DELETE set null,
  `original_name` text NOT NULL,
  `stored_name` text NOT NULL,
  `category` text NOT NULL,
  `file_path` text NOT NULL,
  `file_size` integer,
  `created_at` integer DEFAULT (strftime('%s', 'now') * 1000)
);--> statement-breakpoint
CREATE INDEX `game_files_game_id_idx` ON `game_files` (`game_id`);--> statement-breakpoint
CREATE INDEX `game_files_download_id_idx` ON `game_files` (`download_id`);
