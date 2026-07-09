/** One point of a chart series: distance from start (km) and vertical speed (m/h), or a line break. */
export interface VSpeedPoint {
  /** Kilometers from activity start. */
  x: number
  /** Vertical speed in m/h; null breaks the line (e.g. across pauses). */
  y: number | null
}

export interface WindowedOptions {
  /** Window duration in seconds. */
  windowS: number
  /**
   * If the actual time span of the window exceeds `gapFactor * windowS`
   * (recording gap / auto-pause), the point is emitted as null.
   * Default 3.
   */
  gapFactor?: number
}

/**
 * Vertical speed at each sample over a centered time window.
 *
 * For sample i the window is [t_i - W/2, t_i + W/2]; speed is
 * (altitude at window end - altitude at window start) / actual time span, in m/h.
 * Centered windows avoid the lag a trailing window introduces.
 *
 * `time` must be non-decreasing (seconds); `altitude` same length.
 */
export function windowedVerticalSpeed(
  time: readonly number[],
  distance: readonly number[],
  altitude: readonly number[],
  { windowS, gapFactor = 3 }: WindowedOptions,
): VSpeedPoint[] {
  const n = time.length
  if (n !== distance.length || n !== altitude.length) {
    throw new Error(
      `stream length mismatch: time=${time.length} distance=${distance.length} altitude=${altitude.length}`,
    )
  }
  if (windowS <= 0) throw new Error(`windowS must be > 0, got ${windowS}`)
  if (n < 2) return time.map((_, i) => ({ x: distance[i]! / 1000, y: null }))

  const half = windowS / 2
  const maxGap = gapFactor * windowS
  const out = new Array<VSpeedPoint>(n)
  for (let i = 0; i < n; i++) {
    const t = time[i]!
    // A recording gap (auto-pause) right before this sample breaks the line:
    // the two sides of a pause are separate efforts.
    const pause = i > 0 && t - time[i - 1]! > maxGap
    // lo: first index with time >= t - half; hi: last index with time <= t + half
    const lo = lowerBound(time, t - half)
    const hi = upperBound(time, t + half) - 1
    const span = time[hi]! - time[lo]!
    let y: number | null
    if (pause || span <= 0 || span > maxGap) {
      y = null
    } else {
      y = ((altitude[hi]! - altitude[lo]!) / span) * 3600
    }
    out[i] = { x: distance[i]! / 1000, y }
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
