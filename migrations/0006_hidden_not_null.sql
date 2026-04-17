PRAGMA foreign_keys=OFF;
--> statement-breakpoint
UPDATE `games` SET `hidden` = 0 WHERE `hidden` IS NULL;
--> statement-breakpoint
CREATE TABLE `games_new` (
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
  `hidden` integer NOT NULL DEFAULT 0,
  `added_at` integer DEFAULT (strftime('%s', 'now') * 1000),
  `completed_at` integer,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `games_new` (
  `id`,
  `user_id`,
  `igdb_id`,
  `steam_appid`,
  `title`,
  `summary`,
  `cover_url`,
  `release_date`,
  `rating`,
  `platforms`,
  `genres`,
  `publishers`,
  `developers`,
  `screenshots`,
  `status`,
  `original_release_date`,
  `release_status`,
  `hidden`,
  `added_at`,
  `completed_at`
)
SELECT
  `id`,
  `user_id`,
  `igdb_id`,
  `steam_appid`,
  `title`,
  `summary`,
  `cover_url`,
  `release_date`,
  `rating`,
  `platforms`,
  `genres`,
  `publishers`,
  `developers`,
  `screenshots`,
  `status`,
  `original_release_date`,
  `release_status`,
  COALESCE(`hidden`, 0),
  `added_at`,
  `completed_at`
FROM `games`;
--> statement-breakpoint
DROP TABLE `games`;
--> statement-breakpoint
ALTER TABLE `games_new` RENAME TO `games`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
