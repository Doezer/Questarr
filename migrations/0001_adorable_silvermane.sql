ALTER TABLE "game_torrents" RENAME TO "game_downloads";--> statement-breakpoint
ALTER TABLE "game_downloads" RENAME COLUMN "torrent_hash" TO "download_hash";--> statement-breakpoint
ALTER TABLE "game_downloads" RENAME COLUMN "torrent_title" TO "download_title";--> statement-breakpoint
ALTER TABLE "game_downloads" DROP CONSTRAINT "game_torrents_game_id_games_id_fk";
--> statement-breakpoint
ALTER TABLE "game_downloads" DROP CONSTRAINT "game_torrents_downloader_id_downloaders_id_fk";
--> statement-breakpoint
ALTER TABLE "game_downloads" ADD COLUMN "download_type" text DEFAULT 'torrent' NOT NULL;--> statement-breakpoint
ALTER TABLE "indexers" ADD COLUMN "protocol" text DEFAULT 'torznab' NOT NULL;--> statement-breakpoint
ALTER TABLE "game_downloads" ADD CONSTRAINT "game_downloads_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_downloads" ADD CONSTRAINT "game_downloads_downloader_id_downloaders_id_fk" FOREIGN KEY ("downloader_id") REFERENCES "public"."downloaders"("id") ON DELETE cascade ON UPDATE no action;