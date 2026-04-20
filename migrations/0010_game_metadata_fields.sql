ALTER TABLE `games` ADD `source` text DEFAULT 'manual';
--> statement-breakpoint
ALTER TABLE `games` ADD `igdb_websites` text;
--> statement-breakpoint
ALTER TABLE `games` ADD `aggregated_rating` real;
--> statement-breakpoint
ALTER TABLE `game_downloads` ADD `file_size` integer;
