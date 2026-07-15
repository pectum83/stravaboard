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
 * Displacement comes from the GPS track (`latlng`, Strava order [lat, lng])
 * when available, so integrated jitter in the distance stream cannot hide a
 * standstill. When `latlng` is absent (or its length does not match), the
 * cumulative distance stream is the fallback.
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
  { thresholdS, radiusM = PAUSE_RADIUS_M }: PauseOptions,
): Pause[] {
  const n = time.length
  if (distance.length !== n) {
    throw new Error(`stream length mismatch: time=${n} distance=${distance.length}`)
  }
  const track = latlng !== null && latlng.length === n && n > 0 ? latlng : null
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
      pauses.push({ startIndex: i, endIndex: last, durationS })
      i = j
    } else {
      i++
    }
  }
  return pauses
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
