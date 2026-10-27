CREATE TABLE `classification_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`dedupe_key` text NOT NULL,
	`release_name` text NOT NULL,
	`game_title` text,
	`platform` text,
	`size_bytes` integer,
	`reasons` text NOT NULL,
	`signals` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`seen_count` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`human_label` text,
	`notes` text,
	`reviewed_at` integer,
	`suggested_label` text,
	`suggested_confidence` real,
	`suggested_model` text,
	`suggested_at` integer,
	`created_at` integer DEFAULT (strftime('%s', 'now') * 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `classification_candidates_dedupe_idx` ON `classification_candidates` (`dedupe_key`);