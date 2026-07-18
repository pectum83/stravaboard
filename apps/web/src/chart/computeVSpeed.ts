import {
  aggregateSegments,
  despike,
  detectAscents,
  detectDescents,
  detectPauses,
  medianFilter,
  partitionSegments,
  windowedSlope,
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
  /** Terrain slope in % over the configured distance window. */
  slope: VSpeedPoint[]
  ascents: Ascent[]
  descents: Ascent[]
  /**
   * Lift / GPS-artefact climbs (faster than any human ascent), excluded from
   * `ascents` and the ascent stats. Descents are not capped — humans descend
   * far faster than they climb (skiing, running downhill).
   */
  excludedAscents: Ascent[]
  pauses: Pause[]
  ascentStats: SegmentAggregate
  descentStats: SegmentAggregate
}

/** Compute all vertical-speed series and aggregates once per streams+settings. */
export function computeVSpeedModel(streams: ActivityStreams, settings: Settings): VSpeedModel {
  const { time, distance } = streams
  // Despike once at the entry so every derivation (series, slope, segments)
  // sees GPS-artefact-free altitude; the instant series still median-filters
  // on top to tame remaining barometric jitter.
  const altitude = despike(streams.altitude ?? [])

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
  const slope = windowedSlope(distance, altitude, { windowM: settings.slopeWindowM })

  const pauses =
    time.length === 0
      ? []
      : detectPauses(time, streams.latlng, distance, { thresholdS: settings.pauseThresholdS })
  const segmentOptions = {
    minGainM: settings.ascentMinGainM,
    descentToleranceM: settings.ascentDescentToleranceM,
    pauses,
  }
  // Split off lift / artefact climbs (faster than human) so the ascent stats
  // and the green ascent-mean series show real climbing only; the excluded ones
  // are drawn greyed so the exclusion is visible. Descents are never capped.
  const { kept: ascents, excluded: excludedAscents } = partitionSegments(
    detectAscents(time, distance, altitude, segmentOptions),
  )
  const descents = detectDescents(time, distance, altitude, segmentOptions)

  return {
    streams,
    instant,
    short,
    long,
    slope,
    ascents,
    descents,
    excludedAscents,
    pauses,
    ascentStats: aggregateSegments(ascents),
    descentStats: aggregateSegments(descents),
  }
}
