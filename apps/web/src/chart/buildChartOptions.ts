import type { EChartsOption, LineSeriesOption } from 'echarts'
import type { Ascent, Settings, VSpeedPoint } from '@stravaboard/shared'
import type { VSpeedModel } from './computeVSpeed'

// Categorical slots 1, 5, 4, 2, 3, 7 of the validated palette (see dataviz
// reference; orange failed the normal-vision floor next to magenta). Aqua,
// yellow and magenta sit below 3:1 on the light surface — the relief rule is
// covered by the direct end-labels on every series.
const COLORS = {
  instant: '#2a78d6', // blue
  short: '#1baf7a', // aqua
  long: '#eda100', // yellow
  ascent: '#008300', // green
  descent: '#e87ba4', // magenta
  slope: '#4a3aa7', // violet
}
const INK_MUTED = '#898781'
const GRID_LINE = '#e1e0d9'
const AXIS_LINE = '#c3c2b7'

export interface ChartOptionsOpts {
  /**
   * Phone-sized rendering: tighter grid margins and no series-name end
   * labels (the legend still identifies every series; per-segment value
   * labels stay). Legends wrap to two rows on narrow screens, hence the
   * larger top margin.
   */
  compact?: boolean
}

export function buildChartOptions(
  model: VSpeedModel,
  settings: Settings,
  { compact = false }: ChartOptionsOpts = {},
): EChartsOption {
  const series: LineSeriesOption[] = [
    lineSeries(`Instant (${settings.instantWindowS}s)`, toPairs(model.instant), COLORS.instant, {
      // The instant series is intrinsically spiky; keep it recessive so the
      // smoother series stay readable.
      lineStyle: { width: 1, opacity: 0.35 },
      sampling: 'lttb',
    }),
    lineSeries(`Short (${settings.shortWindowS}s)`, toPairs(model.short), COLORS.short, {}),
    lineSeries(
      `Long (${formatWindow(settings.longWindowS)})`,
      toPairs(model.long),
      COLORS.long,
      {},
    ),
    segmentSeries('Ascent mean', model.ascents, COLORS.ascent),
    segmentSeries('Descent mean', model.descents, COLORS.descent),
    // Terrain slope lives on its own % axis (index 1); dashed to signal the
    // different unit family.
    lineSeries(`Slope (${settings.slopeWindowM}m)`, toPairs(model.slope), COLORS.slope, {
      yAxisIndex: 1,
      lineStyle: { width: 1.5, type: 'dashed', opacity: 0.8 },
      sampling: 'lttb',
      tooltip: { valueFormatter: (v) => (typeof v === 'number' ? `${v.toFixed(1)} %` : '—') },
    }),
  ]

  if (compact) {
    for (const s of series) s.endLabel = { show: false }
  }

  return {
    animation: false,
    legend: {
      top: 0,
      icon: 'roundRect',
      itemWidth: 14,
      itemHeight: 4,
      textStyle: { color: '#52514e' },
    },
    grid: compact
      ? { left: 44, right: 54, top: 52, bottom: 40 }
      : { left: 64, right: 110, top: 36, bottom: 56 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', label: { precision: 1 } },
      valueFormatter: (v) => (typeof v === 'number' ? `${Math.round(v)} m/h` : '—'),
    },
    dataZoom: [{ type: 'inside', filterMode: 'none' }],
    xAxis: {
      type: 'value',
      name: 'km',
      // Centered below the axis — at the end it would collide with the
      // right-side % axis labels.
      nameLocation: 'middle',
      nameGap: 26,
      nameTextStyle: { color: INK_MUTED },
      max: 'dataMax',
      axisLabel: { color: INK_MUTED, formatter: (v: number) => `${Math.round(v * 10) / 10}` },
      axisLine: { lineStyle: { color: AXIS_LINE } },
      splitLine: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        // The wrapped two-row legend on phones would collide with the name.
        name: compact ? '' : 'm/h',
        nameTextStyle: { color: INK_MUTED },
        axisLabel: { color: INK_MUTED },
        axisLine: { show: false },
        splitLine: { lineStyle: { color: GRID_LINE } },
      },
      {
        type: 'value',
        position: 'right',
        // Shared zero line with the m/h axis so "flat" reads flat on both.
        alignTicks: true,
        // Unit lives in the labels — a top axis name would collide with the legend.
        axisLabel: { color: COLORS.slope, formatter: '{value} %' },
        axisLine: { show: false },
        splitLine: { show: false },
      },
    ],
    series,
  }
}

function toPairs(points: VSpeedPoint[]): ([number, number] | null)[] {
  return points.map((p) => (p.y === null ? null : [p.x, p.y]))
}

function lineSeries(
  name: string,
  data: LineSeriesOption['data'],
  color: string,
  extra: Partial<LineSeriesOption>,
): LineSeriesOption {
  return {
    name,
    type: 'line',
    data,
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

/**
 * Ascent/descent means render as one horizontal segment per detected climb
 * (nulls break the line), each labeled with its value at the right end.
 * Per-datapoint labels only render on symbols, so the series keeps invisible
 * symbols (`symbolSize: 0`) instead of `showSymbol: false`.
 */
function segmentSeries(name: string, segments: Ascent[], color: string): LineSeriesOption {
  const data: LineSeriesOption['data'] = []
  for (const s of segments) {
    data.push([s.startKm, s.meanVSpeed], {
      value: [s.endKm, s.meanVSpeed],
      label: {
        show: true,
        position: 'right',
        formatter: `${Math.round(s.meanVSpeed)}`,
        color,
        fontSize: 11,
      },
    })
    data.push(null as unknown as (typeof data)[number])
  }
  return {
    ...lineSeries(name, data, color, { lineStyle: { width: 3 } }),
    showSymbol: true,
    symbolSize: 0,
    // The legend identifies these series; a name endLabel would collide with
    // the last segment's value label.
    endLabel: { show: false },
  }
}

function formatWindow(seconds: number): string {
  return seconds % 60 === 0 ? `${seconds / 60}min` : `${seconds}s`
}
