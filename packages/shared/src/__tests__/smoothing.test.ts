import { describe, expect, it } from 'vitest'
import { despike, medianFilter } from '../vspeed/smoothing.js'

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

describe('despike', () => {
  /** Flat baseline so the window median is exactly the true value. */
  const flatAlt = Array.from({ length: 30 }, () => 1000)
  /** A smooth climb: +1 m/sample from 1000 m. */
  const climb = Array.from({ length: 30 }, (_, i) => 1000 + i)

  it('removes an isolated altitude spike', () => {
    const spiked = [...flatAlt]
    spiked[15] = spiked[15]! + 40 // bad GPS fix
    const cleaned = despike(spiked)
    expect(cleaned).toEqual(flatAlt) // spike fully removed, rest untouched
  })

  it('removes a two-sample spike (fewer than half the window)', () => {
    const spiked = [...flatAlt]
    spiked[10] = spiked[10]! + 50
    spiked[11] = spiked[11]! + 50
    expect(despike(spiked)).toEqual(flatAlt)
  })

  it('leaves a clean ramp unchanged', () => {
    expect(despike(climb)).toEqual(climb)
  })

  it('preserves a genuine sustained step (not a spike)', () => {
    // A real cliff/step: 15 flat then 15 raised by 20 m. Each side is the local
    // majority, so neither is flagged.
    const step = [...Array(15).fill(100), ...Array(15).fill(120)]
    expect(despike(step)).toEqual(step)
  })

  it('returns a copy for a window of 1 and handles empty input', () => {
    const v = [3, 1, 2]
    const out = despike(v, { windowSamples: 1 })
    expect(out).toEqual(v)
    expect(out).not.toBe(v)
    expect(despike([])).toEqual([])
  })

  it('rejects even window sizes', () => {
    expect(() => despike([1, 2, 3], { windowSamples: 4 })).toThrow(/odd/)
  })
})
