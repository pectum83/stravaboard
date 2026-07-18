# Vertical-speed algorithms — `packages/shared/src/vspeed/`

All pure functions over parallel streams `time[]` (s), `distance[]` (m),
`altitude[]` (m), optional `latlng[]` (`[lat,lng]` pairs, Strava order).
All throw on stream length mismatch. Re-exported via `packages/shared/src/index.ts`.

## Types & defaults — `packages/shared/src/types.ts`

```ts
Settings { instantWindowS, shortWindowS, longWindowS, ascentMinGainM,
           ascentDescentToleranceM, pauseThresholdS, slopeWindowM, liftMaxVSpeed }
DEFAULT_SETTINGS = { 60,120,300, 30,10,30, 100, 1400 }   // same order
METRIC_SETTING_KEYS = [ascentMinGainM, ascentDescentToleranceM,
           pauseThresholdS, liftMaxVSpeed]   // the settings that re-rank stored metrics
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
Pause { startIndex, endIndex, durationS }        // PAUSE_RADIUS_M = 5 (constant, not a setting)
pausedTimeInRange(pauses, time, startIndex, endIndex) → seconds (clips overlaps)
haversineM([lat,lng], [lat,lng]) → meters
```

Anchor scan: advance `j` while displacement(anchor, j) ≤ radius; if the dwell
`time[j−1]−time[i] ≥ thresholdS` the candidate is **validated** (below) and, kept
or not, the scan re-anchors at `j`; else `i++`. Displacement = haversine on
latlng when present & length-matching, else `|distance[j]−distance[i]|` (fallback).
Recording gaps count as paused time when the position is unchanged across the
gap; a gap with a large position jump is travel, not a pause. Worst case O(n·k),
near-linear at 1 Hz.

**Candidate validation** (`isRealStandstill`, tuned on production hike/ride data —
both signals the horizontal scan is fooled by; pass despiked `altitude`, null
skips the vertical check):

- **Dead GPS** — the track is frozen (`straight < FROZEN_LATLNG_M = 2 m` start→end)
  while the path advanced (`> DEAD_GPS_ADVANCE_M = 30 m`): the receiver lost lock
  (start-of-activity, tunnel, wheel/foot-pod distance) while the athlete moved →
  reject.
- **Vertical movement** — net altitude change `> PAUSE_MAX_ALTITUDE_CHANGE_M =
10 m`: slow/steep climbing whose small horizontal displacement mimics a stop →
  reject (above barometric drift, so real rests survive).

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
descent spikes are already handled by despike. `MAX_HUMAN_VSPEED` is only the
**default** cap now: both the **chart** (`computeVSpeedModel`) and the **stored
metric** (`activityMetrics`) cap ascents at each athlete's tunable `liftMaxVSpeed`
setting (default 1400) — `params.maxAscentVSpeed`, via `metricParamsFromSettings`.
Excluded climbs are kept as `VSpeedModel.excludedAscents` (drawn greyed).

`activityMetrics(streams, params=STANDARD_METRIC_PARAMS) → {meanVSpeed, gainM,
descentLossM}|null` — the three stored ranking metrics. **Despikes altitude**,
runs `detectAscents` + `detectDescents` + `detectPauses` with `params`
(`MetricParams {minGainM, descentToleranceM, pauseThresholdS, maxAscentVSpeed}`),
then aggregates. `STANDARD_METRIC_PARAMS` (the default) mirrors the segment fields
of `DEFAULT_SETTINGS`; the server passes each athlete's OWN settings via
`metricParamsFromSettings(settings)`, so the stored metric matches that athlete's
chart (`computeVSpeedModel` uses the identical params). `meanVSpeed` (of
`partitionSegments(ascents, params.maxAscentVSpeed).kept`) drives the "Best ascent
speed" sort/badge; `gainM` (the summed kept-ascent gain, **lifts and sub-minGain
bumps excluded**) drives the "elevation" sort/badge AND the list's displayed D+,
replacing Strava's raw `total_elevation_gain`; `descentLossM` (the summed
magnitude of **all** detected descents — **NOT lift-capped**, so fast ski/downhill
descents count in full) drives the "descent" sort and the list's displayed D−.
`activityAscentMean(streams, params?)` is a thin wrapper returning just
`meanVSpeed`. Returns `null` with no altitude **or when time/distance/altitude
lengths disagree** (unrankable, never throws), `0` per metric when nothing
qualifies. All three persist to `activities.ascentMeanVSpeed` / `ascentGainM` /
`descentLossM` via the shared defensive wrapper `metricsFor(streams, params, log?)`
(`apps/server/src/metrics/recompute.ts`) — a malformed stream set degrades to
`{0,0,0}` instead of aborting a sync or a settings save.

**Settings changes re-rank.** The `METRIC_SETTING_KEYS` (`ascentMinGainM`,
`ascentDescentToleranceM`, `pauseThresholdS`, `liftMaxVSpeed`) feed the stored
metrics; a `PUT /settings` changing any of them runs `recomputeAllMetrics(db,
athleteId, params)` over the athlete's done activities (local, no API), so the
sort/badges/list figures follow their settings, and the sync path
(`storeStreams`, `computeMissingMetrics`) computes with current settings too so a
later sync never reverts them. **Changing this algorithm (or pause detection —
pauses feed the mean) requires recomputing stored values** — migrations
`0004`–`0009` (data-and-api.md) NULL `ascent_mean_vspeed` so the next sync's local
`computeMissingMetrics` refills ALL metric columns with no API calls
(`listMissingMetrics` keys off the NULL speed column); `0009` covers the
settings-aware metric.

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
