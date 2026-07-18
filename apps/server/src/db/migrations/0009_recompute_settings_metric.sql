-- The stored ranking metrics are now computed from each athlete's own segment
-- settings (pause threshold, min gain, tolerance, lift cap) instead of fixed
-- parameters, so the list/sort/badges agree with the chart. Null the speed
-- metric so the next sync's local computeMissingMetrics refills all three
-- metrics for every activity with the athlete's current settings, no API. Until
-- that sync runs the ascent-speed sort/badges are empty — trigger a sync after
-- deploying. (A later settings change also recomputes, live.)
UPDATE `activities` SET `ascent_mean_vspeed` = NULL;
