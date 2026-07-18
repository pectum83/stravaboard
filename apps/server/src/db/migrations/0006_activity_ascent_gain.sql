ALTER TABLE `activities` ADD `ascent_gain_m` real;
--> statement-breakpoint
-- Null the speed metric so the sync's local computeMissingMetrics recomputes
-- both metrics (mean speed + lift-excluded gain) for every activity, no API.
UPDATE `activities` SET `ascent_mean_vspeed` = NULL;