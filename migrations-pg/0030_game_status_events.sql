CREATE TABLE "game_status_events" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_status_events" ADD CONSTRAINT "game_status_events_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_status_events" ADD CONSTRAINT "game_status_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_status_events_game_idx" ON "game_status_events" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "game_status_events_user_created_idx" ON "game_status_events" USING btree ("user_id","created_at");--> statement-breakpoint
-- Backfill: games that already exist get the history we can infer. They entered the library when
-- they were added, and a completed game finished at its completion date.
INSERT INTO "game_status_events" ("id", "game_id", "user_id", "status", "created_at")
SELECT "id" || '-added', "id", "user_id",
	CASE WHEN "status" IN ('owned', 'completed') THEN 'owned' ELSE "status" END,
	COALESCE("added_at", (EXTRACT(EPOCH FROM now()) * 1000)::bigint)
FROM "games" WHERE "user_id" IS NOT NULL;--> statement-breakpoint
INSERT INTO "game_status_events" ("id", "game_id", "user_id", "status", "created_at")
SELECT "id" || '-completed', "id", "user_id", 'completed',
	GREATEST(COALESCE("completed_at", 0), COALESCE("added_at", 0), 1)
FROM "games" WHERE "user_id" IS NOT NULL AND "status" = 'completed';
