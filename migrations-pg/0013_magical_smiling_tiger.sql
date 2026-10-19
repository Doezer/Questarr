CREATE TABLE "integration_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text DEFAULT 'seerrng' NOT NULL,
	"external_request_id" text NOT NULL,
	"igdb_id" integer,
	"game_id" text,
	"title" text NOT NULL,
	"operating_system" text,
	"architecture" text,
	"status" text DEFAULT 'accepted' NOT NULL,
	"error_message" text,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint,
	"updated_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "scope" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "expires_at" bigint;--> statement-breakpoint
ALTER TABLE "integration_requests" ADD CONSTRAINT "integration_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_requests" ADD CONSTRAINT "integration_requests_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_requests_user_provider_external_idx" ON "integration_requests" USING btree ("user_id","provider","external_request_id");--> statement-breakpoint
CREATE INDEX "integration_requests_game_id_idx" ON "integration_requests" USING btree ("game_id");