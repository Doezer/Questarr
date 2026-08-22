CREATE TABLE `root_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`name` text,
	`enabled` integer DEFAULT true NOT NULL,
	`accessible` integer,
	`disk_free_bytes` integer,
	`disk_total_bytes` integer,
	`last_scanned_at` integer,
	`created_at` integer DEFAULT (strftime('%s', 'now') * 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `root_folders_path_unique` ON `root_folders` (`path`);