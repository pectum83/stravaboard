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
