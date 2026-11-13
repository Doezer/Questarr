ALTER TABLE `games` ADD `upgrade_policy` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `upgrade_policy` text DEFAULT 'notify' NOT NULL;