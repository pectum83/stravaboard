import { describe, expect, it } from 'vitest'
import { detectDescents } from '../vspeed/ascents.js'
import { detectPauses } from '../vspeed/pauses.js'
import { flat, insertPause, ramp, sawtoothClimb, withLatlng, type Streams } from './fixtures.js'

const OPTS = { minGainM: 30, descentToleranceM: 10 }

/** Mirror a profile vertically so climbs become descents. */
function inverted({ time, distance, altitude }: Streams): Streams {
  return { time, distance, altitude: altitude.map((a) => 300 - a) }
}

describe('detectDescents', () => {
  it('finds a single monotonic descent with its exact negative mean speed', () => {
    // -0.5 m/s for 1000 s => 500 m drop, -1800 m/h
    const { time, distance, altitude } = ramp(1000, 1, -0.5)
    const descents = detectDescents(time, distance, altitude, OPTS)
    expect(descents).toHaveLength(1)
    const d = descents[0]!
    expect(d.gainM).toBeCloseTo(-500, 6)
    expect(d.meanVSpeed).toBeCloseTo(-1800, 6)
    expect(d.effectiveTimeS).toBe(1000)
    expect(d.startIndex).toBe(0)
    expect(d.endIndex).toBe(time.length - 1)
  })

  it('absorbs rises smaller than the tolerance into one descent', () => {
    const descents = (() => {
      const { time, distance, altitude } = inverted(sawtoothClimb(1200, 120, 5))
      return detectDescents(time, distance, altitude, OPTS)
    })()
    expect(descents).toHaveLength(1)
  })

  it('splits the descent on rises larger than the tolerance', () => {
    const { time, distance, altitude } = inverted(sawtoothClimb(1200, 120, 15))
    expect(detectDescents(time, distance, altitude, OPTS).length).toBeGreaterThan(1)
  })

  it('ignores drops below minGain', () => {
    const { time, distance, altitude } = ramp(40, 1, -0.5) // 20 m < 30 m
    expect(detectDescents(time, distance, altitude, OPTS)).toHaveLength(0)
  })

  it('finds nothing on flat ground or pure ascent', () => {
    const f = flat(600)
    expect(detectDescents(f.time, f.distance, f.altitude, OPTS)).toHaveLength(0)
    const up = ramp(600, 1, 0.5)
    expect(detectDescents(up.time, up.distance, up.altitude, OPTS)).toHaveLength(0)
  })

  it('ends the descent at its lowest point, excluding a trailing rise at stream end', () => {
    // 500 s down (-0.5 m/s), then a 5 m rise (< tolerance) ending the stream
    const down = ramp(500, 1, -0.5)
    const time = [...down.time]
    const distance = [...down.distance]
    const altitude = [...down.altitude]
    const bottom = altitude[altitude.length - 1]!
    for (let t = 1; t <= 10; t++) {
      time.push(500 + t)
      distance.push(500 + t)
      altitude.push(bottom + t * 0.5)
    }
    const descents = detectDescents(time, distance, altitude, OPTS)
    expect(descents).toHaveLength(1)
    expect(descents[0]!.endIndex).toBe(500) // the lowest sample
    expect(descents[0]!.meanVSpeed).toBeCloseTo(-1800, 6)
  })

  it('excludes paused time from the descent mean', () => {
    // Summit standstill: 500 s up, 100 s pause at the top, 500 s down (6 m/s).
    const up = ramp(500, 6, 0.5)
    const top = up.altitude[up.altitude.length - 1]!
    const time = [...up.time]
    const distance = [...up.distance]
    const altitude = [...up.altitude]
    for (let t = 1; t <= 500; t++) {
      time.push(500 + t)
      distance.push((500 + t) * 6)
      altitude.push(top - t * 0.5)
    }
    const s = insertPause(withLatlng({ time, distance, altitude }), 500, 100)
    const pauses = detectPauses(s.time, s.latlng, s.distance, { thresholdS: 30 })
    expect(pauses).toHaveLength(1)

    const descents = detectDescents(s.time, s.distance, s.altitude, { ...OPTS, pauses })
    expect(descents).toHaveLength(1)
    // The descent opens at the summit sample; its 100 s standstill is excluded:
    // -250 m over 500 effective seconds = -1800 m/h (vs -1500 raw).
    expect(descents[0]!.effectiveTimeS).toBe(500)
    expect(descents[0]!.meanVSpeed).toBeCloseTo(-1800, 6)
  })

  it('handles empty and single-point streams', () => {
    expect(detectDescents([], [], [], OPTS)).toEqual([])
    expect(detectDescents([0], [0], [100], OPTS)).toEqual([])
  })
})
