ALTER TABLE `user_settings` ADD `preferred_release_groups` text;
ALTER TABLE `user_settings` ADD `filter_by_preferred_groups` integer NOT NULL DEFAULT 0;
