import { describe, expect, it } from 'vitest'
import { haversineM } from '../vspeed/pauses.js'
import { BridgeError, mergeTcxStreams } from '../tcx/mergeStreams.js'
import type { BridgeOptions } from '../tcx/mergeStreams.js'
import type { TcxStreams } from '../tcx/buildTcx.js'

/**
 * Meters per degree of latitude for the sphere `haversineM` assumes. Walking a
 * meridian makes the ground truth exact: the haversine of a pure latitude
 * change is `R · Δlat`, so a fixture offset by `d / M_PER_DEG_LAT` degrees is
 * exactly `d` meters away — no tolerance juggling in the assertions.
 */
const M_PER_DEG_LAT = (6_371_000 * Math.PI) / 180
const LNG = 6

interface LegOptions {
  durationS: number
  speedMps: number
  startLat: number
  startAltM: number
  vSpeedMps?: number
  hr?: number
  cadence?: number
  startTimeS?: number
  startDistanceM?: number
}

/** One activity: a straight northward walk at 1 Hz, sampled with known ground truth. */
function leg(options: LegOptions): TcxStreams {
  const time: number[] = []
  const distance: number[] = []
  const altitude: number[] = []
  const latlng: [number, number][] = []
  const heartrate: number[] = []
  const cadence: number[] = []
  for (let t = 0; t <= options.durationS; t++) {
    const covered = t * options.speedMps
    time.push((options.startTimeS ?? 0) + t)
    distance.push((options.startDistanceM ?? 0) + covered)
    altitude.push(options.startAltM + t * (options.vSpeedMps ?? 0))
    latlng.push([options.startLat + covered / M_PER_DEG_LAT, LNG])
    heartrate.push(options.hr ?? 100)
    cadence.push(options.cadence ?? 50)
  }
  return { time, distance, altitude, latlng, heartrate, cadence }
}

/** A pair whose ends sit exactly `gapM` apart, with `gapS` of silence between them. */
function pair(gapM: number, gapS: number, overrides: Partial<LegOptions> = {}) {
  const first = leg({
    durationS: 600,
    speedMps: 1,
    startLat: 45,
    startAltM: 1000,
    hr: 130,
    ...overrides,
  })
  const endLat = 45 + 600 / M_PER_DEG_LAT
  const second = leg({
    durationS: 600,
    speedMps: 1,
    startLat: endLat + gapM / M_PER_DEG_LAT,
    startAltM: 950,
    hr: 110,
    cadence: 60,
  })
  return { first, second, offsetS: 600 + gapS }
}

function merge(gapM: number, gapS: number, options: Partial<BridgeOptions> = {}) {
  const { first, second, offsetS } = pair(gapM, gapS)
  return mergeTcxStreams(first, second, { offsetS, bowM: 0, ...options })
}

describe('mergeTcxStreams — shape of the result', () => {
  it('keeps both activities whole and reports what it inserted between them', () => {
    const { streams, bridge } = merge(1000, 1000, { pauseS: 440 })

    expect(streams.time).toHaveLength(601 + bridge.points + 601)
    expect(bridge.gapS).toBe(1000)
    expect(bridge.pauseS).toBe(440)
    expect(bridge.walkS).toBe(560)
    expect(streams.time.slice(0, 601)).toEqual([...Array(601).keys()])
  })

  it('offsets the second activity by exactly the start-date difference', () => {
    const { streams } = merge(1000, 1000, { pauseS: 440 })
    const second = streams.time.slice(-601)

    expect(second[0]).toBe(1600)
    expect(second.at(-1)).toBe(2200)
  })

  it('shifts the second activity past the bridge without a distance jump', () => {
    const { streams, bridge } = merge(1000, 1000, { pauseS: 440 })
    const second = streams.distance!.slice(-601)

    expect(bridge.lengthM).toBeCloseTo(1000, 6)
    expect(second[0]).toBeCloseTo(600 + 1000, 6)
    expect(second.at(-1)).toBeCloseTo(600 + 1000 + 600, 6)
  })

  it('never lets time stall or distance go backwards', () => {
    const { streams } = merge(1000, 1000, { pauseS: 440 })
    for (let i = 1; i < streams.time.length; i++) {
      expect(streams.time[i]!).toBeGreaterThan(streams.time[i - 1]!)
      expect(streams.distance![i]!).toBeGreaterThanOrEqual(streams.distance![i - 1]!)
    }
  })

  it('measures the bridge on the path it actually emits, bow included', () => {
    const straight = merge(1000, 1000, { pauseS: 440 })
    const bowed = merge(1000, 1000, { pauseS: 440, bowM: 20 })

    expect(bowed.bridge.lengthM).toBeGreaterThan(straight.bridge.lengthM)
    expect(bowed.bridge.lengthM).toBeCloseTo(1001, 0)
    expect(bowed.streams.distance!.slice(-601)[0]).toBeCloseTo(600 + bowed.bridge.lengthM, 6)
  })
})

describe('mergeTcxStreams — routing around the ground', () => {
  it('passes through the waypoints it is given', () => {
    const { first, second, offsetS } = pair(1000, 2000)
    // 200 m west of the straight line, halfway along it.
    const detour: [number, number] = [
      45 + (600 + 500) / M_PER_DEG_LAT,
      LNG - 200 / (M_PER_DEG_LAT * Math.cos((45 * Math.PI) / 180)),
    ]
    const merged = mergeTcxStreams(first, second, { offsetS, pauseS: 600, via: [detour] })
    const bridge = merged.streams.latlng!.slice(601, 601 + merged.bridge.points)
    const nearest = Math.min(...bridge.map((p) => haversineM(p, detour)))

    expect(nearest).toBeLessThan(5)
    expect(merged.bridge.lengthM).toBeGreaterThan(1050)
  })

  it('still lands exactly on both ends of a routed bridge', () => {
    const { first, second, offsetS } = pair(1000, 2000)
    const detour: [number, number] = [45 + 1100 / M_PER_DEG_LAT, LNG - 0.002]
    const merged = mergeTcxStreams(first, second, { offsetS, pauseS: 600, via: [detour] })
    const bridge = merged.streams.latlng!.slice(601, 601 + merged.bridge.points)

    expect(haversineM(bridge[0]!, first.latlng!.at(-1)!)).toBe(0)
    expect(haversineM(bridge.at(-1)!, second.latlng![0]!)).toBeLessThan(6)
  })

  it('keeps the walk gradual through a routed bridge', () => {
    const { first, second, offsetS } = pair(1000, 2000)
    const detour: [number, number] = [45 + 1100 / M_PER_DEG_LAT, LNG - 0.002]
    const { streams, bridge } = mergeTcxStreams(first, second, {
      offsetS,
      pauseS: 600,
      via: [detour],
    })
    for (let i = 602; i < 601 + bridge.points; i++) {
      const v =
        haversineM(streams.latlng![i - 1]!, streams.latlng![i]!) /
        (streams.time[i]! - streams.time[i - 1]!)
      expect(v).toBeLessThanOrEqual(bridge.vPlateauMps * 1.05)
    }
  })
})

describe('mergeTcxStreams — the standstill', () => {
  it('freezes position, altitude and distance for the whole pause', () => {
    const { streams, bridge } = merge(1000, 1000, { pauseS: 440, pauseSampleS: 30 })
    const start = 601
    const paused = streams.time.filter((t) => t > 600 && t <= 600 + bridge.pauseS).length

    expect(paused).toBeGreaterThan(10)
    for (let i = start; i < start + paused; i++) {
      expect(streams.latlng![i]).toEqual(streams.latlng![600])
      expect(streams.altitude![i]).toBe(streams.altitude![600])
      expect(streams.distance![i]).toBe(streams.distance![600])
      expect(streams.cadence![i]).toBe(0)
    }
  })

  it('samples the standstill sparsely and the walk densely', () => {
    const { streams, bridge } = merge(1000, 1000, { pauseS: 440, pauseSampleS: 30, sampleS: 4 })
    const inBridge = streams.time.slice(601, 601 + bridge.points)
    const pauseEnd = 600 + bridge.pauseS

    expect(inBridge.filter((t) => t < pauseEnd)).toHaveLength(Math.ceil(440 / 30) - 1)
    expect(inBridge.filter((t) => t >= pauseEnd)).toHaveLength(Math.ceil(560 / 4))
  })
})

describe('mergeTcxStreams — pace of the fabricated walk', () => {
  it('derives the plateau speed from the distance and the time left', () => {
    // 1000 m over a 560 s walk with 60 s ramps: the trapezoid covers v·(walk − ramp).
    const { bridge } = merge(1000, 1000, { pauseS: 440, rampS: 60 })

    expect(bridge.vPlateauMps).toBeCloseTo(1000 / 500, 6)
  })

  it('derives the pause from the speed, and the same speed back from that pause', () => {
    const fromSpeed = merge(1000, 2000, { cruiseSpeedMps: 1.15, rampS: 60 })
    const fromPause = merge(1000, 2000, { pauseS: fromSpeed.bridge.pauseS, rampS: 60 })

    expect(fromSpeed.bridge.pauseS).toBe(2000 - Math.round(1000 / 1.15) - 60)
    expect(fromPause.bridge.vPlateauMps).toBeCloseTo(fromSpeed.bridge.vPlateauMps, 6)
    expect(fromPause.bridge.walkS).toBe(fromSpeed.bridge.walkS)
  })

  it('falls back to a plain hiking pace when neither pause nor speed is given', () => {
    const { bridge } = merge(1000, 2000)

    expect(bridge.vPlateauMps).toBeCloseTo(1.15, 2)
    expect(bridge.pauseS).toBe(2000 - Math.round(1000 / 1.15) - 60)
  })

  it('walks at a flat speed when the ramps are switched off', () => {
    const { streams, bridge } = merge(1000, 1000, { pauseS: 440, rampS: 0 })

    expect(bridge.vPlateauMps).toBeCloseTo(1000 / 560, 6)
    const walk = streams.time.findIndex((t) => t > 600 + bridge.pauseS)
    const step = (i: number): number =>
      (streams.distance![i]! - streams.distance![i - 1]!) /
      (streams.time[i]! - streams.time[i - 1]!)

    // No ramps means the very first stride is already at the plateau speed.
    expect(step(walk)).toBeCloseTo(bridge.vPlateauMps, 6)
    expect(step(walk + 50)).toBeCloseTo(bridge.vPlateauMps, 6)
  })

  it('never moves faster than the plateau speed it announced', () => {
    const { streams, bridge } = merge(1000, 1000, { pauseS: 440 })
    const end = 601 + bridge.points
    for (let i = 601; i <= end; i++) {
      const seconds = streams.time[i]! - streams.time[i - 1]!
      const metres = streams.distance![i]! - streams.distance![i - 1]!
      expect(metres / seconds).toBeLessThanOrEqual(bridge.vPlateauMps + 1e-9)
    }
  })

  it('lands on the second activity without a teleport', () => {
    const { streams, bridge } = merge(1000, 1000, { pauseS: 440, sampleS: 4 })
    const last = 601 + bridge.points - 1
    const step = haversineM(streams.latlng![last]!, streams.latlng![last + 1]!)

    expect(step).toBeLessThanOrEqual(bridge.vPlateauMps * 4 + 0.5)
    expect(streams.distance![last + 1]! - streams.distance![last]!).toBeCloseTo(step, 1)
  })
})

describe('mergeTcxStreams — altitude', () => {
  it('invents no elevation gain by default', () => {
    const { streams, bridge } = merge(1000, 1000, { pauseS: 440 })
    const end = 601 + bridge.points
    let gain = 0
    for (let i = 601; i <= end; i++) {
      gain += Math.max(0, streams.altitude![i]! - streams.altitude![i - 1]!)
    }

    expect(bridge.elevationDeltaM).toBeCloseTo(-50, 6)
    expect(gain).toBe(0)
  })

  it('tapers an explicit ripple to zero where it meets the real samples', () => {
    const { streams, bridge } = merge(1000, 1000, { pauseS: 440, undulationM: 3 })
    const firstWalk = 601 + streams.time.slice(601).findIndex((t) => t >= 600 + bridge.pauseS)
    const end = 601 + bridge.points

    expect(streams.altitude![firstWalk]).toBeCloseTo(streams.altitude![600]!, 6)
    for (let i = 601; i < end; i++) {
      const fraction = (streams.distance![i]! - 600) / bridge.lengthM
      expect(Math.abs(streams.altitude![i]! - (1000 - 50 * fraction))).toBeLessThanOrEqual(3)
    }
  })
})

describe('mergeTcxStreams — heart rate and cadence', () => {
  it('recovers while still, climbs while walking, and lands on the next first beat', () => {
    const { streams, bridge } = merge(1000, 1000, { pauseS: 440 })
    const end = 601 + bridge.points
    const inBridge = streams.heartrate!.slice(601, end)

    expect(streams.heartrate![600]).toBe(130)
    expect(Math.min(...inBridge)).toBeLessThan(110)
    expect(streams.heartrate![end - 1]).toBe(110)
    for (let i = 601; i < end; i++) {
      expect(Math.abs(streams.heartrate![i]! - streams.heartrate![i - 1]!)).toBeLessThanOrEqual(10)
    }
  })

  it('reads the walking cadence off the real samples instead of assuming one', () => {
    const { streams, bridge } = merge(1000, 1000, { pauseS: 440 })
    const walking = streams.cadence!.slice(601, 601 + bridge.points)

    // The fixture's second activity walks at 60; nothing in the bridge exceeds it.
    expect(Math.max(...walking)).toBe(60)
    expect(walking[0]).toBe(0)
  })
})

describe('mergeTcxStreams — normalisation', () => {
  it('rebases a first activity whose time stream does not start at zero', () => {
    const first = leg({
      durationS: 600,
      speedMps: 1,
      startLat: 45,
      startAltM: 1000,
      startTimeS: 120,
    })
    const { second, offsetS } = pair(1000, 1000)
    const merged = mergeTcxStreams(first, second, { offsetS, bowM: 0, pauseS: 440 })

    // The offset is a start-date difference: samples that begin 120 s late
    // push the first activity's real end 120 s later, shrinking the gap.
    expect(merged.startShiftS).toBe(120)
    expect(merged.streams.time[0]).toBe(0)
    expect(merged.streams.time.at(-601)).toBe(1480)
    expect(merged.bridge.gapS).toBe(880)
  })

  it('rebases a second activity whose distance does not start at zero', () => {
    const { first, offsetS } = pair(1000, 1000)
    const second = leg({
      durationS: 600,
      speedMps: 1,
      startLat: 45 + (600 + 1000) / M_PER_DEG_LAT,
      startAltM: 950,
      startDistanceM: 4242,
    })
    const merged = mergeTcxStreams(first, second, { offsetS, bowM: 0, pauseS: 440 })

    expect(merged.streams.distance!.slice(-601)[0]).toBeCloseTo(600 + merged.bridge.lengthM, 6)
  })

  it('works on activities that carry neither heart rate nor cadence', () => {
    const { first, second, offsetS } = pair(1000, 1000)
    delete first.heartrate
    delete second.heartrate
    delete first.cadence
    delete second.cadence
    const merged = mergeTcxStreams(first, second, { offsetS, bowM: 0, pauseS: 440 })

    expect(merged.dropped).toEqual([])
    expect(merged.streams.heartrate).toBeUndefined()
    expect(merged.streams.cadence).toBeUndefined()
  })

  it('reads a representative heart rate from an even number of samples', () => {
    const { first, second, offsetS } = pair(1000, 1000)
    second.heartrate = second.heartrate!.map((_, i) => (i % 2 === 0 ? 100 : 120))
    const merged = mergeTcxStreams(first, second, { offsetS, bowM: 0, pauseS: 440 })
    const end = 601 + merged.bridge.points

    // Median of the alternating window is 110, so the walk settles there.
    expect(Math.max(...merged.streams.heartrate!.slice(700, end - 20))).toBeLessThanOrEqual(115)
  })

  it('drops a stream only one of the two activities carries', () => {
    const { first, second, offsetS } = pair(1000, 1000)
    delete second.heartrate
    const merged = mergeTcxStreams(first, second, { offsetS, bowM: 0, pauseS: 440 })

    expect(merged.dropped).toEqual(['heartrate'])
    expect(merged.streams.heartrate).toBeUndefined()
    expect(merged.streams.cadence).toHaveLength(merged.streams.time.length)
  })
})

describe('mergeTcxStreams — refusals', () => {
  const codeOf = (run: () => unknown): string => {
    try {
      run()
    } catch (err) {
      return err instanceof BridgeError ? err.code : `not a BridgeError: ${String(err)}`
    }
    return 'no error'
  }

  it('refuses a pause and a speed together', () => {
    expect(codeOf(() => merge(1000, 1000, { pauseS: 440, cruiseSpeedMps: 1.2 }))).toBe(
      'over-determined',
    )
  })

  it('refuses a fractional offset', () => {
    expect(codeOf(() => merge(1000, 1000, { offsetS: 1600.5, pauseS: 440 }))).toBe('bad-offset')
  })

  it('refuses activities that overlap', () => {
    expect(codeOf(() => merge(1000, -10, { pauseS: 0 }))).toBe('overlap')
  })

  it('refuses a missing or never-fixed position stream', () => {
    const { first, second, offsetS } = pair(1000, 1000)
    delete first.latlng
    expect(codeOf(() => mergeTcxStreams(first, second, { offsetS, pauseS: 440 }))).toBe('no-latlng')

    const { first: blind, second: other, offsetS: off } = pair(1000, 1000)
    blind.latlng = blind.latlng!.map(() => [0, 0])
    expect(codeOf(() => mergeTcxStreams(blind, other, { offsetS: off, pauseS: 440 }))).toBe(
      'no-latlng',
    )
  })

  it('refuses a missing distance stream', () => {
    const { first, second, offsetS } = pair(1000, 1000)
    delete first.distance
    expect(codeOf(() => mergeTcxStreams(first, second, { offsetS, pauseS: 440 }))).toBe(
      'no-distance',
    )
  })

  it('refuses ends that are implausibly far apart or on top of each other', () => {
    expect(codeOf(() => merge(9000, 20_000, { pauseS: 0 }))).toBe('implausible-bridge')
    expect(codeOf(() => merge(0.5, 1000, { pauseS: 440 }))).toBe('implausible-bridge')
  })

  it('refuses a bridge that would climb a cliff', () => {
    const { first, second, offsetS } = pair(100, 1000)
    second.altitude = second.altitude!.map((a) => a + 900)
    expect(codeOf(() => mergeTcxStreams(first, second, { offsetS, bowM: 0, pauseS: 440 }))).toBe(
      'implausible-bridge',
    )
  })

  it('refuses a pause that leaves a superhuman or a glacial walk', () => {
    expect(codeOf(() => merge(1000, 1000, { pauseS: 900 }))).toBe('implausible-speed')
    expect(codeOf(() => merge(1000, 200))).toBe('implausible-speed')
    expect(codeOf(() => merge(100, 3000, { pauseS: 0 }))).toBe('implausible-speed')
    expect(codeOf(() => merge(1000, 200, { pauseS: 0 }))).toBe('implausible-speed')
  })

  it('refuses streams that do not line up with their own time stream', () => {
    const { first, second, offsetS } = pair(1000, 1000)
    first.altitude = first.altitude!.slice(0, -1)
    expect(codeOf(() => mergeTcxStreams(first, second, { offsetS, pauseS: 440 }))).toBe(
      'misaligned',
    )
  })

  it('refuses a time stream that goes backwards', () => {
    const { first, second, offsetS } = pair(1000, 1000)
    first.time[300] = first.time[299]!
    expect(codeOf(() => mergeTcxStreams(first, second, { offsetS, pauseS: 440 }))).toBe(
      'not-increasing',
    )
  })
})
