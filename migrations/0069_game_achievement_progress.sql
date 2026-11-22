CREATE TABLE `game_achievement_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`game_id` text NOT NULL,
	`user_id` text NOT NULL,
	`unlocked` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`rarest_name` text,
	`rarest_percent` real,
	`last_unlocked_at` integer,
	`synced_at` integer DEFAULT (strftime('%s', 'now') * 1000) NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_achievement_progress_unique_idx` ON `game_achievement_progress` (`game_id`,`user_id`,`provider`);--> statement-breakpoint
CREATE INDEX `game_achievement_progress_user_idx` ON `game_achievement_progress` (`user_id`);