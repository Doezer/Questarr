CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`created_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	`updated_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tags_user_idx` ON `tags`(`user_id`);
--> statement-breakpoint
CREATE TABLE `game_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`added_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_tags_game_tag_idx` ON `game_tags`(`game_id`, `tag_id`);
