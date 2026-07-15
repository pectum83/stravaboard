import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type ActivityStreams } from '@stravaboard/shared'
import { computeVSpeedModel } from '../chart/computeVSpeed'

/**
 * Climb at +0.5 m/s (6 m/s forward) for 1000 s with a 100 s standstill in the
 * middle, then a 500 s descent at -1 m/s. GPS track heads north so latlng
 * displacement matches distance.
 */
function streamsWithPause(): ActivityStreams {
  const time: number[] = []
  const distance: number[] = []
  const altitude: number[] = []
  const push = (t: number, d: number, alt: number) => {
    time.push(t)
    distance.push(d)
    altitude.push(alt)
  }
  for (let i = 0; i <= 500; i++) push(i, 6 * i, 500 + 0.5 * i) // climb, first half
  for (let k = 1; k <= 100; k++) push(500 + k, 3000, 750) // standstill
  for (let j = 1; j <= 500; j++) push(600 + j, 3000 + 6 * j, 750 + 0.5 * j) // climb, second half
  for (let m = 1; m <= 500; m++) push(1100 + m, 6000 + 6 * m, 1000 - m) // descent
  const latlng = distance.map((d): [number, number] => [45.1 + d / 111_320, 6.05])
  return { time, distance, altitude, latlng }
}

describe('computeVSpeedModel', () => {
  it('excludes detected pauses from ascent means', () => {
    const model = computeVSpeedModel(streamsWithPause(), DEFAULT_SETTINGS)
    expect(model.pauses).toHaveLength(1)
    expect(model.ascents).toHaveLength(1)
    // 500 m gain over 1000 effective seconds (1100 elapsed) = 1800 m/h
    expect(model.ascents[0]!.effectiveTimeS).toBe(1000)
    expect(model.ascents[0]!.meanVSpeed).toBeCloseTo(1800, 4)
  })

  it('detects descents and aggregates whole-activity stats', () => {
    const model = computeVSpeedModel(streamsWithPause(), DEFAULT_SETTINGS)
    expect(model.descents).toHaveLength(1)
    expect(model.descents[0]!.meanVSpeed).toBeCloseTo(-3600, 4)
    expect(model.ascentStats.meanVSpeed).toBeCloseTo(1800, 4)
    expect(model.ascentStats.totalGainM).toBeCloseTo(500, 4)
    expect(model.descentStats.meanVSpeed).toBeCloseTo(-3600, 4)
  })

  it('handles streams without altitude or GPS', () => {
    const model = computeVSpeedModel(
      { time: [], distance: [], altitude: null, latlng: null },
      DEFAULT_SETTINGS,
    )
    expect(model.instant).toEqual([])
    expect(model.pauses).toEqual([])
    expect(model.ascentStats.meanVSpeed).toBeNull()
    expect(model.descentStats.meanVSpeed).toBeNull()
  })
})
