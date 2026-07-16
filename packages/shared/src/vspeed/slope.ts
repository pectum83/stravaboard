import type { VSpeedPoint } from './windowed.js'

export interface SlopeOptions {
  /** Window length in meters of horizontal distance. */
  windowM: number
}

/**
 * Terrain slope (grade, %) at each sample over a centered distance window.
 *
 * For sample i the window is [d_i - W/2, d_i + W/2]; slope is
 * (altitude at window end - altitude at window start) / distance span × 100.
 * Distance-centered (not time-centered) because the terrain's grade does not
 * depend on how fast it was covered — pauses need no special handling, they
 * simply add samples at an unchanged distance.
 *
 * `distance` must be non-decreasing (meters); `altitude` same length.
 * Points where the window has zero horizontal span (fully stationary) are
 * emitted as null.
 */
export function windowedSlope(
  distance: readonly number[],
  altitude: readonly number[],
  { windowM }: SlopeOptions,
): VSpeedPoint[] {
  const n = distance.length
  if (n !== altitude.length) {
    throw new Error(
      `stream length mismatch: distance=${distance.length} altitude=${altitude.length}`,
    )
  }
  if (windowM <= 0) throw new Error(`windowM must be > 0, got ${windowM}`)
  if (n < 2) return distance.map((d) => ({ x: d / 1000, y: null }))

  const half = windowM / 2
  const out = new Array<VSpeedPoint>(n)
  for (let i = 0; i < n; i++) {
    const d = distance[i]!
    // lo: first index with distance >= d - half; hi: last index with distance <= d + half
    const lo = lowerBound(distance, d - half)
    const hi = upperBound(distance, d + half) - 1
    const span = distance[hi]! - distance[lo]!
    out[i] = {
      x: d / 1000,
      y: span > 0 ? ((altitude[hi]! - altitude[lo]!) / span) * 100 : null,
    }
  }
  return out
}

/** First index whose value is >= target (array non-decreasing). */
function lowerBound(arr: readonly number[], target: number): number {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (arr[mid]! < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** First index whose value is > target (array non-decreasing). */
function upperBound(arr: readonly number[], target: number): number {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (arr[mid]! <= target) lo = mid + 1
    else hi = mid
  }
  return lo
}
