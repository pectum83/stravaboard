/**
 * Median filter over a centered window of `size` samples (odd, >= 1).
 * Used to tame barometric altitude jitter before short-window derivatives:
 * ±1 m of raw noise over a 2 s window would read as ±1800 m/h spikes.
 */
export function medianFilter(values: readonly number[], size: number): number[] {
  if (size <= 1 || values.length === 0) return [...values]
  if (size % 2 === 0) throw new Error(`median filter size must be odd, got ${size}`)
  const out = new Array<number>(values.length)
  for (let i = 0; i < values.length; i++) {
    // Shrink symmetrically near the edges so the window stays odd-sized and
    // centered — an asymmetric window would bias monotonic profiles.
    const half = Math.min(Math.floor(size / 2), i, values.length - 1 - i)
    const window = values.slice(i - half, i + half + 1).sort((a, b) => a - b)
    out[i] = window[half]!
  }
  return out
}

/** Fixed despike parameters for GPS altitude artefacts (see `despike`). */
export const DESPIKE = { windowSamples: 7, madK: 4, minDeviationM: 5 } as const

/** Scale factor making the MAD a consistent estimator of the std-dev (normal). */
const MAD_TO_SIGMA = 1.4826

/** Median of a numeric array (copy-sorts; average of the middle pair when even). */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

export interface DespikeOptions {
  /** Centered window width in samples (odd). */
  windowSamples?: number
  /** Deviation, in robust std-devs (MAD·1.4826), above which a sample is a spike. */
  madK?: number
  /** Absolute floor (m): never flag deviations smaller than this (keeps smooth data intact). */
  minDeviationM?: number
}

/**
 * Robust despike (Hampel filter): replace a sample that deviates from its local
 * median by more than `max(madK · 1.4826 · MAD, minDeviationM)` with that
 * median. Removes isolated GPS altitude spikes (bad fixes, signal reacquisition
 * steps) without distorting real climbs — a sustained rise carries the median
 * with it, so it is never flagged. The `minDeviationM` floor stops smooth data
 * (MAD ≈ 0) from being over-corrected. Window shrinks symmetrically at the edges.
 */
export function despike(
  values: readonly number[],
  {
    windowSamples = DESPIKE.windowSamples,
    madK = DESPIKE.madK,
    minDeviationM = DESPIKE.minDeviationM,
  }: DespikeOptions = {},
): number[] {
  if (windowSamples <= 1 || values.length === 0) return [...values]
  if (windowSamples % 2 === 0) throw new Error(`despike window must be odd, got ${windowSamples}`)
  const out = [...values]
  const maxHalf = Math.floor(windowSamples / 2)
  for (let i = 0; i < values.length; i++) {
    const half = Math.min(maxHalf, i, values.length - 1 - i)
    const window = values.slice(i - half, i + half + 1)
    const med = median(window)
    const mad = median(window.map((v) => Math.abs(v - med)))
    const threshold = Math.max(madK * MAD_TO_SIGMA * mad, minDeviationM)
    if (Math.abs(values[i]! - med) > threshold) out[i] = med
  }
  return out
}
