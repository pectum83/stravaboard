import { describe, expect, it } from 'vitest'
import { windowedVerticalSpeed } from '../vspeed/windowed.js'
import { flat, ramp, rampWithGap } from './fixtures.js'

describe('windowedVerticalSpeed', () => {
  it.each([2, 60, 300])(
    'reads the exact vertical speed of a constant ramp with a %ds window',
    (windowS) => {
      // +0.5 m/s vertical = 1800 m/h, 10 km/h horizontal, for 10 minutes
      const { time, distance, altitude } = ramp(600, 2.78, 0.5)
      const series = windowedVerticalSpeed(time, distance, altitude, { windowS })
      expect(series).toHaveLength(time.length)
      for (const point of series) {
        expect(point.y).toBeCloseTo(1800, 6)
      }
    },
  )

  it('reads zero on flat ground', () => {
    const { time, distance, altitude } = flat(300)
    const series = windowedVerticalSpeed(time, distance, altitude, { windowS: 60 })
    for (const point of series) expect(point.y).toBe(0)
  })

  it('maps x to kilometers from start', () => {
    const { time, distance, altitude } = ramp(100, 2, 0.1) // 2 m/s
    const series = windowedVerticalSpeed(time, distance, altitude, { windowS: 10 })
    expect(series[50]!.x).toBeCloseTo(0.1, 9) // 50 s * 2 m/s = 100 m
    expect(series[100]!.x).toBeCloseTo(0.2, 9)
  })

  it('emits null across a recording gap larger than gapFactor * window', () => {
    const { time, distance, altitude } = rampWithGap(200, 600)
    const series = windowedVerticalSpeed(time, distance, altitude, { windowS: 60 })
    const nulls = series.filter((p) => p.y === null)
    expect(nulls.length).toBeGreaterThan(0)
    // Points far from the gap still read the true ramp speed (1800 m/h)
    expect(series[10]!.y).toBeCloseTo(1800, 6)
    expect(series[190]!.y).toBeCloseTo(1800, 6)
  })

  it('produces no NaN and matches input length on every fixture', () => {
    const fixtures = [ramp(100, 1, 0.3), flat(50), rampWithGap(100, 120)]
    for (const { time, distance, altitude } of fixtures) {
      for (const windowS of [2, 60, 300]) {
        const series = windowedVerticalSpeed(time, distance, altitude, { windowS })
        expect(series).toHaveLength(time.length)
        for (const p of series) {
          if (p.y !== null) expect(Number.isFinite(p.y)).toBe(true)
          expect(Number.isFinite(p.x)).toBe(true)
        }
      }
    }
  })

  it('returns all-null series for streams shorter than 2 samples', () => {
    expect(windowedVerticalSpeed([], [], [], { windowS: 60 })).toEqual([])
    expect(windowedVerticalSpeed([0], [0], [100], { windowS: 60 })).toEqual([{ x: 0, y: null }])
  })

  it('rejects mismatched stream lengths and non-positive windows', () => {
    expect(() => windowedVerticalSpeed([0, 1], [0], [100, 101], { windowS: 60 })).toThrow(
      /length mismatch/,
    )
    expect(() => windowedVerticalSpeed([0, 1], [0, 1], [100, 101], { windowS: 0 })).toThrow(
      /windowS/,
    )
  })
})
