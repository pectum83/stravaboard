ALTER TABLE `activities` ADD `ascent_mean_vspeed` real;
--> statement-breakpoint
CREATE INDEX `idx_activities_athlete_vspeed` ON `activities` (`athlete_id`,`ascent_mean_vspeed`);
