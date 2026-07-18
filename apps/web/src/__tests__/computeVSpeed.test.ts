import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type ActivityStreams } from '@stravaboard/shared'
import { computeVSpeedModel } from '../chart/computeVSpeed'

/**
 * Human climb at +0.2 m/s (720 m/h, 6 m/s forward) for 1000 s with a 100 s
 * standstill in the middle, then a 500 s descent at -1 m/s. GPS track heads
 * north so latlng displacement matches distance.
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
  for (let i = 0; i <= 500; i++) push(i, 6 * i, 500 + 0.2 * i) // climb, first half (→600)
  for (let k = 1; k <= 100; k++) push(500 + k, 3000, 600) // standstill
  for (let j = 1; j <= 500; j++) push(600 + j, 3000 + 6 * j, 600 + 0.2 * j) // climb, 2nd half (→700)
  for (let m = 1; m <= 500; m++) push(1100 + m, 6000 + 6 * m, 700 - m) // descent
  const latlng = distance.map((d): [number, number] => [45.1 + d / 111_320, 6.05])
  return { time, distance, altitude, latlng }
}

/** Steady climb at `vSpeedMS` m/s, 6 m/s forward, no GPS. */
function climbAt(vSpeedMS: number, durationS = 600): ActivityStreams {
  const time: number[] = []
  const distance: number[] = []
  const altitude: number[] = []
  for (let t = 0; t <= durationS; t++) {
    time.push(t)
    distance.push(6 * t)
    altitude.push(1000 + vSpeedMS * t)
  }
  return { time, distance, altitude, latlng: null }
}

describe('computeVSpeedModel', () => {
  it('moves a lift-speed climb to excludedAscents and out of the stats', () => {
    const model = computeVSpeedModel(climbAt(0.9), DEFAULT_SETTINGS) // 3240 m/h
    expect(model.ascents).toHaveLength(0)
    expect(model.excludedAscents).toHaveLength(1)
    expect(model.excludedAscents[0]!.meanVSpeed).toBeGreaterThan(2000)
    expect(model.ascentStats.meanVSpeed).toBeNull()
  })

  it('despikes a GPS altitude spike so it never becomes a segment', () => {
    const flatClimb = climbAt(0)
    flatClimb.altitude![300] = flatClimb.altitude![300]! + 40 // bad GPS fix
    const model = computeVSpeedModel(flatClimb, DEFAULT_SETTINGS)
    // Without despiking, the spike would form a >30 m fake (excluded) climb.
    expect(model.ascents).toHaveLength(0)
    expect(model.excludedAscents).toHaveLength(0)
  })

  it('excludes detected pauses from ascent means and totals the paused time', () => {
    const model = computeVSpeedModel(streamsWithPause(), DEFAULT_SETTINGS)
    expect(model.pauses).toHaveLength(1)
    expect(model.ascents).toHaveLength(1)
    // 200 m gain over 1000 effective seconds (1100 elapsed) = 720 m/h
    expect(model.ascents[0]!.effectiveTimeS).toBe(1000)
    expect(model.ascents[0]!.meanVSpeed).toBeCloseTo(720, 4)
    // The single 100 s standstill is the whole paused time.
    expect(model.pausedS).toBe(100)
  })

  it('honours the pause-radius setting', () => {
    // The standstill's GPS position is frozen, so any radius finds it; a huge
    // radius instead swallows nearby slow travel into the pause, lengthening it.
    const base = computeVSpeedModel(streamsWithPause(), DEFAULT_SETTINGS)
    const wide = computeVSpeedModel(streamsWithPause(), { ...DEFAULT_SETTINGS, pauseRadiusM: 15 })
    expect(base.pauses).toHaveLength(1)
    expect(wide.pauses).toHaveLength(1)
    expect(wide.pauses[0]!.durationS).toBeGreaterThan(base.pauses[0]!.durationS)
  })

  it('computes the terrain slope on its own distance window', () => {
    const model = computeVSpeedModel(streamsWithPause(), DEFAULT_SETTINGS)
    // Climb: +0.2 m per 6 m forward ≈ 3.33 %
    expect(model.slope[250]!.y).toBeCloseTo((0.2 / 6) * 100, 6)
  })

  it('detects descents and aggregates whole-activity stats', () => {
    const model = computeVSpeedModel(streamsWithPause(), DEFAULT_SETTINGS)
    expect(model.descents).toHaveLength(1)
    expect(model.descents[0]!.meanVSpeed).toBeCloseTo(-3600, 4)
    expect(model.ascentStats.meanVSpeed).toBeCloseTo(720, 4)
    expect(model.ascentStats.totalGainM).toBeCloseTo(200, 4)
    expect(model.descentStats.meanVSpeed).toBeCloseTo(-3600, 4)
  })

  it('renders an empty model (no throw) when distance and time lengths disagree', () => {
    // Some manual/broken entries carry altitude but a missing distance stream.
    const model = computeVSpeedModel(
      { time: [0, 1, 2], distance: [], altitude: [100, 101, 102], latlng: null },
      DEFAULT_SETTINGS,
    )
    expect(model.short).toEqual([])
    expect(model.pauses).toEqual([])
    expect(model.pausedS).toBe(0)
    expect(model.ascentStats.meanVSpeed).toBeNull()
  })

  it('handles streams without altitude or GPS', () => {
    const model = computeVSpeedModel(
      { time: [], distance: [], altitude: null, latlng: null },
      DEFAULT_SETTINGS,
    )
    expect(model.instant).toEqual([])
    expect(model.pauses).toEqual([])
    expect(model.pausedS).toBe(0)
    expect(model.ascentStats.meanVSpeed).toBeNull()
    expect(model.descentStats.meanVSpeed).toBeNull()
  })
})
