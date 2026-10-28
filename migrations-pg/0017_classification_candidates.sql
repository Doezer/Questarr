CREATE TABLE "classification_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"dedupe_key" text NOT NULL,
	"release_name" text NOT NULL,
	"game_title" text,
	"platform" text,
	"size_bytes" bigint,
	"reasons" text NOT NULL,
	"signals" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"seen_count" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"human_label" text,
	"notes" text,
	"reviewed_at" bigint,
	"suggested_label" text,
	"suggested_confidence" double precision,
	"suggested_model" text,
	"suggested_at" bigint,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint
);
--> statement-breakpoint
CREATE UNIQUE INDEX "classification_candidates_dedupe_idx" ON "classification_candidates" USING btree ("dedupe_key");