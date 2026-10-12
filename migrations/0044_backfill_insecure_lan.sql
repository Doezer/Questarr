-- Keep existing plain-HTTP indexers and downloaders working after upgrading
-- from 1.4.x: 0033/0034 added allow_insecure_lan as 0 on every row, so their
-- API keys and passwords stopped being sent. New rows stay opt-in.
UPDATE `indexers` SET `allow_insecure_lan` = 1
WHERE lower(trim(`url`)) LIKE 'http://%';
--> statement-breakpoint
UPDATE `downloaders` SET `allow_insecure_lan` = 1
WHERE lower(trim(`url`)) LIKE 'http://%'
   OR (lower(trim(`url`)) NOT LIKE 'https://%' AND coalesce(`use_ssl`, 0) = 0);
