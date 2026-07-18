import {
  aggregateSegments,
  despike,
  detectAscents,
  detectDescents,
  detectPauses,
  flattenNoiseBursts,
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
  /** Total excluded-pause time across the whole activity, seconds. */
  pausedS: number
  ascentStats: SegmentAggregate
  descentStats: SegmentAggregate
}

/** An empty model — streams that can't be analysed render as a blank chart. */
function emptyModel(streams: ActivityStreams): VSpeedModel {
  const noSegments = aggregateSegments([])
  return {
    streams,
    instant: [],
    short: [],
    long: [],
    slope: [],
    ascents: [],
    descents: [],
    excludedAscents: [],
    pauses: [],
    pausedS: 0,
    ascentStats: noSegments,
    descentStats: noSegments,
  }
}

/** Compute all vertical-speed series and aggregates once per streams+settings. */
export function computeVSpeedModel(streams: ActivityStreams, settings: Settings): VSpeedModel {
  const { time, distance } = streams
  const rawAltitude = streams.altitude ?? []
  // Every derivation needs time/distance/altitude to line up. Some activities
  // carry an altitude stream with a missing or partial distance stream (manual
  // or broken entries); rather than throw deep in a windowing helper, render an
  // empty chart. (Empty streams line up trivially and flow through normally.)
  if (distance.length !== time.length || rawAltitude.length !== time.length) {
    return emptyModel(streams)
  }
  // Clean once at the entry so every derivation (series, slope, segments) sees
  // artefact-free altitude: despike isolated GPS spikes, then flatten sustained
  // noise bursts (submerged-watch garbage — a swim mid-hike). The instant
  // series still median-filters on top to tame remaining barometric jitter.
  const altitude = flattenNoiseBursts(time, despike(rawAltitude))

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
      : detectPauses(time, streams.latlng, distance, altitude, {
          thresholdS: settings.pauseThresholdS,
          radiusM: settings.pauseRadiusM,
        })
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
    settings.liftMaxVSpeed,
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
    pausedS: pauses.reduce((sum, p) => sum + p.durationS, 0),
    ascentStats: aggregateSegments(ascents),
    descentStats: aggregateSegments(descents),
  }
}
