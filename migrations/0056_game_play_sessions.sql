CREATE TABLE `game_play_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`user_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `game_play_sessions_game_user_idx` ON `game_play_sessions` (`game_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `game_play_sessions_user_started_idx` ON `game_play_sessions` (`user_id`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `game_play_sessions_one_running_idx` ON `game_play_sessions` (`user_id`) WHERE "game_play_sessions"."ended_at" is null;