import { describe, expect, it } from 'vitest'
import { medianFilter } from '../vspeed/smoothing.js'

describe('medianFilter', () => {
  it('removes an isolated spike', () => {
    const noisy = [10, 10, 10, 25, 10, 10, 10]
    expect(medianFilter(noisy, 5)).toEqual([10, 10, 10, 10, 10, 10, 10])
  })

  it('preserves a monotonic ramp', () => {
    const rampValues = [0, 1, 2, 3, 4, 5, 6]
    expect(medianFilter(rampValues, 3)).toEqual(rampValues)
  })

  it('returns a copy for size 1', () => {
    const values = [3, 1, 2]
    const out = medianFilter(values, 1)
    expect(out).toEqual(values)
    expect(out).not.toBe(values)
  })

  it('handles empty input', () => {
    expect(medianFilter([], 5)).toEqual([])
  })

  it('shrinks the window symmetrically at the edges', () => {
    // Edge samples get a single-element window; the middle sees all three.
    expect(medianFilter([0, 10, 0], 3)).toEqual([0, 0, 0])
  })

  it('rejects even window sizes', () => {
    expect(() => medianFilter([1, 2, 3], 4)).toThrow(/odd/)
  })
})
