# Vertical-speed algorithms — `packages/shared/src/vspeed/`

All pure functions over parallel streams `time[]` (s), `distance[]` (m),
`altitude[]` (m), optional `latlng[]` (`[lat,lng]` pairs, Strava order).
All throw on stream length mismatch. Re-exported via `packages/shared/src/index.ts`.

## Types & defaults — `packages/shared/src/types.ts`

```ts
Settings { instantWindowS, shortWindowS, longWindowS,
           ascentMinGainM, ascentDescentToleranceM, pauseThresholdS }
DEFAULT_SETTINGS = { 60, 120, 300, 30, 10, 30 }   // same order
ActivityStreams { time, distance, altitude|null, latlng|null }
```

## windowed.ts — `windowedVerticalSpeed(time, distance, altitude, {windowS, gapFactor=3})`

Per sample: centered window `[t−W/2, t+W/2]` via binary search; speed =
`Δalt/Δt·3600` m/h → `VSpeedPoint {x: km, y: m/h|null}`. Emits `y=null`
(breaks the chart line) when the preceding sample gap or the window span
exceeds `gapFactor·windowS`.

## smoothing.ts — `medianFilter(values, size)`

Centered odd-size median (window shrinks at edges; throws on even size). Used
only for the instant series (width 5) to tame barometric jitter.

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

## Test fixtures — `packages/shared/src/__tests__/fixtures.ts`

1 Hz synthetic streams with known ground truth: `ramp(durS, speedMS, vSpeedMS)`
(truth = vSpeed·3600), `flat`, `sawtoothClimb(durS, periodS, dipM)`,
`rampWithGap`, `withLatlng(streams)` (northward track, displacement ≡
distance), `jitterLatlng(latlng, ampM)` (deterministic), `insertPause(streams,
atIndex, durationS)` (freezes position/alt, shifts later times). **Use a
horizontal speed of 6 m/s when you need exact pause boundaries** (one sample
leaves the 5 m radius); at 1 m/s the anchor scan extends the pause a few
samples on each side.
