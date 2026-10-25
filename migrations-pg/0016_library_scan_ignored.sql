CREATE TABLE "library_scan_ignored" (
	"id" text PRIMARY KEY NOT NULL,
	"root_folder_id" text NOT NULL,
	"folder_name" text NOT NULL,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint
);
--> statement-breakpoint
ALTER TABLE "library_scan_ignored" ADD CONSTRAINT "library_scan_ignored_root_folder_id_root_folders_id_fk" FOREIGN KEY ("root_folder_id") REFERENCES "public"."root_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "library_scan_ignored_root_name_idx" ON "library_scan_ignored" USING btree ("root_folder_id","folder_name");