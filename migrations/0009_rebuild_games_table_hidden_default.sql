PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_games` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`igdb_id` integer,
	`steam_appid` integer,
	`title` text NOT NULL,
	`summary` text,
	`cover_url` text,
	`release_date` text,
	`rating` real,
	`platforms` text,
	`genres` text,
	`publishers` text,
	`developers` text,
	`screenshots` text,
	`status` text DEFAULT 'wanted' NOT NULL,
	`original_release_date` text,
	`release_status` text DEFAULT 'upcoming',
	`hidden` integer DEFAULT false NOT NULL,
	`added_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_games`("id", "user_id", "igdb_id", "steam_appid", "title", "summary", "cover_url", "release_date", "rating", "platforms", "genres", "publishers", "developers", "screenshots", "status", "original_release_date", "release_status", "hidden", "added_at", "completed_at") SELECT "id", "user_id", "igdb_id", "steam_appid", "title", "summary", "cover_url", "release_date", "rating", "platforms", "genres", "publishers", "developers", "screenshots", "status", "original_release_date", "release_status", "hidden", "added_at", "completed_at" FROM `games`;--> statement-breakpoint
DROP TABLE `games`;--> statement-breakpoint
ALTER TABLE `__new_games` RENAME TO `games`;--> statement-breakpoint
PRAGMA foreign_keys=ON;