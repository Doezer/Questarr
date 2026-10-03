DROP TABLE IF EXISTS "platform_mappings"
--> statement-breakpoint
ALTER TABLE "games" RENAME COLUMN "igdb_websites" TO "websites"
--> statement-breakpoint
ALTER TABLE "user_settings" DROP COLUMN "igdb_rate_limit_per_second"
--> statement-breakpoint
ALTER TABLE "rss_feed_items" RENAME COLUMN "igdb_game_id" TO "rawg_game_id"
--> statement-breakpoint
ALTER TABLE "rss_feed_items" RENAME COLUMN "igdb_game_name" TO "rawg_game_name"
