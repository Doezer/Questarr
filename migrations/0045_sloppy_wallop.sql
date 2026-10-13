ALTER TABLE `api_keys` ADD `scope` text DEFAULT 'integration:all' NOT NULL;--> statement-breakpoint
ALTER TABLE `api_keys` ADD `expires_at` integer;