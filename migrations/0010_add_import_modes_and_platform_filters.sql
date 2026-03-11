ALTER TABLE `user_settings` ADD `transfer_mode` text DEFAULT 'move' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `import_platform_ids` text DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `user_settings` ADD `integration_provider` text DEFAULT 'romm' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `integration_library_root` text DEFAULT '/data' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `integration_transfer_mode` text DEFAULT 'move' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `integration_platform_ids` text DEFAULT '[]';
