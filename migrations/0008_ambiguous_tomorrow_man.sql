CREATE TABLE `release_blacklist` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`release_title` text NOT NULL,
	`indexer_name` text,
	`created_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `release_blacklist_game_title_idx` ON `release_blacklist` (`game_id`,`release_title`);