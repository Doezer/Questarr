CREATE TABLE `game_journal_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`user_id` text NOT NULL,
	`note` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `game_journal_entries_game_user_idx` ON `game_journal_entries` (`game_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `game_milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`user_id` text NOT NULL,
	`label` text NOT NULL,
	`completed_at` integer,
	`created_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `game_milestones_game_user_idx` ON `game_milestones` (`game_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `game_screenshots` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`user_id` text NOT NULL,
	`file_path` text NOT NULL,
	`caption` text,
	`created_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `game_screenshots_game_user_idx` ON `game_screenshots` (`game_id`,`user_id`);--> statement-breakpoint
INSERT INTO `game_journal_entries` (`id`, `game_id`, `user_id`, `note`, `created_at`)
SELECT
	lower(hex(randomblob(16))),
	`id`,
	COALESCE(`user_id`, (SELECT `id` FROM `users` WHERE (SELECT count(*) FROM `users`) = 1)),
	`notes`,
	(strftime('%s', 'now') * 1000)
FROM `games`
WHERE `notes` IS NOT NULL AND trim(`notes`) != ''
	AND COALESCE(`user_id`, (SELECT `id` FROM `users` WHERE (SELECT count(*) FROM `users`) = 1)) IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `games` DROP COLUMN `notes`;