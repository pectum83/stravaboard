# Vertical-speed algorithms — `packages/shared/src/vspeed/`

All pure functions over parallel streams `time[]` (s), `distance[]` (m),
`altitude[]` (m), optional `latlng[]` (`[lat,lng]` pairs, Strava order).
All throw on stream length mismatch. Re-exported via `packages/shared/src/index.ts`.

## Types & defaults — `packages/shared/src/types.ts`

```ts
Settings { instantWindowS, shortWindowS, longWindowS, ascentMinGainM,
           ascentDescentToleranceM, pauseThresholdS, pauseRadiusM,
           slopeWindowM, liftMaxVSpeed }
DEFAULT_SETTINGS = { 60, 120, 300, 30, 10, 30, 5, 100, 1400 }   // same order
ActivityStreams { time, distance, altitude|null, latlng|null }
```

## windowed.ts — `windowedVerticalSpeed(time, distance, altitude, {windowS, gapFactor=3})`

Per sample: centered window `[t−W/2, t+W/2]` via binary search; speed =
`Δalt/Δt·3600` m/h → `VSpeedPoint {x: km, y: m/h|null}`. Emits `y=null`
(breaks the chart line) when the preceding sample gap or the window span
exceeds `gapFactor·windowS`.

## slope.ts — `windowedSlope(distance, altitude, {windowM})`

Terrain grade in % over a **centered distance window** (`slopeWindowM`
setting, default 100 m): slope = Δalt/Δdist·100 across [d−W/2, d+W/2] via
binary search. Distance-domain, so pauses/time gaps need no handling; `y=null`
only when the window has zero horizontal span (fully stationary). Returns
`VSpeedPoint[]` (x in km).

## smoothing.ts — `medianFilter(values, size)` + `despike(values, opts)`

`medianFilter`: centered odd-size median (window shrinks at edges; throws on
even size). Used only for the instant series (width 5) to tame barometric jitter.

`despike(values, {windowSamples, madK, minDeviationM})` — robust **Hampel**
filter: replace a sample deviating from its local median by more than
`max(madK·1.4826·MAD, minDeviationM)` with that median. Removes isolated GPS
altitude spikes (bad fixes, reacquisition steps) without touching real climbs (a
sustained rise carries the median with it); the `minDeviationM` floor stops
smooth data (MAD≈0) from being over-corrected. Fixed `DESPIKE = {windowSamples:7,
madK:4, minDeviationM:5}`. **Applied once at pipeline entry** in both
`computeVSpeedModel` and `activityAscentMean`, so every derivation (series,
slope, segments, stored metric) sees despiked altitude; the instant series then
median-filters on top.

## pauses.ts — position-based pause detection

```ts
detectPauses(time, latlng|null, distance, altitude|null, {thresholdS, radiusM=5}) → Pause[]
Pause { startIndex, endIndex, durationS }   // radiusM = the pauseRadiusM setting
pausedTimeInRange(pauses, time, startIndex, endIndex) → seconds (clips overlaps)
haversineM([lat,lng], [lat,lng]) → meters
```

A **four-stage pipeline** (each stage a small named function; every constant
tuned on production hike/ride data). Displacement = haversine on latlng when
present & length-matching, else `|distance[j]−distance[i]|` (fallback).
Distance-like constants scale with the radius so the one user knob drives the
whole detector.

1. **scan** (`scanStationaryRuns`) — anchor scan: advance `j` while
   displacement(anchor, j) ≤ radius; a dwell ≥ `min(FRAGMENT_MIN_S = 15,
thresholdS)` emits a _fragment_ and re-anchors at `j`, else the anchor slides.
   Recording gaps count through the `time` values (unchanged position across a
   gap = paused; a position jump = travel). O(n·k), near-linear at 1 Hz.
2. **merge** (`mergeRuns`) — fragments separated by ≤ `MERGE_GAP_S = 60` whose
   next anchor lies within `MERGE_DIST_FACTOR = 5`·radius of the break's anchor
   fold into ONE break; the duration **includes the bridge** (sit, wander a few
   meters for a photo, sit again = one pause). The spatial bound keeps
   stop-and-go traffic (stops 100s of meters apart) from chaining — measured:
   at t=60 this cut hike markers 17.2 → 11.7/activity and the worst ride
   cluster 49 → 22 while ride totals stayed ≈ OLD−7 %.
3. **validate** (`isRealStandstill`) — reject artefacts:
   - _dead GPS_: the track never moved over the whole break (spread from the
     anchor < `FROZEN_LATLNG_M = 2 m` — spread, not start→end, so a rest that
     ends where it began is safe) while the path advanced >
     `DEAD_GPS_ADVANCE_FACTOR = 6`·radius: receiver lost lock while the athlete
     moved.
   - _vertical movement_: net altitude change > `max(PAUSE_ALT_FLOOR_M = 5,
PAUSE_ALT_RATE_M_PER_S = 0.05 · duration)` — slow/steep climbing misread as a
     stop; the rate term lets long real rests drift barometrically while still
     catching short grinds the old fixed 10 m bar missed.
4. **threshold** — keep breaks ≥ `thresholdS`.

## ascents.ts — hysteresis segmentation (ascents & descents share one core)

```ts
detectAscents / detectDescents(time, distance, altitude,
  {minGainM, descentToleranceM, pauses?}) → Ascent[]
Ascent { startIndex, endIndex, gainM, meanVSpeed, effectiveTimeS, startKm, endKm }
```

State machine on `sign·altitude` (descents = sign −1, then gain/mean negated):
outside a climb track the running min — open a climb retroactively at that min
when altitude rises > tolerance above it; inside, track the running max —
close **at the max sample** when altitude drops > tolerance below it (also on
stream end). **Invariants:** the trailing counter-move is always excluded
(close-at-extremum, both paths); small dips within tolerance are absorbed;
kept iff `gain ≥ minGainM` and `effectiveTimeS > 0`.
`effectiveTimeS = (time[max]−time[min]) − pausedTimeInRange(...)`;
`meanVSpeed = gain/effectiveTimeS·3600` — **pauses shrink the time, never the
gain**. A pause at the summit overlaps the ascent by zero (segment ends at the
summit sample) but is subtracted from the following descent.

## stats.ts — whole-activity aggregates

`aggregateSegments(segments) → {totalGainM, totalTimeS, meanVSpeed|null}` =
Σgain / Σeffective time · 3600; null when no segments.

**Lift / artefact cap.** `MAX_HUMAN_VSPEED = 1400` (m/h) + `partitionSegments(
segments, maxAbsVSpeed=MAX_HUMAN_VSPEED) → {kept, excluded}` split on
`|meanVSpeed| > cap`. Segments faster than any human (mechanical lifts — slow
resort lifts run ~1450 m/h — or GPS artefacts that survived despiking) are
dropped from the ascent mean, the metric and the badges. **Applied to ascents
only** — descents legitimately exceed the cap (skiing/running downhill), and
descent spikes are already handled by despike. The **stored metric** uses the
fixed `MAX_HUMAN_VSPEED`; the **chart** uses the tunable `liftMaxVSpeed` setting
(default 1400), passed to `partitionSegments` by `computeVSpeedModel`. Excluded
climbs are kept as `VSpeedModel.excludedAscents` (drawn greyed).

`activityMetrics(streams) → {meanVSpeed, gainM, descentLossM}|null` — the three
stored ranking metrics. **Despikes altitude**, runs `detectAscents` +
`detectDescents` + `detectPauses` with the FIXED `STANDARD_SEGMENT_PARAMS`
(`{minGainM:30, descentToleranceM:10, pauseThresholdS:30}`), then aggregates —
deliberately settings-independent so rankings stay stable. `meanVSpeed` (of
`partitionSegments(ascents).kept`) drives the "Best ascent speed" sort/badge;
`gainM` (the summed kept-ascent gain, **lifts and sub-30 m bumps excluded**)
drives the "elevation" sort/badge AND the list's displayed D+, replacing Strava's
raw `total_elevation_gain`; `descentLossM` (the summed magnitude of **all**
detected descents — **NOT lift-capped**, so fast ski/downhill descents count in
full) drives the "descent" sort and the list's displayed D−. `activityAscentMean(
streams)` is a thin wrapper returning just `meanVSpeed`. Returns `null` with no
altitude **or when time/distance/altitude lengths disagree** (e.g. an altitude
stream with a missing/partial distance stream — unrankable, never throws), `0`
per metric when nothing qualifies. All three persist to
`activities.ascentMeanVSpeed` / `ascentGainM` / `descentLossM`; the sync wraps the
call in `SyncService.metricsFor` so a malformed stream set degrades to
`{0, 0, 0}` instead of aborting the whole sync. **Changing this algorithm (or
`MAX_HUMAN_VSPEED`, or pause detection — pauses feed the mean) requires
recomputing stored values** — migrations `0004`/`0005`/`0006`/`0007`/`0008`
(data-and-api.md) NULL `ascent_mean_vspeed` so the next sync's local
`computeMissingMetrics` refills ALL metric columns with no API calls
(`listMissingMetrics` keys off the NULL speed column).

## Test fixtures — `packages/shared/src/__tests__/fixtures.ts`

1 Hz synthetic streams with known ground truth: `ramp(durS, speedMS, vSpeedMS)`
(truth = vSpeed·3600), `flat`, `sawtoothClimb(durS, periodS, dipM)`,
`rampWithGap`, `withLatlng(streams)` (northward track, displacement ≡
distance), `jitterLatlng(latlng, ampM)` (deterministic), `insertPause(streams,
atIndex, durationS)` (freezes position/alt, shifts later times),
`spike(streams, atIndex, deltaM)` (single-sample bad-GPS altitude spike, for
despike tests). **Use a
horizontal speed of 6 m/s when you need exact pause boundaries** (one sample
leaves the 5 m radius); at 1 m/s the anchor scan extends the pause a few
samples on each side.
