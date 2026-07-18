-- Altitude cleaning gained sustained-noise-burst flattening (submerged-watch
-- garbage — e.g. a swim in the middle of a hike used to add thousands of fake
-- descent meters). Null the speed metric so the next sync's local
-- computeMissingMetrics refills all three metrics for every activity with the
-- flattened altitude, no API. Until that sync runs the ascent-speed
-- sort/badges are empty — trigger a sync after deploying.
UPDATE `activities` SET `ascent_mean_vspeed` = NULL;
