CREATE TABLE `ddl_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`downloader_id` text NOT NULL,
	`game_id` text NOT NULL,
	`title` text NOT NULL,
	`links` text NOT NULL,
	`password` text,
	`created_at` integer DEFAULT (strftime('%s', 'now') * 1000) NOT NULL,
	FOREIGN KEY (`downloader_id`) REFERENCES `downloaders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ddl_jobs_downloader_idx` ON `ddl_jobs` (`downloader_id`);