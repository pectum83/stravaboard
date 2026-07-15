import { describe, expect, it } from 'vitest'
import { detectPauses, haversineM, pausedTimeInRange } from '../vspeed/pauses.js'
import { flat, insertPause, jitterLatlng, ramp, withLatlng } from './fixtures.js'

// 6 m/s tracks leave the 5 m radius in one sample, so detected pause
// boundaries are exact.
const OPTS = { thresholdS: 30 }

describe('haversineM', () => {
  it('measures 1 degree of latitude as ~111 km', () => {
    expect(haversineM([45, 6], [46, 6])).toBeCloseTo(111_195, -3)
  })

  it('is zero for identical points', () => {
    expect(haversineM([45.1, 6.05], [45.1, 6.05])).toBe(0)
  })
})

describe('detectPauses', () => {
  it('detects a standstill longer than the threshold, with exact bounds', () => {
    const s = insertPause(withLatlng(ramp(200, 6, 0)), 100, 60)
    const pauses = detectPauses(s.time, s.latlng, s.distance, OPTS)
    expect(pauses).toEqual([{ startIndex: 100, endIndex: 160, durationS: 60 }])
  })

  it('treats a standstill of exactly the threshold as a pause', () => {
    const s = insertPause(withLatlng(ramp(200, 6, 0)), 100, 30)
    expect(detectPauses(s.time, s.latlng, s.distance, OPTS)).toHaveLength(1)
  })

  it('ignores a standstill shorter than the threshold', () => {
    const s = insertPause(withLatlng(ramp(200, 6, 0)), 100, 29)
    expect(detectPauses(s.time, s.latlng, s.distance, OPTS)).toHaveLength(0)
  })

  it('still detects the pause under GPS jitter within the radius', () => {
    const s = insertPause(withLatlng(ramp(200, 6, 0)), 100, 60)
    const pauses = detectPauses(s.time, jitterLatlng(s.latlng, 2), s.distance, OPTS)
    expect(pauses).toHaveLength(1)
    expect(pauses[0]!.durationS).toBeGreaterThanOrEqual(60)
  })

  it('does not flag slow continuous movement as a pause', () => {
    // 1 m/s leaves the 5 m radius in 6 s, far below the 30 s threshold.
    const s = withLatlng(flat(600))
    expect(detectPauses(s.time, s.latlng, s.distance, OPTS)).toHaveLength(0)
  })

  it('counts a recording gap at an unchanged position as a pause', () => {
    const time = [0, 1, 2, 63, 64]
    const distance = [0, 6, 12, 12, 18]
    const latlng: [number, number][] = [
      [45.1, 6.05],
      [45.10006, 6.05],
      [45.10012, 6.05],
      [45.10012, 6.05], // same position across the 61 s gap
      [45.10018, 6.05],
    ]
    const pauses = detectPauses(time, latlng, distance, OPTS)
    expect(pauses).toEqual([{ startIndex: 2, endIndex: 3, durationS: 61 }])
  })

  it('does not count a recording gap with a position jump as a pause', () => {
    const time = [0, 1, 62, 63]
    const distance = [0, 6, 106, 112]
    const latlng: [number, number][] = [
      [45.1, 6.05],
      [45.10006, 6.05],
      [45.101, 6.05], // ~100 m away across the gap
      [45.10106, 6.05],
    ]
    expect(detectPauses(time, latlng, distance, OPTS)).toHaveLength(0)
  })

  it('falls back to the distance stream when latlng is null', () => {
    const s = insertPause(withLatlng(ramp(200, 6, 0)), 100, 60)
    const pauses = detectPauses(s.time, null, s.distance, OPTS)
    expect(pauses).toEqual([{ startIndex: 100, endIndex: 160, durationS: 60 }])
  })

  it('falls back when latlng is empty or its length mismatches', () => {
    const s = insertPause(withLatlng(ramp(200, 6, 0)), 100, 60)
    expect(detectPauses(s.time, [], s.distance, OPTS)).toHaveLength(1)
    expect(detectPauses(s.time, s.latlng.slice(0, 5), s.distance, OPTS)).toHaveLength(1)
  })

  it('handles empty and single-point streams', () => {
    expect(detectPauses([], null, [], OPTS)).toEqual([])
    expect(detectPauses([0], [[45, 6]], [0], OPTS)).toEqual([])
  })

  it('rejects mismatched time/distance lengths', () => {
    expect(() => detectPauses([0, 1], null, [0], OPTS)).toThrow(/length mismatch/)
  })
})

describe('pausedTimeInRange', () => {
  const time = Array.from({ length: 100 }, (_, i) => i)
  const pauses = [{ startIndex: 10, endIndex: 20, durationS: 10 }]

  it('counts a pause fully inside the range', () => {
    expect(pausedTimeInRange(pauses, time, 0, 50)).toBe(10)
  })

  it('clips a pause straddling the range start', () => {
    expect(pausedTimeInRange(pauses, time, 15, 50)).toBe(5)
  })

  it('clips a pause straddling the range end', () => {
    expect(pausedTimeInRange(pauses, time, 0, 12)).toBe(2)
  })

  it('ignores a disjoint pause', () => {
    expect(pausedTimeInRange(pauses, time, 30, 50)).toBe(0)
    expect(pausedTimeInRange(pauses, time, 0, 10)).toBe(0)
  })

  it('sums multiple overlapping pauses', () => {
    const two = [...pauses, { startIndex: 40, endIndex: 44, durationS: 4 }]
    expect(pausedTimeInRange(two, time, 0, 99)).toBe(14)
  })
})
