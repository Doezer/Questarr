ALTER TABLE `user_settings` ADD COLUMN `notification_preferences` text;
--> statement-breakpoint
UPDATE `user_settings`
SET `notification_preferences` = CASE
  WHEN `notify_multiple_downloads` = 0 AND `notify_updates` = 0
    THEN '{"multipleResults":{"inApp":false,"apprise":false},"gameUpdates":{"inApp":false,"apprise":false}}'
  WHEN `notify_multiple_downloads` = 0
    THEN '{"multipleResults":{"inApp":false,"apprise":false}}'
  WHEN `notify_updates` = 0
    THEN '{"gameUpdates":{"inApp":false,"apprise":false}}'
  ELSE NULL
END
WHERE `notify_multiple_downloads` = 0 OR `notify_updates` = 0;
--> statement-breakpoint
ALTER TABLE `user_settings` DROP COLUMN `notify_multiple_downloads`;
--> statement-breakpoint
ALTER TABLE `user_settings` DROP COLUMN `notify_updates`;
