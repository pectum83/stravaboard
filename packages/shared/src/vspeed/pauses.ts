export interface Pause {
  /** Index of the first sample of the break. */
  startIndex: number
  /** Index of the last sample of the break. */
  endIndex: number
  /** Elapsed time between the first and last sample, seconds. */
  durationS: number
}

export interface PauseOptions {
  /** Minimum total duration for a break to count, seconds. */
  thresholdS: number
  /** Radius the position must stay within to be considered stationary, meters. */
  radiusM?: number
}

/**
 * Default stationary radius (the `pauseRadiusM` setting overrides it). GPS
 * jitter while standing still is typically a couple of meters; 5 m absorbs it
 * without hiding slow walking (1 m/s leaves the radius within seconds).
 */
export const PAUSE_RADIUS_M = 5

// ---------------------------------------------------------------------------
// Tuning constants (validated on production hike/ride data — see the pause
// section of docs/summary/algorithms.md for the reasoning).
//
// Distances scale with the stationary radius so the whole detector follows the
// one user-visible knob; the two absolute values are physical properties of
// the GPS/barometer, not of the radius.
// ---------------------------------------------------------------------------

/** Fragments no shorter than this feed the merge stage (capped by thresholdS). */
const FRAGMENT_MIN_S = 15
/** Fragments separated by at most this bridge merge into one break. */
const MERGE_GAP_S = 60
/** …and only when the next fragment starts within this × radius of the break's anchor. */
const MERGE_DIST_FACTOR = 5
/** Track spread below this over a whole break = the GPS was frozen (not updating). */
const FROZEN_LATLNG_M = 2
/** A frozen track + a path advance above this × radius = dead GPS, not a standstill. */
const DEAD_GPS_ADVANCE_FACTOR = 6
/** Net altitude change tolerated for a real break: max(floor, rate · duration). */
const PAUSE_ALT_FLOOR_M = 5
const PAUSE_ALT_RATE_M_PER_S = 0.05

const EARTH_RADIUS_M = 6_371_000

/** Great-circle distance between two [lat, lng] points (degrees), meters. */
export function haversineM(a: readonly [number, number], b: readonly [number, number]): number {
  const toRad = Math.PI / 180
  const dLat = (b[0] - a[0]) * toRad
  const dLng = (b[1] - a[1]) * toRad
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h = sinLat * sinLat + Math.cos(a[0] * toRad) * Math.cos(b[0] * toRad) * sinLng * sinLng
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

/** A candidate stationary stretch, by sample indices (inclusive). */
interface Run {
  start: number
  end: number
}

/**
 * Detect breaks: periods where the athlete stays around one spot for at least
 * `thresholdS` seconds. Four explicit stages:
 *
 * 1. **scan** — anchor scan over the horizontal displacement (GPS track when
 *    present, else the cumulative distance stream) emitting stationary
 *    fragments of at least `FRAGMENT_MIN_S`.
 * 2. **merge** — fragments separated by a short bridge (≤ `MERGE_GAP_S`) that
 *    stays near the break's anchor (≤ `MERGE_DIST_FACTOR`·radius) fold into ONE
 *    break: sitting down, stepping away for a photo and sitting back down is a
 *    single pause whose duration includes the bridge. The spatial bound is what
 *    keeps stop-and-go traffic (stops hundreds of meters apart) from chaining.
 * 3. **validate** — drop breaks that are artefacts rather than rests:
 *    - *dead GPS*: the track never moved (spread < `FROZEN_LATLNG_M`) while the
 *      path advanced far (> `DEAD_GPS_ADVANCE_FACTOR`·radius) — the receiver
 *      lost lock while the athlete kept moving. A real rest keeps a few meters
 *      of jitter spread, so it never looks frozen.
 *    - *vertical movement*: a real rest barely changes altitude, so a net
 *      change above `max(PAUSE_ALT_FLOOR_M, PAUSE_ALT_RATE_M_PER_S·duration)`
 *      is slow (often steep) climbing misread as a stop. Uses the (despiked)
 *      `altitude` stream; skipped when absent or mismatched.
 * 4. **threshold** — keep breaks lasting at least `thresholdS`.
 *
 * Recording gaps count through the `time` values: a gap while the position is
 * unchanged extends the break, a gap with a position jump does not.
 */
export function detectPauses(
  time: readonly number[],
  latlng: readonly (readonly [number, number])[] | null,
  distance: readonly number[],
  altitude: readonly number[] | null,
  { thresholdS, radiusM = PAUSE_RADIUS_M }: PauseOptions,
): Pause[] {
  const n = time.length
  if (distance.length !== n) {
    throw new Error(`stream length mismatch: time=${n} distance=${distance.length}`)
  }
  const track = latlng !== null && latlng.length === n && n > 0 ? latlng : null
  const alt = altitude !== null && altitude.length === n ? altitude : null
  const disp = track
    ? (i: number, j: number) => haversineM(track[i]!, track[j]!)
    : (i: number, j: number) => Math.abs(distance[j]! - distance[i]!)

  const fragments = scanStationaryRuns(time, disp, n, radiusM, Math.min(FRAGMENT_MIN_S, thresholdS))
  const breaks = mergeRuns(fragments, time, disp, MERGE_GAP_S, MERGE_DIST_FACTOR * radiusM)
  return breaks
    .filter((b) => time[b.end]! - time[b.start]! >= thresholdS)
    .filter((b) => isRealStandstill(track, distance, alt, time, b, radiusM))
    .map((b) => ({
      startIndex: b.start,
      endIndex: b.end,
      durationS: time[b.end]! - time[b.start]!,
    }))
}

/**
 * Anchor scan: from each anchor `i`, advance `j` while the displacement stays
 * within the radius; a dwell of at least `minDwellS` emits a fragment and
 * re-anchors past it, otherwise the anchor slides one sample. Worst case
 * O(n·k) where k is the samples needed to leave the radius — a handful at
 * typical 1 Hz sampling, so near-linear in practice.
 */
function scanStationaryRuns(
  time: readonly number[],
  disp: (i: number, j: number) => number,
  n: number,
  radiusM: number,
  minDwellS: number,
): Run[] {
  const runs: Run[] = []
  let i = 0
  while (i < n - 1) {
    let j = i + 1
    while (j < n && disp(i, j) <= radiusM) j++
    const last = j - 1
    if (last > i && time[last]! - time[i]! >= minDwellS) {
      runs.push({ start: i, end: last })
      i = j
    } else {
      i++
    }
  }
  return runs
}

/**
 * Fold fragments that belong to one break: the next fragment must start within
 * `maxGapS` of the current break's end AND within `maxDistM` of the break's
 * anchor (its first sample). The merged duration spans the bridge — a short
 * wander in the middle of a rest is part of the rest.
 */
function mergeRuns(
  runs: readonly Run[],
  time: readonly number[],
  disp: (i: number, j: number) => number,
  maxGapS: number,
  maxDistM: number,
): Run[] {
  const merged: Run[] = []
  for (const run of runs) {
    const current = merged[merged.length - 1]
    if (
      current &&
      time[run.start]! - time[current.end]! <= maxGapS &&
      disp(current.start, run.start) <= maxDistM
    ) {
      current.end = run.end
    } else {
      merged.push({ ...run })
    }
  }
  return merged
}

/** Reject breaks that are dead-GPS artefacts or slow vertical movement. */
function isRealStandstill(
  track: readonly (readonly [number, number])[] | null,
  distance: readonly number[],
  alt: readonly number[] | null,
  time: readonly number[],
  b: Run,
  radiusM: number,
): boolean {
  if (track && isFrozenTrack(track, b)) {
    const advance = Math.abs(distance[b.end]! - distance[b.start]!)
    if (advance > DEAD_GPS_ADVANCE_FACTOR * radiusM) return false
  }
  if (alt) {
    const durationS = time[b.end]! - time[b.start]!
    const allowed = Math.max(PAUSE_ALT_FLOOR_M, PAUSE_ALT_RATE_M_PER_S * durationS)
    if (Math.abs(alt[b.end]! - alt[b.start]!) > allowed) return false
  }
  return true
}

/**
 * A frozen (non-updating) track repeats one coordinate for the whole break, so
 * its spread from the anchor stays essentially zero; a genuine rest always
 * carries a few meters of GPS jitter. Checking the spread (not just start→end)
 * keeps a real rest that happens to end back at its starting spot.
 */
function isFrozenTrack(track: readonly (readonly [number, number])[], b: Run): boolean {
  for (let k = b.start + 1; k <= b.end; k++) {
    if (haversineM(track[b.start]!, track[k]!) >= FROZEN_LATLNG_M) return false
  }
  return true
}

/**
 * Total paused time inside the sample range [startIndex, endIndex], seconds.
 * Pauses straddling the range boundaries only count their overlapping part.
 */
export function pausedTimeInRange(
  pauses: readonly Pause[],
  time: readonly number[],
  startIndex: number,
  endIndex: number,
): number {
  let total = 0
  for (const p of pauses) {
    const s = Math.max(p.startIndex, startIndex)
    const e = Math.min(p.endIndex, endIndex)
    if (e > s) total += time[e]! - time[s]!
  }
  return total
}
