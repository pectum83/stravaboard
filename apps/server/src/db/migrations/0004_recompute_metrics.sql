-- Recompute the stored ascent-speed metric: the algorithm now despikes GPS
-- altitude artefacts and excludes lift/artefact-fast segments. Null every
-- stored value so the sync's local (no-API) computeMissingMetrics pass refills
-- it with the new algorithm on the next run.
UPDATE `activities` SET `ascent_mean_vspeed` = NULL;
