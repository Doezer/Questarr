CREATE TABLE "__drizzle_migrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"hash" text NOT NULL,
	"created_at" bigint,
	CONSTRAINT "__drizzle_migrations_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
ALTER TABLE "user_settings" RENAME COLUMN "notify_multiple_torrents" TO "notify_multiple_downloads";