-- The lift/artefact cap dropped from 2000 to 1400 m/h (slow resort lifts run
-- ~1450). Null every stored ascent-speed value again so the sync's local
-- computeMissingMetrics pass refills it with the lower cap on the next run.
UPDATE `activities` SET `ascent_mean_vspeed` = NULL;
