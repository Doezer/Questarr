ALTER TABLE "game_files" ADD COLUMN "igdb_content_id" integer;--> statement-breakpoint
CREATE INDEX "game_files_igdb_content_id_idx" ON "game_files" USING btree ("igdb_content_id");
