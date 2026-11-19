CREATE TABLE `game_status_events` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now') * 1000) NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `game_status_events_game_idx` ON `game_status_events` (`game_id`);--> statement-breakpoint
CREATE INDEX `game_status_events_user_created_idx` ON `game_status_events` (`user_id`,`created_at`);--> statement-breakpoint
-- Backfill: games that already exist get the history we can infer. They entered the library when
-- they were added, and a completed game finished at its completion date.
INSERT INTO `game_status_events` (`id`, `game_id`, `user_id`, `status`, `created_at`)
SELECT `id` || '-added', `id`, `user_id`,
	CASE WHEN `status` IN ('owned', 'completed') THEN 'owned' ELSE `status` END,
	COALESCE(`added_at`, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
FROM `games` WHERE `user_id` IS NOT NULL;--> statement-breakpoint
INSERT INTO `game_status_events` (`id`, `game_id`, `user_id`, `status`, `created_at`)
SELECT `id` || '-completed', `id`, `user_id`, 'completed',
	MAX(COALESCE(`completed_at`, 0), COALESCE(`added_at`, 0), 1)
FROM `games` WHERE `user_id` IS NOT NULL AND `status` = 'completed';
