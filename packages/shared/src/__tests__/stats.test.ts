import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../types.js'
import type { Ascent } from '../vspeed/ascents.js'
import {
  activityAscentMean,
  activityMetrics,
  aggregateSegments,
  MAX_HUMAN_VSPEED,
  metricParamsFromSettings,
  partitionSegments,
  STANDARD_METRIC_PARAMS,
} from '../vspeed/stats.js'
import { flat, insertPause, noiseBurst, ramp, spike, withLatlng } from './fixtures.js'

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

describe('activityMetrics (mean speed + lift-excluded gain + total descent)', () => {
  it('reports the climbing gain of the kept ascents, with no descent', () => {
    // 200 m gained over 1000 s at a human 720 m/h.
    const stats = activityMetrics({ ...ramp(1000, 6, 0.2), latlng: null })
    expect(stats).not.toBeNull()
    expect(stats!.meanVSpeed).toBeCloseTo(720, 4)
    expect(stats!.gainM).toBeCloseTo(200, 4)
    expect(stats!.descentLossM).toBe(0)
  })

  it('excludes lift gain from the climbing total', () => {
    // 3240 m/h lift over 540 m — excluded, so every metric is 0.
    const stats = activityMetrics({ ...ramp(600, 6, 0.9), latlng: null })
    expect(stats).toEqual({ meanVSpeed: 0, gainM: 0, descentLossM: 0 })
  })

  it('measures total descent and does NOT speed-cap it (fast ski descents count)', () => {
    // 300 m drop over 600 s = −1800 m/h, above the human cap — still counted in
    // full, unlike an equally fast ascent which would be dropped as a lift.
    const stats = activityMetrics({ ...ramp(600, 6, -0.5), latlng: null })
    expect(stats!.descentLossM).toBeCloseTo(300, 4)
    expect(stats!.gainM).toBe(0)
    expect(stats!.meanVSpeed).toBe(0)
  })

  it('measures a plain descent loss (positive metres)', () => {
    const stats = activityMetrics({ ...ramp(1000, 6, -0.2), latlng: null })
    expect(stats!.descentLossM).toBeCloseTo(200, 4)
  })

  it('flattens a swim noise burst so it cannot inflate the descent total', () => {
    // Hike with a lake swim: climb 200 m at 720 m/h, rest at the lake while the
    // submerged watch writes ±60 m garbage for 300 s, then descend 200 m. Each
    // fake oscillation is a > minGain descent, so without flattening the burst
    // alone would add thousands of meters to D−.
    const time: number[] = []
    const distance: number[] = []
    const altitude: number[] = []
    let alt = 100
    for (let t = 0; t <= 2600; t++) {
      time.push(t)
      distance.push(t * 2)
      if (t < 1000) alt += 0.2
      else if (t >= 1600) alt -= 0.2
      altitude.push(alt)
    }
    const swim = noiseBurst({ time, distance, altitude }, 1150, 300, 60)
    const stats = activityMetrics({ ...swim, latlng: null })
    expect(stats!.gainM).toBeCloseTo(200, 0)
    expect(stats!.descentLossM).toBeCloseTo(200, 0)
    expect(stats!.meanVSpeed).toBeCloseTo(720, 0)
  })

  it('is null without altitude', () => {
    expect(
      activityMetrics({ time: [0, 1], distance: [0, 1], altitude: null, latlng: null }),
    ).toBeNull()
  })
})

describe('activityMetrics (custom parameters)', () => {
  it('defaults to STANDARD_METRIC_PARAMS, which mirrors DEFAULT_SETTINGS', () => {
    expect(metricParamsFromSettings(DEFAULT_SETTINGS)).toEqual(STANDARD_METRIC_PARAMS)
    const s = insertPause(withLatlng(ramp(1000, 6, 0.2)), 500, 100)
    expect(activityMetrics(s)).toEqual(activityMetrics(s, STANDARD_METRIC_PARAMS))
  })

  it('excludes a pause only when its threshold sits below the standstill', () => {
    // 200 m over 1000 s of climbing with a 100 s standstill inserted.
    const s = insertPause(withLatlng(ramp(1000, 6, 0.2)), 500, 100)
    // Threshold 30 s < 100 s standstill → excluded → 200 m / 1000 s = 720 m/h.
    const excluded = activityAscentMean(s, { ...STANDARD_METRIC_PARAMS, pauseThresholdS: 30 })
    // Threshold 150 s > 100 s standstill → counted → 200 m / 1100 s = 654.5 m/h.
    const counted = activityAscentMean(s, { ...STANDARD_METRIC_PARAMS, pauseThresholdS: 150 })
    expect(excluded).toBeCloseTo(720, 3)
    expect(counted).toBeCloseTo(654.545, 2)
    expect(excluded!).toBeGreaterThan(counted!)
  })

  it('honours the minimum-gain parameter', () => {
    const climb = { ...ramp(1000, 6, 0.2), latlng: null } // 200 m gain
    expect(activityMetrics(climb, { ...STANDARD_METRIC_PARAMS, minGainM: 30 })!.gainM).toBeCloseTo(
      200,
      4,
    )
    // A 250 m floor rejects the 200 m climb entirely.
    expect(activityMetrics(climb, { ...STANDARD_METRIC_PARAMS, minGainM: 250 })).toEqual({
      meanVSpeed: 0,
      gainM: 0,
      descentLossM: 0,
    })
  })

  it('honours the ascent lift cap', () => {
    const fast = { ...ramp(600, 6, 1200 / 3600), latlng: null } // 1200 m/h, 200 m
    expect(activityMetrics(fast, STANDARD_METRIC_PARAMS)!.meanVSpeed).toBeCloseTo(1200, 4)
    // A 1000 m/h cap treats the 1200 m/h climb as a lift → nothing rankable.
    expect(activityMetrics(fast, { ...STANDARD_METRIC_PARAMS, maxAscentVSpeed: 1000 })).toEqual({
      meanVSpeed: 0,
      gainM: 0,
      descentLossM: 0,
    })
  })
})
