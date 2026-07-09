import type { EChartsOption, LineSeriesOption } from 'echarts'
import {
  detectAscents,
  medianFilter,
  windowedVerticalSpeed,
  type ActivityStreams,
  type Settings,
  type VSpeedPoint,
} from '@stravaboard/shared'

// Categorical slots 1-4 of the validated palette (see dataviz reference).
// Aqua and yellow sit below 3:1 on the light surface — the relief rule is
// covered by the direct end-labels on every series.
const COLORS = {
  instant: '#2a78d6', // blue
  short: '#1baf7a', // aqua
  long: '#eda100', // yellow
  ascent: '#008300', // green
}
const INK_MUTED = '#898781'
const GRID_LINE = '#e1e0d9'
const AXIS_LINE = '#c3c2b7'

/** Altitude median-filter width for the instant series (samples). */
const INSTANT_SMOOTHING = 5

export function buildChartOptions(streams: ActivityStreams, settings: Settings): EChartsOption {
  const { time, distance } = streams
  const altitude = streams.altitude ?? []

  const smoothed = medianFilter(altitude, INSTANT_SMOOTHING)
  const instant = windowedVerticalSpeed(time, distance, smoothed, {
    windowS: settings.instantWindowS,
  })
  const short = windowedVerticalSpeed(time, distance, altitude, {
    windowS: settings.shortWindowS,
  })
  const long = windowedVerticalSpeed(time, distance, altitude, {
    windowS: settings.longWindowS,
  })
  const ascents = detectAscents(time, distance, altitude, {
    minGainM: settings.ascentMinGainM,
    descentToleranceM: settings.ascentDescentToleranceM,
  })

  // Each ascent renders as one horizontal segment at its mean speed,
  // with a null between segments to break the line.
  const ascentData: ([number, number] | null)[] = []
  for (const a of ascents) {
    ascentData.push([a.startKm, a.meanVSpeed], [a.endKm, a.meanVSpeed], null)
  }

  const series: LineSeriesOption[] = [
    lineSeries(`Instant (${settings.instantWindowS}s)`, toPairs(instant), COLORS.instant, {
      // The instant series is intrinsically spiky; keep it recessive so the
      // smoother series stay readable.
      lineStyle: { width: 1, opacity: 0.35 },
      sampling: 'lttb',
    }),
    lineSeries(`Short (${settings.shortWindowS}s)`, toPairs(short), COLORS.short, {}),
    lineSeries(`Long (${formatWindow(settings.longWindowS)})`, toPairs(long), COLORS.long, {}),
    lineSeries('Ascent mean', ascentData, COLORS.ascent, {
      lineStyle: { width: 3 },
    }),
  ]

  return {
    animation: false,
    legend: {
      top: 0,
      icon: 'roundRect',
      itemWidth: 14,
      itemHeight: 4,
      textStyle: { color: '#52514e' },
    },
    grid: { left: 64, right: 110, top: 36, bottom: 56 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', label: { precision: 1 } },
      valueFormatter: (v) => (typeof v === 'number' ? `${Math.round(v)} m/h` : '—'),
    },
    dataZoom: [{ type: 'inside', filterMode: 'none' }],
    xAxis: {
      type: 'value',
      name: 'km',
      nameTextStyle: { color: INK_MUTED },
      max: 'dataMax',
      axisLabel: { color: INK_MUTED, formatter: (v: number) => `${Math.round(v * 10) / 10}` },
      axisLine: { lineStyle: { color: AXIS_LINE } },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      name: 'm/h',
      nameTextStyle: { color: INK_MUTED },
      axisLabel: { color: INK_MUTED },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: GRID_LINE } },
    },
    series,
  }
}

function toPairs(points: VSpeedPoint[]): ([number, number] | null)[] {
  return points.map((p) => (p.y === null ? null : [p.x, p.y]))
}

function lineSeries(
  name: string,
  data: ([number, number] | null)[],
  color: string,
  extra: Partial<LineSeriesOption>,
): LineSeriesOption {
  return {
    name,
    type: 'line',
    data: data as LineSeriesOption['data'],
    color,
    showSymbol: false,
    connectNulls: false,
    endLabel: {
      show: true,
      formatter: name,
      color,
      fontSize: 11,
      distance: 6,
    },
    labelLayout: { hideOverlap: true },
    lineStyle: { width: 2 },
    emphasis: { focus: 'series' },
    ...extra,
  }
}

function formatWindow(seconds: number): string {
  return seconds % 60 === 0 ? `${seconds / 60}min` : `${seconds}s`
}
