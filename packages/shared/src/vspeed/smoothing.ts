/**
 * Median filter over a centered window of `size` samples (odd, >= 1).
 * Used to tame barometric altitude jitter before short-window derivatives:
 * ±1 m of raw noise over a 2 s window would read as ±1800 m/h spikes.
 */
export function medianFilter(values: readonly number[], size: number): number[] {
  if (size <= 1 || values.length === 0) return [...values]
  if (size % 2 === 0) throw new Error(`median filter size must be odd, got ${size}`)
  const half = Math.floor(size / 2)
  const out = new Array<number>(values.length)
  for (let i = 0; i < values.length; i++) {
    const lo = Math.max(0, i - half)
    const hi = Math.min(values.length - 1, i + half)
    const window = values.slice(lo, hi + 1).sort((a, b) => a - b)
    const mid = Math.floor(window.length / 2)
    out[i] = window.length % 2 === 1 ? window[mid]! : (window[mid - 1]! + window[mid]!) / 2
  }
  return out
}
