import { describe, expect, it } from 'vitest'
import { detectPauses, haversineM, pausedTimeInRange } from '../vspeed/pauses.js'
import { flat, insertPause, jitterLatlng, ramp, withLatlng } from './fixtures.js'

// 6 m/s tracks leave the 5 m radius in one sample, so detected pause
// boundaries are exact.
const OPTS = { thresholdS: 30 }

/** 1 Hz streams from a list of positions along a northward line (meters). */
function fromPositions(positions: number[]): {
  time: number[]
  distance: number[]
  latlng: [number, number][]
} {
  const M_PER_DEG_LAT = 111_320
  let travelled = 0
  const distance = positions.map((p, i) => {
    if (i > 0) travelled += Math.abs(p - positions[i - 1]!)
    return travelled
  })
  return {
    time: positions.map((_, i) => i),
    distance,
    latlng: positions.map((p): [number, number] => [45.1 + p / M_PER_DEG_LAT, 6.05]),
  }
}

/** `count` samples at `position`, appended to `out`. */
function hold(out: number[], position: number, count: number): void {
  for (let i = 0; i < count; i++) out.push(position)
}

/** Walk from the last position to `target` at `speedMS` (1 Hz). */
function walkTo(out: number[], target: number, speedMS: number): void {
  let pos = out[out.length - 1]!
  const step = Math.sign(target - pos) * speedMS
  while (Math.abs(target - pos) > speedMS / 2) {
    pos += step
    out.push(pos)
  }
}

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
    const pauses = detectPauses(s.time, s.latlng, s.distance, s.altitude, OPTS)
    expect(pauses).toEqual([{ startIndex: 100, endIndex: 160, durationS: 60 }])
  })

  it('treats a standstill of exactly the threshold as a pause', () => {
    const s = insertPause(withLatlng(ramp(200, 6, 0)), 100, 30)
    expect(detectPauses(s.time, s.latlng, s.distance, s.altitude, OPTS)).toHaveLength(1)
  })

  it('ignores a standstill shorter than the threshold', () => {
    const s = insertPause(withLatlng(ramp(200, 6, 0)), 100, 29)
    expect(detectPauses(s.time, s.latlng, s.distance, s.altitude, OPTS)).toHaveLength(0)
  })

  it('still detects the pause under GPS jitter within the radius', () => {
    const s = insertPause(withLatlng(ramp(200, 6, 0)), 100, 60)
    const pauses = detectPauses(s.time, jitterLatlng(s.latlng, 2), s.distance, s.altitude, OPTS)
    expect(pauses).toHaveLength(1)
    expect(pauses[0]!.durationS).toBeGreaterThanOrEqual(60)
  })

  it('does not flag slow continuous movement as a pause', () => {
    // 1 m/s leaves the 5 m radius in 6 s, far below the 30 s threshold.
    const s = withLatlng(flat(600))
    expect(detectPauses(s.time, s.latlng, s.distance, s.altitude, OPTS)).toHaveLength(0)
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
    const pauses = detectPauses(time, latlng, distance, null, OPTS)
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
    expect(detectPauses(time, latlng, distance, null, OPTS)).toHaveLength(0)
  })

  it('falls back to the distance stream when latlng is null', () => {
    const s = insertPause(withLatlng(ramp(200, 6, 0)), 100, 60)
    const pauses = detectPauses(s.time, null, s.distance, s.altitude, OPTS)
    expect(pauses).toEqual([{ startIndex: 100, endIndex: 160, durationS: 60 }])
  })

  it('falls back when latlng is empty or its length mismatches', () => {
    const s = insertPause(withLatlng(ramp(200, 6, 0)), 100, 60)
    expect(detectPauses(s.time, [], s.distance, s.altitude, OPTS)).toHaveLength(1)
    expect(detectPauses(s.time, s.latlng.slice(0, 5), s.distance, s.altitude, OPTS)).toHaveLength(1)
  })

  it('handles empty and single-point streams', () => {
    expect(detectPauses([], null, [], null, OPTS)).toEqual([])
    expect(detectPauses([0], [[45, 6]], [0], null, OPTS)).toEqual([])
  })

  it('rejects mismatched time/distance lengths', () => {
    expect(() => detectPauses([0, 1], null, [0], null, OPTS)).toThrow(/length mismatch/)
  })

  describe('merging (one break, not a string of fragments)', () => {
    it('folds a rest interrupted by a short nearby wander into ONE pause spanning the bridge', () => {
      // Sit 40 s, stroll 12 m in 4 s (photo), sit 40 s, then leave at 6 m/s.
      const positions: number[] = []
      hold(positions, 0, 40)
      walkTo(positions, 12, 3)
      hold(positions, 12, 40)
      walkTo(positions, 200, 6)
      const s = fromPositions(positions)

      const pauses = detectPauses(s.time, s.latlng, s.distance, null, OPTS)
      expect(pauses).toHaveLength(1)
      // One break from the first stationary sample to the last, bridge included.
      expect(pauses[0]!.durationS).toBeGreaterThanOrEqual(80)
      expect(pauses[0]!.startIndex).toBe(0)
    })

    it('merges sub-threshold fragments into a break that passes the threshold', () => {
      // 20 s + 22 s stops around a 12 m wander: each fragment alone is below the
      // 30 s threshold, the merged break is not.
      const positions: number[] = []
      hold(positions, 0, 21)
      walkTo(positions, 12, 3)
      hold(positions, 12, 21)
      walkTo(positions, 200, 6)
      const s = fromPositions(positions)

      const pauses = detectPauses(s.time, s.latlng, s.distance, null, OPTS)
      expect(pauses).toHaveLength(1)
      expect(pauses[0]!.durationS).toBeGreaterThanOrEqual(40)
    })

    it('does NOT merge stops separated by real travel (stop-and-go)', () => {
      // 60 s stop, 200 m of riding in 20 s, 60 s stop: two distinct pauses.
      const positions: number[] = []
      hold(positions, 0, 60)
      walkTo(positions, 200, 10)
      hold(positions, 200, 60)
      walkTo(positions, 400, 10)
      const s = fromPositions(positions)

      const pauses = detectPauses(s.time, s.latlng, s.distance, null, OPTS)
      expect(pauses).toHaveLength(2)
    })

    it('does NOT merge across a long moving bridge even when it returns nearby', () => {
      // 60 s stop, ~90 s wandering loop away and back, 60 s stop at 6 m from the
      // first: the bridge exceeds the merge gap, so these stay two pauses.
      const positions: number[] = []
      hold(positions, 0, 60)
      walkTo(positions, 150, 3.2) // ~46 s out
      walkTo(positions, 6, 3.2) // ~45 s back
      hold(positions, 6, 60)
      walkTo(positions, 300, 6)
      const s = fromPositions(positions)

      const pauses = detectPauses(s.time, s.latlng, s.distance, null, OPTS)
      expect(pauses).toHaveLength(2)
    })
  })

  describe('radius', () => {
    it('honours a smaller radius: 3 m of jitter breaks a 2 m radius but not a 5 m one', () => {
      // Stand 60 s while the GPS alternates between two fixes 3 m apart.
      const positions: number[] = []
      for (let i = 0; i < 60; i++) positions.push(i % 2 === 0 ? 0 : 3)
      walkTo(positions, 300, 6)
      const s = fromPositions(positions)
      // The distance stream integrates the jitter — irrelevant here, use latlng only.
      const still = s.distance.map(() => 0)

      expect(
        detectPauses(s.time, s.latlng, still, null, { thresholdS: 30, radiusM: 5 }),
      ).toHaveLength(1)
      expect(
        detectPauses(s.time, s.latlng, still, null, { thresholdS: 30, radiusM: 2 }),
      ).toHaveLength(0)
    })
  })

  describe('validation', () => {
    it('rejects a dead-GPS artefact: frozen track while the path advances', () => {
      // GPS never locked — latlng is a single repeated point — but the distance
      // stream shows 594 m of real movement. Not a standstill.
      const n = 100
      const time = Array.from({ length: n }, (_, i) => i)
      const distance = Array.from({ length: n }, (_, i) => i * 6)
      const latlng = Array.from({ length: n }, () => [45.1, 6.05] as [number, number])
      const altitude = Array.from({ length: n }, () => 100) // flat → isolates the dead-GPS rule
      expect(detectPauses(time, latlng, distance, altitude, OPTS)).toEqual([])
    })

    it('keeps a real rest that ends back at its start (not mistaken for frozen GPS)', () => {
      // Jittering rest whose track returns to the anchor while the distance
      // stream creeps 35 m: the spread (~3 m) proves the GPS was live.
      const positions: number[] = []
      for (let i = 0; i < 90; i++) positions.push([0, 3, 1][i % 3]!)
      walkTo(positions, 300, 6)
      const s = fromPositions(positions)
      const creep = s.time.map((_, i) => (i < 90 ? i * 0.4 : 36 + (i - 90) * 6))

      const pauses = detectPauses(s.time, s.latlng, creep, null, OPTS)
      expect(pauses).toHaveLength(1)
      expect(pauses[0]!.durationS).toBeGreaterThanOrEqual(85)
    })

    it('rejects slow vertical movement misread as a horizontal standstill', () => {
      // Horizontally still (a few metres over 99 s) but climbing 20 m — a steep
      // grind, not a rest.
      const n = 100
      const time = Array.from({ length: n }, (_, i) => i)
      const distance = Array.from({ length: n }, (_, i) => i * 0.02) // ~2 m total
      const latlng = Array.from({ length: n }, (_, i) => {
        // ±1.5 m live jitter so the frozen-GPS rule does not apply.
        const wobble = (i % 2 === 0 ? 1.5 : -1.5) / 111_320
        return [45.1 + wobble, 6.05] as [number, number]
      })
      const altitude = Array.from({ length: n }, (_, i) => 100 + i * 0.2) // +19.8 m
      expect(detectPauses(time, latlng, distance, altitude, OPTS)).toEqual([])
    })

    it('scales the vertical tolerance with duration so short grinds are caught too', () => {
      // 40 s "pause" gaining 6 m: under the old fixed 10 m bar this passed; the
      // rate-scaled bar (max(5, 0.05·40) = 5 m) rejects it.
      const n = 41
      const time = Array.from({ length: n }, (_, i) => i)
      const distance = Array.from({ length: n }, (_, i) => i * 0.05)
      const latlng = Array.from({ length: n }, (_, i) => {
        const wobble = (i % 2 === 0 ? 1.5 : -1.5) / 111_320
        return [45.1 + wobble, 6.05] as [number, number]
      })
      const altitude = Array.from({ length: n }, (_, i) => 100 + i * 0.15) // +6 m
      expect(detectPauses(time, latlng, distance, altitude, OPTS)).toEqual([])
    })

    it('keeps a real rest whose altitude only drifts within tolerance', () => {
      const s = insertPause(withLatlng(ramp(200, 6, 0)), 100, 60)
      // Barometric drift of +4 m across the frozen pause (indices 100..160): a
      // real rest, kept (below the max(5 m, 0.05·60 = 3 m) bar).
      const altitude = s.altitude.map((a, idx) =>
        idx >= 100 && idx <= 160 ? a + (4 * (idx - 100)) / 60 : a,
      )
      expect(detectPauses(s.time, s.latlng, s.distance, altitude, OPTS)).toHaveLength(1)
    })

    it('allows more altitude drift on long rests (rate-scaled)', () => {
      // A 20 min lunch with 8 m of barometric drift stays a pause
      // (8 < 0.05·1200 = 60 m), while the fixed floor alone would reject it.
      const s = insertPause(withLatlng(ramp(200, 6, 0)), 100, 1200)
      const altitude = s.altitude.map((a, idx) =>
        idx >= 100 && idx <= 1300 ? a + (8 * (idx - 100)) / 1200 : a,
      )
      const pauses = detectPauses(s.time, s.latlng, s.distance, altitude, {
        thresholdS: 60,
      })
      expect(pauses).toHaveLength(1)
      expect(pauses[0]!.durationS).toBe(1200)
    })
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
