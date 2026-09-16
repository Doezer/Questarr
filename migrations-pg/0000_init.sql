CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint,
	"last_used_at" bigint
);
--> statement-breakpoint
CREATE TABLE "downloaders" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"url" text NOT NULL,
	"port" integer,
	"use_ssl" boolean DEFAULT false,
	"url_path" text,
	"allow_self_signed_certificate" boolean DEFAULT false NOT NULL,
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
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint,
	"updated_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint
);
--> statement-breakpoint
CREATE TABLE "game_downloads" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"downloader_id" text NOT NULL,
	"download_type" text DEFAULT 'torrent' NOT NULL,
	"download_hash" text NOT NULL,
	"download_title" text NOT NULL,
	"status" text DEFAULT 'downloading' NOT NULL,
	"error_message" text,
	"file_size" bigint,
	"added_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint,
	"completed_at" bigint
);
--> statement-breakpoint
CREATE TABLE "game_files" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"download_id" text,
	"original_name" text NOT NULL,
	"stored_name" text NOT NULL,
	"category" text NOT NULL,
	"file_path" text NOT NULL,
	"file_size" bigint,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"igdb_id" integer,
	"steam_appid" integer,
	"title" text NOT NULL,
	"summary" text,
	"cover_url" text,
	"release_date" text,
	"rating" double precision,
	"platforms" jsonb,
	"genres" jsonb,
	"themes" jsonb,
	"publishers" jsonb,
	"developers" jsonb,
	"screenshots" jsonb,
	"source" text DEFAULT 'manual',
	"igdb_websites" jsonb,
	"aggregated_rating" double precision,
	"status" text DEFAULT 'wanted' NOT NULL,
	"original_release_date" text,
	"release_status" text DEFAULT 'upcoming',
	"early_access" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"is_adult_content" boolean DEFAULT false NOT NULL,
	"is_age_restricted" boolean DEFAULT false NOT NULL,
	"user_rating" double precision,
	"notes" text,
	"library_path" text,
	"search_results_available" boolean DEFAULT false NOT NULL,
	"search_results_available_at" bigint,
	"update_search_results_available" boolean DEFAULT false NOT NULL,
	"packs_search_results_available" boolean DEFAULT false NOT NULL,
	"added_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint,
	"completed_at" bigint
);
--> statement-breakpoint
CREATE TABLE "import_task_items" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"item_name" text NOT NULL,
	"result" text NOT NULL,
	"game_id" text,
	"game_title" text,
	"error_message" text,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint
);
--> statement-breakpoint
CREATE TABLE "import_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"task_type" text NOT NULL,
	"triggered_by" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint,
	"started_at" bigint,
	"completed_at" bigint,
	"total_items" integer DEFAULT 0 NOT NULL,
	"added_items" integer DEFAULT 0 NOT NULL,
	"skipped_items" integer DEFAULT 0 NOT NULL,
	"failed_items" integer DEFAULT 0 NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "indexers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"api_key" text NOT NULL,
	"protocol" text DEFAULT 'torznab' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 1 NOT NULL,
	"categories" jsonb DEFAULT '[]'::jsonb,
	"rss_enabled" boolean DEFAULT true NOT NULL,
	"auto_search_enabled" boolean DEFAULT true NOT NULL,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint,
	"updated_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"link" text,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint
);
--> statement-breakpoint
CREATE TABLE "path_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"remote_path" text NOT NULL,
	"local_path" text NOT NULL,
	"remote_host" text
);
--> statement-breakpoint
CREATE TABLE "platform_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"igdb_platform_id" integer NOT NULL,
	"source_platform_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "release_blacklist" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"release_title" text NOT NULL,
	"indexer_name" text,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint
);
--> statement-breakpoint
CREATE TABLE "root_folders" (
	"id" text PRIMARY KEY NOT NULL,
	"path" text NOT NULL,
	"name" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"allow_delete" boolean DEFAULT false NOT NULL,
	"accessible" boolean,
	"disk_free_bytes" bigint,
	"disk_total_bytes" bigint,
	"last_scanned_at" bigint,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint,
	CONSTRAINT "root_folders_path_unique" UNIQUE("path")
);
--> statement-breakpoint
CREATE TABLE "rss_feed_items" (
	"id" text PRIMARY KEY NOT NULL,
	"feed_id" text NOT NULL,
	"guid" text NOT NULL,
	"title" text NOT NULL,
	"link" text NOT NULL,
	"pub_date" bigint,
	"source_name" text,
	"igdb_game_id" integer,
	"igdb_game_name" text,
	"cover_url" text,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint
);
--> statement-breakpoint
CREATE TABLE "rss_feeds" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"type" text DEFAULT 'custom' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"mapping" jsonb,
	"last_check" bigint,
	"status" text DEFAULT 'ok',
	"error_message" text,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint,
	"updated_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint
);
--> statement-breakpoint
CREATE TABLE "system_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"auto_search_enabled" boolean DEFAULT true NOT NULL,
	"auto_download_enabled" boolean DEFAULT false NOT NULL,
	"notification_preferences" text,
	"search_interval_hours" integer DEFAULT 6 NOT NULL,
	"igdb_rate_limit_per_second" integer DEFAULT 3 NOT NULL,
	"download_rules" text,
	"last_auto_search" bigint,
	"xrel_scene_releases" boolean DEFAULT true NOT NULL,
	"xrel_p2p_releases" boolean DEFAULT false NOT NULL,
	"auto_search_unreleased" boolean DEFAULT false NOT NULL,
	"steam_sync_failures" integer DEFAULT 0 NOT NULL,
	"steam_sync_enabled" boolean DEFAULT false NOT NULL,
	"steam_sync_interval_hours" integer DEFAULT 24 NOT NULL,
	"last_steam_sync" bigint,
	"preferred_release_groups" text,
	"filter_by_preferred_groups" boolean DEFAULT false NOT NULL,
	"preferred_platform" text,
	"hide_adult_content" boolean DEFAULT true NOT NULL,
	"hide_age_restricted_content" boolean DEFAULT true NOT NULL,
	"enable_post_processing" boolean DEFAULT false NOT NULL,
	"auto_unpack" boolean DEFAULT false NOT NULL,
	"rename_pattern" text DEFAULT '{Title} ({Region})' NOT NULL,
	"overwrite_existing" boolean DEFAULT false NOT NULL,
	"transfer_mode" text DEFAULT 'hardlink' NOT NULL,
	"import_platform_ids" jsonb DEFAULT '[]'::jsonb,
	"ignored_extensions" jsonb DEFAULT '[]'::jsonb,
	"min_file_size" bigint DEFAULT 0 NOT NULL,
	"library_root" text DEFAULT '/data' NOT NULL,
	"auto_delete_after_import" boolean DEFAULT false NOT NULL,
	"sort_extras" boolean DEFAULT false NOT NULL,
	"telemetry_enabled" boolean DEFAULT false NOT NULL,
	"updated_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint,
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"steam_id_64" text,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "xrel_notified_releases" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"xrel_release_id" text NOT NULL,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_downloads" ADD CONSTRAINT "game_downloads_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_downloads" ADD CONSTRAINT "game_downloads_downloader_id_downloaders_id_fk" FOREIGN KEY ("downloader_id") REFERENCES "public"."downloaders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_files" ADD CONSTRAINT "game_files_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_files" ADD CONSTRAINT "game_files_download_id_game_downloads_id_fk" FOREIGN KEY ("download_id") REFERENCES "public"."game_downloads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_task_items" ADD CONSTRAINT "import_task_items_task_id_import_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."import_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_tasks" ADD CONSTRAINT "import_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_blacklist" ADD CONSTRAINT "release_blacklist_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rss_feed_items" ADD CONSTRAINT "rss_feed_items_feed_id_rss_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."rss_feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xrel_notified_releases" ADD CONSTRAINT "xrel_notified_releases_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_user_id_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_downloads_downloader_hash_idx" ON "game_downloads" USING btree ("downloader_id","download_hash");--> statement-breakpoint
CREATE INDEX "game_files_game_id_idx" ON "game_files" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "game_files_download_id_idx" ON "game_files" USING btree ("download_id");--> statement-breakpoint
CREATE INDEX "import_task_items_task_id_idx" ON "import_task_items" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "release_blacklist_game_title_idx" ON "release_blacklist" USING btree ("game_id","release_title");