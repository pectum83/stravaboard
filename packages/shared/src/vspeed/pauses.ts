export interface Pause {
  /** Index of the first stationary sample. */
  startIndex: number
  /** Index of the last stationary sample. */
  endIndex: number
  /** Elapsed time between the first and last stationary sample, seconds. */
  durationS: number
}

export interface PauseOptions {
  /** Minimum stationary duration for a pause to count, seconds. */
  thresholdS: number
  /** Radius the position must stay within to be considered stationary, meters. */
  radiusM?: number
}

/**
 * Default stationary radius. GPS jitter while standing still is typically a
 * couple of meters; 5 m absorbs it without hiding slow walking (1 m/s leaves
 * the radius within seconds).
 */
export const PAUSE_RADIUS_M = 5

/**
 * A GPS track that moves less than this over a whole candidate pause is treated
 * as FROZEN (not updating). Combined with a path that advanced past
 * `DEAD_GPS_ADVANCE_M`, it means the receiver lost lock while the athlete kept
 * moving — start-of-activity, a tunnel, or a wheel/foot-pod feeding distance
 * with no GPS — so the "standstill" is spurious. Measured on production data:
 * genuine rests keep a few metres of latlng jitter (well above 2 m), whereas
 * dead-GPS runs sit at exactly 0 while the distance advances hundreds of metres.
 */
const FROZEN_LATLNG_M = 2
const DEAD_GPS_ADVANCE_M = 30

/**
 * A real standstill barely changes altitude. A candidate pause whose NET
 * altitude change exceeds this is slow (often steep) movement misread as a
 * stop — the horizontal displacement stayed small but the athlete kept climbing
 * or descending. Comfortably above barometric drift/noise over a rest.
 */
const PAUSE_MAX_ALTITUDE_CHANGE_M = 10

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

/**
 * Detect pauses: periods where the position stays within `radiusM` of an
 * anchor point for at least `thresholdS` seconds.
 *
 * Horizontal displacement comes from the GPS track (`latlng`, Strava order
 * [lat, lng]) when available, so integrated jitter in the distance stream
 * cannot hide a standstill. When `latlng` is absent (or its length does not
 * match), the cumulative distance stream is the fallback.
 *
 * Each candidate is then **validated** against the two signals the horizontal
 * scan can be fooled by (both tuned on production hike/ride data):
 * - **Dead GPS** — the track froze (didn't update) while the path clearly
 *   advanced. The athlete was moving; the receiver just wasn't reporting it.
 * - **Vertical movement** — a genuine rest does not gain or lose altitude, so a
 *   large net altitude change means slow/steep movement, not a stop. Needs the
 *   (ideally despiked) `altitude` stream; skipped when it is absent/mismatched.
 *
 * Recording gaps count via the `time` values: a gap while the position is
 * unchanged is a pause, a gap with movement is not.
 *
 * Anchor scan: worst case O(n·k) where k is the samples needed to leave the
 * radius — a handful at typical 1 Hz sampling, so near-linear in practice.
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

  const pauses: Pause[] = []
  let i = 0
  while (i < n - 1) {
    let j = i + 1
    while (j < n && disp(i, j) <= radiusM) j++
    const last = j - 1
    const durationS = time[last]! - time[i]!
    if (last > i && durationS >= thresholdS) {
      // A candidate long enough to count — keep it only if it survives the
      // dead-GPS and vertical-movement checks. Either way re-anchor past it.
      if (isRealStandstill(track, distance, alt, i, last)) {
        pauses.push({ startIndex: i, endIndex: last, durationS })
      }
      i = j
    } else {
      i++
    }
  }
  return pauses
}

/** Reject candidate pauses that are dead-GPS artefacts or slow vertical movement. */
function isRealStandstill(
  track: readonly (readonly [number, number])[] | null,
  distance: readonly number[],
  alt: readonly number[] | null,
  start: number,
  end: number,
): boolean {
  if (track) {
    const straight = haversineM(track[start]!, track[end]!)
    const advance = Math.abs(distance[end]! - distance[start]!)
    if (straight < FROZEN_LATLNG_M && advance > DEAD_GPS_ADVANCE_M) return false
  }
  if (alt && Math.abs(alt[end]! - alt[start]!) > PAUSE_MAX_ALTITUDE_CHANGE_M) return false
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
