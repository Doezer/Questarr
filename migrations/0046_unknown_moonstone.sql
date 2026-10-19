CREATE TABLE `download_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`game_id` text,
	`game_title` text NOT NULL,
	`event_type` text NOT NULL,
	`release_title` text NOT NULL,
	`downloader_name` text,
	`message` text,
	`created_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `download_events_user_created_idx` ON `download_events` (`user_id`,`created_at`);