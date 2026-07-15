import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type ActivityStreams } from '@stravaboard/shared'
import type { LineSeriesOption } from 'echarts'
import { buildChartOptions } from '../chart/buildChartOptions'

function climbStreams(): ActivityStreams {
  // 20 min climb at +0.5 m/s (1800 m/h), 1 m/s forward
  const time: number[] = []
  const distance: number[] = []
  const altitude: number[] = []
  for (let t = 0; t <= 1200; t++) {
    time.push(t)
    distance.push(t)
    altitude.push(500 + t * 0.5)
  }
  return { time, distance, altitude }
}

describe('buildChartOptions', () => {
  it('builds the four series with settings-derived names', () => {
    const options = buildChartOptions(climbStreams(), DEFAULT_SETTINGS)
    const series = options.series as LineSeriesOption[]
    expect(series.map((s) => s.name)).toEqual([
      'Instant (60s)',
      'Short (120s)',
      'Long (5min)',
      'Ascent mean',
    ])
    expect(series.every((s) => s.type === 'line')).toBe(true)
  })

  it('renders the ascent as horizontal segments at the mean speed', () => {
    const options = buildChartOptions(climbStreams(), DEFAULT_SETTINGS)
    const ascent = (options.series as LineSeriesOption[])[3]!
    const data = ascent.data as ([number, number] | null)[]
    // One climb -> start point, end point, null separator
    expect(data).toHaveLength(3)
    expect(data[0]![1]).toBeCloseTo(1800, 6)
    expect(data[1]![1]).toBeCloseTo(1800, 6)
    expect(data[2]).toBeNull()
  })

  it('reflects window changes from settings in names and values', () => {
    const options = buildChartOptions(climbStreams(), {
      ...DEFAULT_SETTINGS,
      shortWindowS: 90,
      longWindowS: 600,
    })
    const names = (options.series as LineSeriesOption[]).map((s) => s.name)
    expect(names).toContain('Short (90s)')
    expect(names).toContain('Long (10min)')
  })

  it('handles missing altitude as an empty chart rather than crashing', () => {
    const options = buildChartOptions({ time: [], distance: [], altitude: null }, DEFAULT_SETTINGS)
    const series = options.series as LineSeriesOption[]
    expect(series).toHaveLength(4)
    expect(series[0]!.data).toEqual([])
  })

  it('keeps x values in kilometers', () => {
    const options = buildChartOptions(climbStreams(), DEFAULT_SETTINGS)
    const short = (options.series as LineSeriesOption[])[1]!
    const data = short.data as ([number, number] | null)[]
    const last = data[data.length - 1]!
    expect(last![0]).toBeCloseTo(1.2, 6) // 1200 m = 1.2 km
  })
})
