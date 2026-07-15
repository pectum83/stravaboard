import {
  aggregateSegments,
  detectAscents,
  detectDescents,
  detectPauses,
  medianFilter,
  windowedVerticalSpeed,
  type ActivityStreams,
  type Ascent,
  type Pause,
  type SegmentAggregate,
  type Settings,
  type VSpeedPoint,
} from '@stravaboard/shared'

/** Altitude median-filter width for the instant series (samples). */
const INSTANT_SMOOTHING = 5

/** Everything the chart, stats and map derive from one activity's streams. */
export interface VSpeedModel {
  streams: ActivityStreams
  instant: VSpeedPoint[]
  short: VSpeedPoint[]
  long: VSpeedPoint[]
  ascents: Ascent[]
  descents: Ascent[]
  pauses: Pause[]
  ascentStats: SegmentAggregate
  descentStats: SegmentAggregate
}

/** Compute all vertical-speed series and aggregates once per streams+settings. */
export function computeVSpeedModel(streams: ActivityStreams, settings: Settings): VSpeedModel {
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

  const pauses =
    time.length === 0
      ? []
      : detectPauses(time, streams.latlng, distance, { thresholdS: settings.pauseThresholdS })
  const segmentOptions = {
    minGainM: settings.ascentMinGainM,
    descentToleranceM: settings.ascentDescentToleranceM,
    pauses,
  }
  const ascents = detectAscents(time, distance, altitude, segmentOptions)
  const descents = detectDescents(time, distance, altitude, segmentOptions)

  return {
    streams,
    instant,
    short,
    long,
    ascents,
    descents,
    pauses,
    ascentStats: aggregateSegments(ascents),
    descentStats: aggregateSegments(descents),
  }
}
