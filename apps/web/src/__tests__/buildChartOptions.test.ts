import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type ActivityStreams } from '@stravaboard/shared'
import type { LineSeriesOption } from 'echarts'
import { buildChartOptions } from '../chart/buildChartOptions'
import { computeVSpeedModel } from '../chart/computeVSpeed'

function climbStreams(): ActivityStreams {
  // 20 min human climb at +0.2 m/s (720 m/h) then 10 min descent at -1 m/s
  // (-3600 m/h), 1 m/s forward.
  const time: number[] = []
  const distance: number[] = []
  const altitude: number[] = []
  for (let t = 0; t <= 1800; t++) {
    time.push(t)
    distance.push(t)
    altitude.push(t <= 1200 ? 500 + t * 0.2 : 740 - (t - 1200))
  }
  return { time, distance, altitude, latlng: null }
}

/** A lift-speed climb (0.9 m/s ≈ 3240 m/h) that must be excluded. */
function liftStreams(): ActivityStreams {
  const time: number[] = []
  const distance: number[] = []
  const altitude: number[] = []
  for (let t = 0; t <= 600; t++) {
    time.push(t)
    distance.push(6 * t)
    altitude.push(1000 + 0.9 * t)
  }
  return { time, distance, altitude, latlng: null }
}

/** A climb, a 60 s standstill (frozen position), then more climb — one pause. */
function pausedStreams(): ActivityStreams {
  const time: number[] = []
  const distance: number[] = []
  const altitude: number[] = []
  let t = 0
  let d = 0
  let a = 500
  const step = () => {
    time.push(t)
    distance.push(d)
    altitude.push(a)
    t++
  }
  for (let i = 0; i < 120; i++) {
    step()
    d += 6
    a += 0.3
  } // moving up to 720 m along
  for (let i = 0; i < 60; i++) step() // 60 s standstill (position + altitude frozen)
  for (let i = 0; i < 120; i++) {
    step()
    d += 6
    a += 0.3
  } // moving up again
  return { time, distance, altitude, latlng: null }
}

function options(streams = climbStreams(), settings = DEFAULT_SETTINGS) {
  return buildChartOptions(computeVSpeedModel(streams, settings), settings)
}

describe('buildChartOptions', () => {
  it('builds the six series with settings-derived names', () => {
    const series = options().series as LineSeriesOption[]
    expect(series.map((s) => s.name)).toEqual([
      'Instant (60s)',
      'Short (120s)',
      'Long (5min)',
      'Ascent mean',
      'Descent mean',
      'Slope (100m)',
    ])
    expect(series.every((s) => s.type === 'line')).toBe(true)
  })

  it('puts the slope series on its own % axis with correct grades', () => {
    const opts = options()
    expect(opts.yAxis).toHaveLength(2)
    const percentAxis = (opts.yAxis as { axisLabel: { formatter: string } }[])[1]!
    expect(percentAxis.axisLabel.formatter).toBe('{value} %')

    const slope = (opts.series as LineSeriesOption[])[5]!
    expect(slope.yAxisIndex).toBe(1)
    const data = slope.data as ([number, number] | null)[]
    // climb: +0.2 m per 1 m forward = 20 %; descent: -1 m per m = -100 %
    expect(data[600]![1]).toBeCloseTo(20, 6)
    expect(data[1500]![1]).toBeCloseTo(-100, 6)
  })

  it('renders the ascent as horizontal segments at the mean speed', () => {
    const ascent = (options().series as LineSeriesOption[])[3]!
    const data = ascent.data as ({ value: [number, number] } | [number, number] | null)[]
    // One climb -> start point, labeled end point, null separator
    expect(data).toHaveLength(3)
    expect((data[0] as [number, number])[1]).toBeCloseTo(720, 6)
    expect((data[1] as { value: [number, number] }).value[1]).toBeCloseTo(720, 6)
    expect(data[2]).toBeNull()
  })

  it('renders the descent mean as negative segments', () => {
    const descent = (options().series as LineSeriesOption[])[4]!
    const data = descent.data as ({ value: [number, number] } | [number, number] | null)[]
    expect(data).toHaveLength(3)
    expect((data[0] as [number, number])[1]).toBeCloseTo(-3600, 6)
    expect((data[1] as { value: [number, number] }).value[1]).toBeCloseTo(-3600, 6)
  })

  it('labels each segment with its rounded value at the right end', () => {
    const series = options().series as LineSeriesOption[]
    for (const [idx, expected] of [
      [3, '720'],
      [4, '-3600'],
    ] as const) {
      const end = (series[idx]!.data as { value?: unknown; label?: { formatter: string } }[])[1]!
      expect(end.label).toMatchObject({ show: true, position: 'right', formatter: expected })
    }
  })

  it('keeps invisible symbols on segment series so per-point labels render', () => {
    const series = options().series as LineSeriesOption[]
    for (const idx of [3, 4]) {
      expect(series[idx]!.showSymbol).toBe(true)
      expect(series[idx]!.symbolSize).toBe(0)
      // No name endLabel on segment series — it would collide with the last value label.
      expect(series[idx]!.endLabel).toEqual({ show: false })
    }
  })

  it('reflects window changes from settings in names and values', () => {
    const settings = { ...DEFAULT_SETTINGS, shortWindowS: 90, longWindowS: 600 }
    const names = (options(climbStreams(), settings).series as LineSeriesOption[]).map(
      (s) => s.name,
    )
    expect(names).toContain('Short (90s)')
    expect(names).toContain('Long (10min)')
  })

  it('handles missing altitude as an empty chart rather than crashing', () => {
    const series = options({ time: [], distance: [], altitude: null, latlng: null })
      .series as LineSeriesOption[]
    expect(series).toHaveLength(6)
    expect(series[0]!.data).toEqual([])
  })

  it('tightens margins and drops series-name end labels in compact mode', () => {
    const opts = buildChartOptions(
      computeVSpeedModel(climbStreams(), DEFAULT_SETTINGS),
      DEFAULT_SETTINGS,
      { compact: true },
    )
    expect(opts.grid).toEqual({ left: 44, right: 54, top: 52, bottom: 40 })
    const series = opts.series as LineSeriesOption[]
    expect(series.every((s) => (s.endLabel as { show: boolean }).show === false)).toBe(true)
    // Per-segment value labels survive compact mode.
    const ascentEnd = (series[3]!.data as { label?: { show: boolean } }[])[1]!
    expect(ascentEnd.label?.show).toBe(true)
  })

  it('adds a greyed excluded series only when lift/artefact segments exist', () => {
    const clean = (options().series as LineSeriesOption[]).map((s) => s.name)
    expect(clean).not.toContain('Excluded (lift/artefact)')
    expect(clean).toHaveLength(6)

    const withLift = options(liftStreams()).series as LineSeriesOption[]
    const names = withLift.map((s) => s.name)
    expect(names).toContain('Excluded (lift/artefact)')
    const idx = names.indexOf('Excluded (lift/artefact)')
    // Inserted just before the slope series, drawn in the muted grey.
    expect(names[idx + 1]).toBe('Slope (100m)')
    expect(withLift[idx]!.color).toBe('#898781')
    expect(withLift[idx]!.symbolSize).toBe(0)
  })

  it('marks each excluded pause on the baseline with its duration, only when pauses exist', () => {
    // No pauses in the plain climb → no Pauses series.
    expect((options().series as LineSeriesOption[]).map((s) => s.name)).not.toContain('Pauses')

    const series = options(pausedStreams()).series as LineSeriesOption[]
    const names = series.map((s) => s.name)
    const idx = names.indexOf('Pauses')
    expect(idx).toBeGreaterThan(-1)
    // Inserted just before the slope series.
    expect(names[idx + 1]).toBe('Slope (100m)')

    const pauses = series[idx]!
    expect(pauses.symbol).toBe('circle') // a round token
    expect(pauses.symbolSize).toBe(20)
    expect(pauses.color).toBe('#52514e') // neutral ink, not a categorical hue

    const data = pauses.data as ({ value: [number, number]; label: { formatter: string } } | null)[]
    const first = data[0] as { value: [number, number]; label: { formatter: string } }
    expect(first.value[1]).toBe(0) // sits on the baseline
    expect(first.value[0]).toBeCloseTo(0.72, 6) // pause at 720 m = 0.72 km
    expect(Number(first.label.formatter)).toBeGreaterThanOrEqual(30) // duration in seconds
    expect(data[1]).toBeNull() // points are null-separated (no connecting line)
  })

  it('keeps x values in kilometers', () => {
    const short = (options().series as LineSeriesOption[])[1]!
    const data = short.data as ([number, number] | null)[]
    const last = data[data.length - 1]!
    expect(last![0]).toBeCloseTo(1.8, 6) // 1800 m = 1.8 km
  })
})
