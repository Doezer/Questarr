CREATE TABLE "custom_formats" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"specs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"hard_reject" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint,
	"updated_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint
);
--> statement-breakpoint
CREATE TABLE "release_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"min_score" integer DEFAULT 0 NOT NULL,
	"protocol_preference" text DEFAULT 'either' NOT NULL,
	"required_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ignored_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"min_seeders" integer DEFAULT 0 NOT NULL,
	"max_size_bytes" bigint,
	"built_in_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"format_scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint,
	"updated_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint,
	CONSTRAINT "release_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "custom_formats" ADD CONSTRAINT "custom_formats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_profiles" ADD CONSTRAINT "release_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_formats_user_idx" ON "custom_formats" USING btree ("user_id");