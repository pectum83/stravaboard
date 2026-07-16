import { describe, expect, it } from 'vitest'
import { windowedSlope } from '../vspeed/slope.js'
import { flat, insertPause, ramp, withLatlng } from './fixtures.js'

const OPTS = { windowM: 100 }

describe('windowedSlope', () => {
  it('measures a constant grade exactly, including at the edges', () => {
    // +0.5 m up per 1 m forward = 50 %
    const { distance, altitude } = ramp(600, 1, 0.5)
    const slope = windowedSlope(distance, altitude, OPTS)
    expect(slope[0]!.y).toBeCloseTo(50, 6)
    expect(slope[300]!.y).toBeCloseTo(50, 6)
    expect(slope[slope.length - 1]!.y).toBeCloseTo(50, 6)
  })

  it('scales with horizontal speed (same climb, twice the distance)', () => {
    const { distance, altitude } = ramp(600, 2, 0.5)
    expect(windowedSlope(distance, altitude, OPTS)[300]!.y).toBeCloseTo(25, 6)
  })

  it('is zero on flat ground and negative downhill', () => {
    const f = flat(600)
    expect(windowedSlope(f.distance, f.altitude, OPTS)[300]!.y).toBeCloseTo(0, 6)
    const down = ramp(600, 1, -0.2)
    expect(windowedSlope(down.distance, down.altitude, OPTS)[300]!.y).toBeCloseTo(-20, 6)
  })

  it('keeps x in kilometers', () => {
    const { distance, altitude } = ramp(600, 2, 0.5)
    expect(windowedSlope(distance, altitude, OPTS)[600]!.x).toBeCloseTo(1.2, 6)
  })

  it('is unaffected by a pause (distance-domain, not time-domain)', () => {
    const s = insertPause(withLatlng(ramp(600, 6, 0.5)), 300, 60)
    const slope = windowedSlope(s.distance, s.altitude, OPTS)
    // Samples inside the standstill still read the terrain's 8.33 % grade.
    expect(slope[330]!.y).toBeCloseTo((0.5 / 6) * 100, 6)
  })

  it('emits null when the window has no horizontal span', () => {
    // Entirely stationary stream: distance never advances.
    const distance = [0, 0, 0, 0]
    const altitude = [100, 100, 100, 100]
    expect(windowedSlope(distance, altitude, OPTS).every((p) => p.y === null)).toBe(true)
  })

  it('handles empty and single-point streams', () => {
    expect(windowedSlope([], [], OPTS)).toEqual([])
    expect(windowedSlope([0], [100], OPTS)).toEqual([{ x: 0, y: null }])
  })

  it('rejects mismatched lengths and non-positive windows', () => {
    expect(() => windowedSlope([0, 1], [100], OPTS)).toThrow(/length mismatch/)
    expect(() => windowedSlope([0, 1], [100, 101], { windowM: 0 })).toThrow(/windowM/)
  })
})
