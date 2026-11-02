CREATE TABLE "classification_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"namespace" text NOT NULL,
	"verdict" text NOT NULL,
	"stored_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "classification_cache_stored_at_idx" ON "classification_cache" USING btree ("stored_at");