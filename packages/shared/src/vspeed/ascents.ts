export interface Ascent {
  /** Index of the first sample of the climb. */
  startIndex: number
  /** Index of the last sample of the climb (its running-max point). */
  endIndex: number
  /** Total gain over the climb, meters. */
  gainM: number
  /** Mean vertical speed over the climb, m/h. */
  meanVSpeed: number
  /** Distance from activity start at climb start/end, km. */
  startKm: number
  endKm: number
}

export interface AscentOptions {
  /** Minimum total gain for a climb to count, meters. */
  minGainM: number
  /** Maximum drop below the running max before the climb ends, meters. */
  descentToleranceM: number
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
 *   (the trailing descent is excluded) and is kept if its gain >= `minGainM`.
 */
export function detectAscents(
  time: readonly number[],
  distance: readonly number[],
  altitude: readonly number[],
  { minGainM, descentToleranceM }: AscentOptions,
): Ascent[] {
  const n = altitude.length
  if (n !== time.length || n !== distance.length) {
    throw new Error(
      `stream length mismatch: time=${time.length} distance=${distance.length} altitude=${altitude.length}`,
    )
  }
  if (n < 2) return []

  const ascents: Ascent[] = []
  let climbing = false
  let minIdx = 0
  let maxIdx = 0

  const close = () => {
    const gain = altitude[maxIdx]! - altitude[minIdx]!
    const dt = time[maxIdx]! - time[minIdx]!
    if (gain >= minGainM && dt > 0) {
      ascents.push({
        startIndex: minIdx,
        endIndex: maxIdx,
        gainM: gain,
        meanVSpeed: (gain / dt) * 3600,
        startKm: distance[minIdx]! / 1000,
        endKm: distance[maxIdx]! / 1000,
      })
    }
  }

  for (let i = 1; i < n; i++) {
    const alt = altitude[i]!
    if (!climbing) {
      if (alt < altitude[minIdx]!) {
        minIdx = i
      } else if (alt - altitude[minIdx]! > descentToleranceM) {
        climbing = true
        maxIdx = i
      }
    } else {
      if (alt > altitude[maxIdx]!) {
        maxIdx = i
      } else if (altitude[maxIdx]! - alt > descentToleranceM) {
        close()
        climbing = false
        minIdx = i
      }
    }
  }
  if (climbing) close()
  return ascents
}
