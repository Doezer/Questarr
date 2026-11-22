ALTER TABLE `rss_feed_items` ADD `links` text;--> statement-breakpoint
ALTER TABLE `rss_feeds` ADD `extract_links` integer DEFAULT false NOT NULL;