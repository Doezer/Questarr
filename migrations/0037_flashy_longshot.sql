CREATE TABLE `ai_auto_download_holds` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`release_title` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_auto_download_holds_game_title_idx` ON `ai_auto_download_holds` (`game_id`,`release_title`);