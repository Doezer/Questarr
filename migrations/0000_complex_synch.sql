CREATE TABLE "downloaders" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"url" text NOT NULL,
	"port" integer,
	"use_ssl" boolean DEFAULT false,
	"url_path" text,
	"username" text,
	"password" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 1 NOT NULL,
	"download_path" text,
	"category" text DEFAULT 'games',
	"label" text DEFAULT 'Questarr',
	"add_stopped" boolean DEFAULT false,
	"remove_completed" boolean DEFAULT false,
	"post_import_category" text,
	"settings" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "game_torrents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" varchar NOT NULL,
	"downloader_id" varchar NOT NULL,
	"torrent_hash" text NOT NULL,
	"torrent_title" text NOT NULL,
	"status" text DEFAULT 'downloading' NOT NULL,
	"added_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" varchar PRIMARY KEY NOT NULL,
	"user_id" varchar,
	"igdb_id" integer,
	"title" text NOT NULL,
	"summary" text,
	"cover_url" text,
	"release_date" text,
	"rating" real,
	"platforms" text[],
	"genres" text[],
	"publishers" text[],
	"developers" text[],
	"screenshots" text[],
	"status" text DEFAULT 'wanted' NOT NULL,
	"original_release_date" text,
	"release_status" text DEFAULT 'upcoming',
	"hidden" boolean DEFAULT false,
	"added_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "indexers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"api_key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 1 NOT NULL,
	"categories" text[] DEFAULT '{}',
	"rss_enabled" boolean DEFAULT true NOT NULL,
	"auto_search_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "system_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"auto_search_enabled" boolean DEFAULT true NOT NULL,
	"auto_download_enabled" boolean DEFAULT false NOT NULL,
	"notify_multiple_torrents" boolean DEFAULT true NOT NULL,
	"notify_updates" boolean DEFAULT true NOT NULL,
	"search_interval_hours" integer DEFAULT 6 NOT NULL,
	"igdb_rate_limit_per_second" integer DEFAULT 3 NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "game_torrents" ADD CONSTRAINT "game_torrents_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_torrents" ADD CONSTRAINT "game_torrents_downloader_id_downloaders_id_fk" FOREIGN KEY ("downloader_id") REFERENCES "public"."downloaders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;