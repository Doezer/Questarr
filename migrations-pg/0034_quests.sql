CREATE TABLE "quests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"period" text NOT NULL,
	"period_start" text NOT NULL,
	"kind" text NOT NULL,
	"game_id" text,
	"target" integer NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"completed_at" bigint,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "quests_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "quests" ADD CONSTRAINT "quests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quests" ADD CONSTRAINT "quests_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quests_user_period_kind_idx" ON "quests" USING btree ("user_id","period","period_start","kind");--> statement-breakpoint
CREATE INDEX "quests_user_start_idx" ON "quests" USING btree ("user_id","period_start");