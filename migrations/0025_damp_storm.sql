ALTER TABLE `games` ADD `is_age_restricted` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `hide_age_restricted_content` integer DEFAULT true NOT NULL;