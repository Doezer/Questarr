CREATE TABLE "ddl_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"downloader_id" text NOT NULL,
	"game_id" text NOT NULL,
	"title" text NOT NULL,
	"links" jsonb NOT NULL,
	"password" text,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ddl_jobs" ADD CONSTRAINT "ddl_jobs_downloader_id_downloaders_id_fk" FOREIGN KEY ("downloader_id") REFERENCES "public"."downloaders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddl_jobs" ADD CONSTRAINT "ddl_jobs_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ddl_jobs_downloader_idx" ON "ddl_jobs" USING btree ("downloader_id");
