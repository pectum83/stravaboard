CREATE TABLE `athletes` (
	`id` integer PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `__new_oauth_tokens` (
	`athlete_id` integer PRIMARY KEY NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_oauth_tokens` SELECT `athlete_id`, `access_token`, `refresh_token`, `expires_at` FROM `oauth_tokens`;
--> statement-breakpoint
DROP TABLE `oauth_tokens`;
--> statement-breakpoint
ALTER TABLE `__new_oauth_tokens` RENAME TO `oauth_tokens`;
--> statement-breakpoint
INSERT INTO `athletes` SELECT `athlete_id`, 'Athlete ' || `athlete_id`, strftime('%Y-%m-%dT%H:%M:%SZ','now') FROM `oauth_tokens`;
--> statement-breakpoint
ALTER TABLE `activities` ADD `athlete_id` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `activities` SET `athlete_id` = COALESCE((SELECT `athlete_id` FROM `oauth_tokens` LIMIT 1), 0);
--> statement-breakpoint
CREATE INDEX `idx_activities_athlete_start` ON `activities` (`athlete_id`,`start_date_epoch`);
--> statement-breakpoint
CREATE TABLE `__new_sync_state` (
	`athlete_id` integer PRIMARY KEY NOT NULL,
	`last_activity_start_epoch` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`error` text
);
--> statement-breakpoint
INSERT INTO `__new_sync_state` SELECT (SELECT `athlete_id` FROM `oauth_tokens` LIMIT 1), `last_activity_start_epoch`, `status`, `error` FROM `sync_state` WHERE EXISTS (SELECT 1 FROM `oauth_tokens`);
--> statement-breakpoint
DROP TABLE `sync_state`;
--> statement-breakpoint
ALTER TABLE `__new_sync_state` RENAME TO `sync_state`;
--> statement-breakpoint
UPDATE `settings` SET `key` = 'settings:' || (SELECT `athlete_id` FROM `oauth_tokens` LIMIT 1) WHERE `key` = 'settings' AND EXISTS (SELECT 1 FROM `oauth_tokens`);
