ALTER TABLE `games` ADD `early_access` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `preferred_release_groups` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `filter_by_preferred_groups` integer DEFAULT false NOT NULL;