import { pausedTimeInRange, type Pause } from './pauses.js'

export interface Ascent {
  /** Index of the first sample of the segment. */
  startIndex: number
  /** Index of the last sample of the segment (its extremum point). */
  endIndex: number
  /** Total gain over the segment, meters. Negative for descents. */
  gainM: number
  /** Mean vertical speed over the segment, m/h, pauses excluded. Negative for descents. */
  meanVSpeed: number
  /** Elapsed time of the segment minus paused time, seconds. */
  effectiveTimeS: number
  /** Distance from activity start at segment start/end, km. */
  startKm: number
  endKm: number
}

export interface AscentOptions {
  /** Minimum total gain (drop, for descents) for a segment to count, meters. */
  minGainM: number
  /** Maximum counter-move against the running extremum before the segment ends, meters. */
  descentToleranceM: number
  /** Pauses whose time is subtracted from segment durations (see detectPauses). */
  pauses?: readonly Pause[]
}

/**
 * Segment an altitude profile into ascents, absorbing descents smaller than
 * `descentToleranceM` (hysteresis).
 *
 * State machine, single pass:
 * - Outside a climb: track the running minimum. When altitude rises more than
 *   `descentToleranceM` above it, a climb opens at that minimum.
 * - Inside a climb: track the running maximum. When altitude drops more than
 *   `descentToleranceM` below it, the climb closes AT the running-max sample
 *   (the trailing descent is excluded, even at the end of the stream) and is
 *   kept if its gain >= `minGainM`.
 *
 * Paused time inside a segment is subtracted from its duration, so the mean
 * reflects actual moving time; the gain is unaffected.
 */
export function detectAscents(
  time: readonly number[],
  distance: readonly number[],
  altitude: readonly number[],
  options: AscentOptions,
): Ascent[] {
  return detectSegments(time, distance, altitude, options, 1)
}

/**
 * Segment an altitude profile into descents — the exact mirror of
 * `detectAscents` (rises smaller than the tolerance are absorbed, the trailing
 * rise is excluded). `gainM` and `meanVSpeed` are negative.
 */
export function detectDescents(
  time: readonly number[],
  distance: readonly number[],
  altitude: readonly number[],
  options: AscentOptions,
): Ascent[] {
  return detectSegments(time, distance, altitude, options, -1)
}

/** Shared hysteresis core; descents run it on the negated profile (sign = -1). */
function detectSegments(
  time: readonly number[],
  distance: readonly number[],
  altitude: readonly number[],
  { minGainM, descentToleranceM, pauses = [] }: AscentOptions,
  sign: 1 | -1,
): Ascent[] {
  const n = altitude.length
  if (n !== time.length || n !== distance.length) {
    throw new Error(
      `stream length mismatch: time=${time.length} distance=${distance.length} altitude=${altitude.length}`,
    )
  }
  if (n < 2) return []

  const alt = (i: number) => sign * altitude[i]!
  const segments: Ascent[] = []
  let climbing = false
  let minIdx = 0
  let maxIdx = 0

  const close = () => {
    const gain = alt(maxIdx) - alt(minIdx)
    const dt = time[maxIdx]! - time[minIdx]!
    const effectiveTimeS = dt - pausedTimeInRange(pauses, time, minIdx, maxIdx)
    if (gain >= minGainM && effectiveTimeS > 0) {
      segments.push({
        startIndex: minIdx,
        endIndex: maxIdx,
        gainM: sign * gain,
        meanVSpeed: ((sign * gain) / effectiveTimeS) * 3600,
        effectiveTimeS,
        startKm: distance[minIdx]! / 1000,
        endKm: distance[maxIdx]! / 1000,
      })
    }
  }

  for (let i = 1; i < n; i++) {
    const a = alt(i)
    if (!climbing) {
      if (a < alt(minIdx)) {
        minIdx = i
      } else if (a - alt(minIdx) > descentToleranceM) {
        climbing = true
        maxIdx = i
      }
    } else {
      if (a > alt(maxIdx)) {
        maxIdx = i
      } else if (alt(maxIdx) - a > descentToleranceM) {
        close()
        climbing = false
        minIdx = i
      }
    }
  }
  if (climbing) close()
  return segments
}
