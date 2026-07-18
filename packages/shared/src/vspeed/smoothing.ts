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

/**
 * Fixed parameters for sustained-noise flattening (see `flattenNoiseBursts`).
 * 60 s / 50 m: tight enough that a ski run starting right off a lift (real rise
 * and fall inside one window) never trips it — verified against real alpine-ski
 * days — while submerged-watch bursts oscillate far more both ways per minute.
 */
export const NOISE_BURST = { windowS: 60, minBothWaysM: 50 } as const

export interface NoiseBurstOptions {
  /** Sliding time window, seconds. */
  windowS?: number
  /** Cumulative rise AND fall (m) a window must reach to be flagged as noise. */
  minBothWaysM?: number
}

/**
 * Flatten sustained altitude-noise bursts — the garbage a GPS watch records
 * while submerged (a swim in the middle of a hike): readings bounce tens to
 * hundreds of meters BOTH ways within seconds. `despike` cannot fix those (the
 * local median is itself noise) and no real activity produces them: climbing
 * `minBothWaysM` within `windowS` is already superhuman, and doing so while
 * ALSO descending as much is physically impossible — whereas a fast ski descent
 * moves one way only. Every sample covered by a window of `windowS` seconds
 * whose cumulative rises AND falls both reach `minBothWaysM` is flagged;
 * contiguous flagged samples are replaced by the last clean altitude before
 * them (by the first clean one after, for a burst opening the stream). A
 * wet-sensor baseline offset thus surfaces as one abrupt step at the region
 * exit, which the ascent lift/artefact cap already rejects. Run AFTER
 * `despike`: an isolated spike also moves both ways, and despiking it first
 * keeps it out of the window sums.
 */
export function flattenNoiseBursts(
  time: readonly number[],
  values: readonly number[],
  {
    windowS = NOISE_BURST.windowS,
    minBothWaysM = NOISE_BURST.minBothWaysM,
  }: NoiseBurstOptions = {},
): number[] {
  if (time.length !== values.length) {
    throw new Error(`stream length mismatch: time ${time.length}, altitude ${values.length}`)
  }
  const n = values.length
  const out = [...values]
  if (n < 3) return out
  // Prefix sums of the positive / negative altitude steps.
  const rise = new Array<number>(n).fill(0)
  const fall = new Array<number>(n).fill(0)
  for (let i = 1; i < n; i++) {
    const step = values[i]! - values[i - 1]!
    rise[i] = rise[i - 1]! + Math.max(step, 0)
    fall[i] = fall[i - 1]! + Math.max(-step, 0)
  }
  // Slide the window with two pointers and mark every sample a flagged window
  // covers; `markedTo` keeps the total marking work linear.
  const noisy = new Array<boolean>(n).fill(false)
  let markedTo = -1
  for (let i = 0, j = 0; i < n; i++) {
    if (j < i) j = i
    while (j + 1 < n && time[j + 1]! <= time[i]! + windowS) j++
    if (Math.min(rise[j]! - rise[i]!, fall[j]! - fall[i]!) >= minBothWaysM) {
      for (let k = Math.max(i, markedTo + 1); k <= j; k++) noisy[k] = true
      markedTo = j
    }
  }
  // Replace each noisy region with its entry altitude (its exit altitude when
  // the stream starts noisy; the first sample when everything is noise).
  for (let i = 0; i < n; i++) {
    if (!noisy[i]) continue
    let end = i
    while (end + 1 < n && noisy[end + 1]) end++
    const fill = i > 0 ? values[i - 1]! : end + 1 < n ? values[end + 1]! : values[0]!
    for (let k = i; k <= end; k++) out[k] = fill
    i = end
  }
  return out
}
