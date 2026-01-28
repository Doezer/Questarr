-- Add xREL.to options to user_settings
ALTER TABLE `user_settings` ADD COLUMN `xrel_scene_releases` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `user_settings` ADD COLUMN `xrel_p2p_releases` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `xrel_notified_releases` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`xrel_release_id` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
