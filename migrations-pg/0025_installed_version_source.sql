ALTER TABLE "games" ADD COLUMN "installed_version_source" text;--> statement-breakpoint
UPDATE "games" SET "installed_version_source" = 'manual' WHERE "installed_version" IS NOT NULL AND "installed_version" <> '';
