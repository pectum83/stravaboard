CREATE TABLE `activities` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sport_type` text NOT NULL,
	`start_date` text NOT NULL,
	`start_date_epoch` integer NOT NULL,
	`distance_m` real NOT NULL,
	`moving_time_s` integer NOT NULL,
	`elapsed_time_s` integer NOT NULL,
	`total_elevation_gain_m` real NOT NULL,
	`streams_status` text NOT NULL,
	`raw_summary` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `activity_streams` (
	`activity_id` integer PRIMARY KEY NOT NULL,
	`time` text NOT NULL,
	`distance` text NOT NULL,
	`altitude` text,
	`fetched_at` text NOT NULL,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `oauth_tokens` (
	`id` integer PRIMARY KEY NOT NULL,
	`athlete_id` integer NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_activity_start_epoch` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`error` text
);
