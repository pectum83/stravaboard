1 - when computing the ascent mean, it was asked to filter the small descent inside the ascent. But if the small descent is at the end of the ascent it should be excluded.
2 - when computing the ascent mean, we now want to exclude pauses exceeding 30 sec (duration configurable). Pause will be estimated when position does not change for a while (and not from gps own estimated speed)
3 - draw descent mean speed with same rules as ascent mean
3 bis - also add the whole ascents and descent mean for the whole activity (with same paus eexclude rule). They will be eg on top right besides the legend or besides the settings.
4 - on both ascent and descent mean line, add the value at the rigjht end of the line
5 - change default config to instant = 60 sec, short = 120 sec ; long = 300 sec
6 - in activity column add a filter by word by date range or by activity
7 - besides the main graph window, add a map window with a map multilayers (openstreet map, satellite, 3d, ...) with the selected activity trace. When moving the cursor on the graph a cursor will also move synchroneously on the map.
