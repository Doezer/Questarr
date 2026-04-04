ALTER TABLE `games` ADD `source` text DEFAULT 'manual';
ALTER TABLE `games` ADD `igdb_websites` text;
ALTER TABLE `games` ADD `aggregated_rating` real;
ALTER TABLE `game_downloads` ADD `file_size` integer;
