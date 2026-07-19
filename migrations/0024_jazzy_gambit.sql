ALTER TABLE `games` ADD `themes` text;--> statement-breakpoint
ALTER TABLE `games` ADD `is_adult_content` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `hide_adult_content` integer DEFAULT true NOT NULL;