ALTER TABLE `activities` ADD `descent_loss_m` real;
--> statement-breakpoint
CREATE INDEX `idx_activities_athlete_descent` ON `activities` (`athlete_id`,`descent_loss_m`);
--> statement-breakpoint
-- Null the speed metric so the sync's local computeMissingMetrics recomputes
-- all three metrics (mean speed + lift-excluded gain + total descent) for every
-- activity, no API. Until that sync runs the descent sort is empty.
UPDATE `activities` SET `ascent_mean_vspeed` = NULL;