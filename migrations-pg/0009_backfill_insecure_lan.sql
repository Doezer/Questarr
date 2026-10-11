-- Keep plain-HTTP indexers and downloaders copied from a 1.4.x SQLite database
-- working: allow_insecure_lan was added as false on every row, so their API
-- keys and passwords stopped being sent. New rows stay opt-in.
UPDATE "indexers" SET "allow_insecure_lan" = true
WHERE lower(trim("url")) LIKE 'http://%';
--> statement-breakpoint
UPDATE "downloaders" SET "allow_insecure_lan" = true
WHERE lower(trim("url")) LIKE 'http://%'
   OR (lower(trim("url")) NOT LIKE 'https://%' AND coalesce("use_ssl", false) = false);
