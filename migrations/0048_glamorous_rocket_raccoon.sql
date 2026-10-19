CREATE TABLE `custom_formats` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`specs` text DEFAULT '[]' NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`hard_reject` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	`updated_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `custom_formats_user_idx` ON `custom_formats` (`user_id`);--> statement-breakpoint
CREATE TABLE `release_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`min_score` integer DEFAULT 0 NOT NULL,
	`protocol_preference` text DEFAULT 'either' NOT NULL,
	`required_terms` text DEFAULT '[]' NOT NULL,
	`ignored_terms` text DEFAULT '[]' NOT NULL,
	`min_seeders` integer DEFAULT 0 NOT NULL,
	`max_size_bytes` integer,
	`built_in_overrides` text DEFAULT '{}' NOT NULL,
	`format_scores` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	`updated_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `release_profiles_user_id_unique` ON `release_profiles` (`user_id`);