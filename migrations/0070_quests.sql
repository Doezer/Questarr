CREATE TABLE `quests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`period` text NOT NULL,
	`period_start` text NOT NULL,
	`kind` text NOT NULL,
	`game_id` text,
	`target` integer NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`completed_at` integer,
	`created_at` integer DEFAULT (strftime('%s', 'now') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quests_user_period_kind_idx` ON `quests` (`user_id`,`period`,`period_start`,`kind`);--> statement-breakpoint
CREATE INDEX `quests_user_start_idx` ON `quests` (`user_id`,`period_start`);--> statement-breakpoint
ALTER TABLE `user_settings` ADD `quests_enabled` integer DEFAULT true NOT NULL;