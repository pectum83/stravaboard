# Vertical-speed algorithms — `packages/shared/src/vspeed/`

All pure functions over parallel streams `time[]` (s), `distance[]` (m),
`altitude[]` (m), optional `latlng[]` (`[lat,lng]` pairs, Strava order).
All throw on stream length mismatch. Re-exported via `packages/shared/src/index.ts`.

## Types & defaults — `packages/shared/src/types.ts`

```ts
Settings { instantWindowS, shortWindowS, longWindowS,
           ascentMinGainM, ascentDescentToleranceM, pauseThresholdS, slopeWindowM }
DEFAULT_SETTINGS = { 60, 120, 300, 30, 10, 30, 100 }   // same order
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
detectPauses(time, latlng|null, distance, {thresholdS, radiusM=5}) → Pause[]
Pause { startIndex, endIndex, durationS }        // PAUSE_RADIUS_M = 5 (constant, not a setting)
pausedTimeInRange(pauses, time, startIndex, endIndex) → seconds (clips overlaps)
haversineM([lat,lng], [lat,lng]) → meters
```

Anchor scan: advance `j` while displacement(anchor, j) ≤ radius; if the dwell
`time[j−1]−time[i] ≥ thresholdS` emit pause and re-anchor at `j`, else `i++`.
Displacement = haversine on latlng when present & length-matching, else
`|distance[j]−distance[i]|` (fallback). Recording gaps count as paused time
when the position is unchanged across the gap; a gap with a large position
jump is travel, not a pause. Worst case O(n·k), near-linear at 1 Hz.

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

`activityAscentStats(streams) → {meanVSpeed, gainM}|null` — the two stored
ranking metrics. **Despikes altitude**, runs `detectAscents` + `detectPauses`
with the FIXED `STANDARD_SEGMENT_PARAMS`
(`{minGainM:30, descentToleranceM:10, pauseThresholdS:30}`), then aggregates
**only `partitionSegments(...).kept`** — deliberately settings-independent so
rankings stay stable. `meanVSpeed` drives the "Best ascent speed" sort/badge;
`gainM` (the summed kept-ascent gain, **lifts and sub-30 m bumps excluded**)
drives the "elevation" sort/badge AND the list's displayed D+, replacing
Strava's raw `total_elevation_gain`. `activityAscentMean(streams)` is a thin
wrapper returning just `meanVSpeed`. Returns `null` with no altitude **or when
time/distance/altitude lengths disagree** (e.g. an altitude stream with a
missing/partial distance stream — unrankable, never throws), `0` when no ascent
qualifies (incl. when every ascent was a lift). Both metrics persist to
`activities.ascentMeanVSpeed` / `ascentGainM`; the sync wraps the call in
`SyncService.ascentMetrics` so a malformed stream set degrades to `{0, 0}`
instead of aborting the whole sync. **Changing this algorithm (or
`MAX_HUMAN_VSPEED`) requires recomputing stored values** — migrations
`0004`/`0005`/`0006` (data-and-api.md) NULL `ascent_mean_vspeed` so the next
sync's local `computeMissingMetrics` refills BOTH columns with no API calls
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
