CREATE TABLE `library_scan_ignored` (
	`id` text PRIMARY KEY NOT NULL,
	`root_folder_id` text NOT NULL,
	`folder_name` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now') * 1000),
	FOREIGN KEY (`root_folder_id`) REFERENCES `root_folders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_scan_ignored_root_name_idx` ON `library_scan_ignored` (`root_folder_id`,`folder_name`);