import { describe, expect, it } from 'vitest'
import { detectAscents } from '../vspeed/ascents.js'
import { detectPauses } from '../vspeed/pauses.js'
import { flat, insertPause, ramp, sawtoothClimb, withLatlng } from './fixtures.js'

const OPTS = { minGainM: 30, descentToleranceM: 10 }

describe('detectAscents', () => {
  it('finds a single monotonic climb with its exact mean vertical speed', () => {
    // +0.5 m/s for 1000 s => 500 m gain, 1800 m/h
    const { time, distance, altitude } = ramp(1000, 1, 0.5)
    const ascents = detectAscents(time, distance, altitude, OPTS)
    expect(ascents).toHaveLength(1)
    const climb = ascents[0]!
    // The climb opens retroactively at its lowest point, so the full gain counts.
    expect(climb.gainM).toBeCloseTo(500, 6)
    expect(climb.meanVSpeed).toBeCloseTo(1800, 6)
    expect(climb.startIndex).toBe(0)
    expect(climb.endIndex).toBe(time.length - 1)
  })

  it('absorbs dips smaller than the tolerance into one ascent', () => {
    // 5 m dips every 120 s of climbing, tolerance 10 m
    const { time, distance, altitude } = sawtoothClimb(1200, 120, 5)
    const ascents = detectAscents(time, distance, altitude, OPTS)
    expect(ascents).toHaveLength(1)
  })

  it('splits the climb on dips larger than the tolerance', () => {
    // 15 m dips, tolerance 10 m -> each climbing leg is its own ascent
    const { time, distance, altitude } = sawtoothClimb(1200, 120, 15)
    const ascents = detectAscents(time, distance, altitude, OPTS)
    expect(ascents.length).toBeGreaterThan(1)
  })

  it('ignores bumps below minGain', () => {
    // 20 m gain < 30 m minGain
    const { time, distance, altitude } = ramp(40, 1, 0.5)
    expect(detectAscents(time, distance, altitude, OPTS)).toHaveLength(0)
  })

  it('finds nothing on flat ground or pure descent', () => {
    const flatStreams = flat(600)
    expect(detectAscents(flatStreams.time, flatStreams.distance, flatStreams.altitude, OPTS)) //
      .toHaveLength(0)
    const descent = ramp(600, 1, -0.5)
    expect(detectAscents(descent.time, descent.distance, descent.altitude, OPTS)).toHaveLength(0)
  })

  it('ends the ascent at its highest point, excluding the trailing descent', () => {
    // 500 s up (+0.5 m/s, 250 m), then 500 s down
    const up = ramp(500, 1, 0.5)
    const time = [...up.time]
    const distance = [...up.distance]
    const altitude = [...up.altitude]
    const topAlt = altitude[altitude.length - 1]!
    for (let t = 1; t <= 500; t++) {
      time.push(500 + t)
      distance.push(500 + t)
      altitude.push(topAlt - t * 0.5)
    }
    const ascents = detectAscents(time, distance, altitude, OPTS)
    expect(ascents).toHaveLength(1)
    expect(ascents[0]!.endIndex).toBe(500) // the summit sample
    expect(ascents[0]!.endKm).toBeCloseTo(0.5, 6)
  })

  it('excludes a small trailing descent when the stream ends inside it', () => {
    // 500 s up (+0.5 m/s), then a 5 m dip (< 10 m tolerance) ending the stream:
    // the climb still closes at the summit sample, not at the stream end.
    const up = ramp(500, 1, 0.5)
    const time = [...up.time]
    const distance = [...up.distance]
    const altitude = [...up.altitude]
    const topAlt = altitude[altitude.length - 1]!
    for (let t = 1; t <= 10; t++) {
      time.push(500 + t)
      distance.push(500 + t)
      altitude.push(topAlt - t * 0.5)
    }
    const ascents = detectAscents(time, distance, altitude, OPTS)
    expect(ascents).toHaveLength(1)
    expect(ascents[0]!.endIndex).toBe(500) // the summit sample
    expect(ascents[0]!.gainM).toBeCloseTo(250, 6)
    expect(ascents[0]!.meanVSpeed).toBeCloseTo(1800, 6) // dip time not counted
  })

  it('excludes paused time from the mean while keeping the gain', () => {
    // +0.5 m/s at 6 m/s horizontal for 1000 s, with a 100 s standstill in the
    // middle: 500 m gain, elapsed 1100 s, effective 1000 s.
    const s = insertPause(withLatlng(ramp(1000, 6, 0.5)), 500, 100)
    const pauses = detectPauses(s.time, s.latlng, s.distance, s.altitude, { thresholdS: 30 })
    expect(pauses).toEqual([{ startIndex: 500, endIndex: 600, durationS: 100 }])

    const raw = detectAscents(s.time, s.distance, s.altitude, OPTS)
    expect(raw[0]!.meanVSpeed).toBeCloseTo((500 / 1100) * 3600, 6)

    const ascents = detectAscents(s.time, s.distance, s.altitude, { ...OPTS, pauses })
    expect(ascents).toHaveLength(1)
    expect(ascents[0]!.gainM).toBeCloseTo(500, 6)
    expect(ascents[0]!.effectiveTimeS).toBe(1000)
    expect(ascents[0]!.meanVSpeed).toBeCloseTo(1800, 6)
  })

  it('does not subtract a pause that sits after the climb ends', () => {
    // Standstill at the summit, then a descent: the ascent closes at the
    // summit sample, so the pause overlaps it by zero seconds.
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
    const pauses = detectPauses(s.time, s.latlng, s.distance, s.altitude, { thresholdS: 30 })
    const ascents = detectAscents(s.time, s.distance, s.altitude, { ...OPTS, pauses })
    expect(ascents).toHaveLength(1)
    expect(ascents[0]!.effectiveTimeS).toBe(500)
    expect(ascents[0]!.meanVSpeed).toBeCloseTo(1800, 6)
  })

  it('handles empty and single-point streams', () => {
    expect(detectAscents([], [], [], OPTS)).toEqual([])
    expect(detectAscents([0], [0], [100], OPTS)).toEqual([])
  })

  it('rejects mismatched stream lengths', () => {
    expect(() => detectAscents([0, 1], [0], [100, 101], OPTS)).toThrow(/length mismatch/)
  })
})
