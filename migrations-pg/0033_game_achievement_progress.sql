CREATE TABLE "game_achievement_progress" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"game_id" text NOT NULL,
	"provider" text NOT NULL,
	"unlocked" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"rarest_name" text,
	"rarest_percent" double precision,
	"last_unlocked_at" bigint,
	"synced_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_achievement_progress" ADD CONSTRAINT "game_achievement_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_achievement_progress" ADD CONSTRAINT "game_achievement_progress_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "game_achievement_progress_unique_idx" ON "game_achievement_progress" USING btree ("game_id","user_id","provider");--> statement-breakpoint
CREATE INDEX "game_achievement_progress_user_idx" ON "game_achievement_progress" USING btree ("user_id");