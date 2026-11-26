ALTER TABLE "rss_feed_items" ADD COLUMN "links" jsonb;--> statement-breakpoint
ALTER TABLE "rss_feeds" ADD COLUMN "extract_links" boolean DEFAULT false NOT NULL;