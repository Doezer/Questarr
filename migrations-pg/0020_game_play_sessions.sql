CREATE TABLE "game_play_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"user_id" text NOT NULL,
	"started_at" bigint NOT NULL,
	"ended_at" bigint,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint
);
--> statement-breakpoint
ALTER TABLE "game_play_sessions" ADD CONSTRAINT "game_play_sessions_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_play_sessions" ADD CONSTRAINT "game_play_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_play_sessions_game_user_idx" ON "game_play_sessions" USING btree ("game_id","user_id");--> statement-breakpoint
CREATE INDEX "game_play_sessions_user_started_idx" ON "game_play_sessions" USING btree ("user_id","started_at");