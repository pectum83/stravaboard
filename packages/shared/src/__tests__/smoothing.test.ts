import { describe, expect, it } from 'vitest'
import { despike, flattenNoiseBursts, medianFilter } from '../vspeed/smoothing.js'
import { flat, noiseBurst, ramp, sawtoothClimb } from './fixtures.js'

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

describe('flattenNoiseBursts', () => {
  it('leaves a clean climb unchanged (and returns a copy)', () => {
    const s = ramp(600, 1, 0.5)
    const out = flattenNoiseBursts(s.time, s.altitude)
    expect(out).toEqual(s.altitude)
    expect(out).not.toBe(s.altitude)
  })

  it('leaves rolling terrain (sawtooth dips) unchanged', () => {
    const s = sawtoothClimb(600, 120, 10)
    expect(flattenNoiseBursts(s.time, s.altitude)).toEqual(s.altitude)
  })

  it('leaves a fast one-way ski descent unchanged', () => {
    // −1.7 m/s ≈ −6100 m/h: as fast as a real alpine-ski descent gets. All the
    // movement is downward, so the both-ways test never fires.
    const s = ramp(300, 10, -1.7)
    expect(flattenNoiseBursts(s.time, s.altitude)).toEqual(s.altitude)
  })

  it('leaves a run-to-lift V-transition unchanged (real rise and fall)', () => {
    // Ski 90 m down at −1 m/s straight onto a lift climbing at 0.7 m/s: real
    // movement both ways around the V, but never 50 m of each within 60 s.
    // (This is why the window is 60 s — at 120 s such transitions would flag.)
    const time: number[] = []
    const altitude: number[] = []
    for (let t = 0; t <= 300; t++) {
      time.push(t)
      altitude.push(t <= 90 ? 2000 - t : 1910 + (t - 90) * 0.7)
    }
    expect(flattenNoiseBursts(time, altitude)).toEqual(altitude)
  })

  it('flattens a mid-stream swim burst to the entry altitude', () => {
    const s = noiseBurst(flat(600), 200, 60, 40)
    expect(flattenNoiseBursts(s.time, s.altitude)).toEqual(Array(601).fill(100))
  })

  it('keeps a post-burst sensor offset as one step at the region exit', () => {
    // Wet-barometer scenario: the sensor leaves the water reading 30 m high.
    const s = flat(600)
    for (let i = 300; i < s.altitude.length; i++) s.altitude[i] = 130
    const b = noiseBurst(s, 240, 60, 50)
    const out = flattenNoiseBursts(b.time, b.altitude)
    const firstAfter = out.findIndex((v) => v === 130)
    // Held at the entry altitude through the burst, then a single step to the
    // offset baseline; the flagged region may overrun the burst by ≤ windowS.
    expect(out.slice(0, firstAfter)).toEqual(Array(firstAfter).fill(100))
    expect(out.slice(firstAfter)).toEqual(Array(out.length - firstAfter).fill(130))
    expect(firstAfter).toBeGreaterThanOrEqual(300)
    expect(firstAfter).toBeLessThanOrEqual(300 + 121)
  })

  it('back-fills a burst at the stream start from the first clean sample', () => {
    const s = noiseBurst(flat(300), 0, 60, 40)
    expect(flattenNoiseBursts(s.time, s.altitude)).toEqual(Array(301).fill(100))
  })

  it('holds the entry altitude for a burst running to the stream end', () => {
    const s = noiseBurst(flat(300), 241, 60, 40)
    expect(flattenNoiseBursts(s.time, s.altitude)).toEqual(Array(301).fill(100))
  })

  it('falls back to the first sample when the whole stream is noise', () => {
    const s = noiseBurst(flat(120), 0, 121, 40)
    const out = flattenNoiseBursts(s.time, s.altitude)
    expect(out).toEqual(Array(121).fill(s.altitude[0]))
  })

  it('flattens two separate bursts independently', () => {
    const clean = ramp(1100, 1, 0.5)
    const s = noiseBurst(noiseBurst(ramp(1100, 1, 0.5), 300, 60, 40), 700, 60, 40)
    const out = flattenNoiseBursts(s.time, s.altitude)
    // Each burst zone is held flat at a clean altitude from its lead-in (the
    // flagged region may start up to windowS before the burst).
    for (const [from, to] of [
      [300, 360],
      [700, 760],
    ] as const) {
      const held = out[from]!
      expect(out.slice(from, to)).toEqual(Array(to - from).fill(held))
      expect(held).toBeGreaterThanOrEqual(clean.altitude[from - 121]!)
      expect(held).toBeLessThanOrEqual(clean.altitude[from - 1]!)
    }
    // The clean stretch between the bursts and the tail (past any ≤ windowS
    // overrun) keep their real values.
    expect(out.slice(485, 575)).toEqual(clean.altitude.slice(485, 575))
    expect(out.slice(885)).toEqual(clean.altitude.slice(885))
  })

  it('uses a time window, so sparse smart-recording bursts are caught', () => {
    const time = Array.from({ length: 11 }, (_, i) => i * 15)
    const altitude = [100, 100, 100, 100, 120, 80, 120, 80, 100, 100, 100]
    const out = flattenNoiseBursts(time, altitude)
    expect(out).toEqual(Array(11).fill(100))
  })

  it('handles a recording gap larger than the window', () => {
    const s = noiseBurst(flat(600), 400, 60, 40)
    for (let i = 300; i < s.time.length; i++) s.time[i] = s.time[i]! + 300 // 5 min gap
    expect(flattenNoiseBursts(s.time, s.altitude)).toEqual(Array(601).fill(100))
  })

  it('respects a custom minBothWaysM threshold', () => {
    // ±2 m oscillation: ~40 m both ways per window — under the 50 m default.
    const s = noiseBurst(flat(300), 100, 40, 2)
    expect(flattenNoiseBursts(s.time, s.altitude)).toEqual(s.altitude)
    expect(flattenNoiseBursts(s.time, s.altitude, { minBothWaysM: 30 })).toEqual(
      Array(301).fill(100),
    )
  })

  it('throws on stream length mismatch and handles empty input', () => {
    expect(() => flattenNoiseBursts([0, 1], [1, 2, 3])).toThrow(/length/)
    expect(flattenNoiseBursts([], [])).toEqual([])
  })
})
