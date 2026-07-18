-- Recompute the stored ascent-speed metric after the pause detector gained
-- dead-GPS and vertical-movement validation: pauses feed the pause-excluded
-- mean ascent speed, so removing false pauses changes it. Nulling the speed
-- metric makes the next sync's local computeMissingMetrics refill every
-- activity, no API. Until that sync runs the ascent-speed sort/badges are empty.
UPDATE `activities` SET `ascent_mean_vspeed` = NULL;