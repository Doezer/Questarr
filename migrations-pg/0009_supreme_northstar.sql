ALTER TABLE "api_keys" ADD COLUMN "scope" text DEFAULT 'integration:all' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "expires_at" bigint;