import { describe, expect, it } from 'vitest'
import type { Ascent } from '../vspeed/ascents.js'
import { aggregateSegments } from '../vspeed/stats.js'

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
