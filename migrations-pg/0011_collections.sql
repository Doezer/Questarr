CREATE TABLE "collection_games" (
	"id" text PRIMARY KEY NOT NULL,
	"collection_id" text NOT NULL,
	"game_id" text NOT NULL,
	"added_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text DEFAULT 'manual' NOT NULL,
	"rules" jsonb,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint
);
--> statement-breakpoint
ALTER TABLE "collection_games" ADD CONSTRAINT "collection_games_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_games" ADD CONSTRAINT "collection_games_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "collection_games_collection_game_idx" ON "collection_games" USING btree ("collection_id","game_id");--> statement-breakpoint
CREATE INDEX "collections_user_idx" ON "collections" USING btree ("user_id");