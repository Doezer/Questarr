CREATE TABLE `collection_games` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_id` text NOT NULL,
	`game_id` text NOT NULL,
	`added_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collection_games_collection_game_idx` ON `collection_games` (`collection_id`,`game_id`);--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`type` text DEFAULT 'manual' NOT NULL,
	`rules` text,
	`created_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `collections_user_idx` ON `collections` (`user_id`);