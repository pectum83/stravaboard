import { describe, expect, it } from 'vitest'
import type { Ascent } from '../vspeed/ascents.js'
import {
  activityAscentMean,
  aggregateSegments,
  MAX_HUMAN_VSPEED,
  partitionSegments,
} from '../vspeed/stats.js'
import { flat, insertPause, ramp, spike, withLatlng } from './fixtures.js'

function segment(gainM: number, effectiveTimeS: number): Ascent {
  return {
    startIndex: 0,
    endIndex: 1,
    gainM,
    meanVSpeed: (gainM / effectiveTimeS) * 3600,
    effectiveTimeS,
    startKm: 0,
    endKm: 1,
  }
}

describe('aggregateSegments', () => {
  it('computes the overall mean as total gain over total effective time', () => {
    // 300 m in 600 s + 100 m in 600 s = 400 m in 1200 s = 1200 m/h
    const agg = aggregateSegments([segment(300, 600), segment(100, 600)])
    expect(agg.totalGainM).toBe(400)
    expect(agg.totalTimeS).toBe(1200)
    expect(agg.meanVSpeed).toBeCloseTo(1200, 6)
  })

  it('keeps descent aggregates negative', () => {
    const agg = aggregateSegments([segment(-500, 1000)])
    expect(agg.totalGainM).toBe(-500)
    expect(agg.meanVSpeed).toBeCloseTo(-1800, 6)
  })

  it('returns a null mean when there are no segments', () => {
    expect(aggregateSegments([])).toEqual({ totalGainM: 0, totalTimeS: 0, meanVSpeed: null })
  })
})

describe('partitionSegments', () => {
  it('keeps human-speed segments and excludes faster ones (both directions)', () => {
    const human = segment(200, 600) // 1200 m/h
    const lift = segment(300, 600) // 1800 m/h
    const artefactDrop = segment(-300, 600) // -1800 m/h
    const { kept, excluded } = partitionSegments([human, lift, artefactDrop])
    expect(kept).toEqual([human])
    expect(excluded).toEqual([lift, artefactDrop])
  })

  it('defaults its threshold to MAX_HUMAN_VSPEED', () => {
    const justUnder = segment(MAX_HUMAN_VSPEED - 1, 3600) // (MAX-1) m/h
    const justOver = segment(MAX_HUMAN_VSPEED + 1, 3600)
    expect(partitionSegments([justUnder, justOver])).toEqual({
      kept: [justUnder],
      excluded: [justOver],
    })
  })
})

describe('activityAscentMean (standard parameters)', () => {
  it('computes the pause-excluded mean of a climb', () => {
    // 200 m gain over 1000 s + a 100 s standstill → 720 m/h effective (human).
    const s = insertPause(withLatlng(ramp(1000, 6, 0.2)), 500, 100)
    expect(activityAscentMean(s)).toBeCloseTo(720, 4)
  })

  it('excludes a mechanical lift (faster than any human climb)', () => {
    // 0.9 m/s vertical = 3240 m/h over 540 m — a lift; no human ascent remains.
    const lift = { ...ramp(600, 6, 0.9), latlng: null }
    expect(activityAscentMean(lift)).toBe(0)
  })

  it('despikes a GPS artefact so a real climb is measured correctly', () => {
    // A steady climb with a +40 m bad-GPS spike partway up reads the same as the
    // clean climb (the spike is removed, not turned into a fake fast segment).
    const clean = { ...ramp(600, 6, 0.222), latlng: null }
    const spiked = { ...spike(ramp(600, 6, 0.222), 300, 40), latlng: null }
    expect(activityAscentMean(spiked)).toBeCloseTo(activityAscentMean(clean)!, 5)
  })

  it('is 0 with altitude but no qualifying ascent, null without altitude', () => {
    const f = flat(600)
    expect(activityAscentMean({ ...f, latlng: null })).toBe(0)
    expect(activityAscentMean({ time: [0, 1], distance: [0, 1], altitude: null, latlng: null })) //
      .toBeNull()
  })

  it('returns null (does not throw) when the distance stream is missing or mismatched', () => {
    const climb = ramp(1000, 6, 0.5)
    // Altitude present but distance empty (some manual/indoor entries): unrankable.
    expect(activityAscentMean({ ...climb, distance: [], latlng: null })).toBeNull()
    // Any other length disagreement is skipped rather than throwing.
    expect(
      activityAscentMean({ ...climb, distance: climb.distance.slice(0, -1), latlng: null }),
    ).toBeNull()
  })
})
