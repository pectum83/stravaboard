import { detectAscents, type Ascent } from './ascents.js'
import { detectPauses } from './pauses.js'
import { despike } from './smoothing.js'
import type { ActivityStreams } from '../types.js'

/** Whole-activity aggregate over ascent (or descent) segments. */
export interface SegmentAggregate {
  /** Sum of segment gains, meters. Negative for descents. */
  totalGainM: number
  /** Sum of segment effective (pause-excluded) times, seconds. */
  totalTimeS: number
  /** Overall mean vertical speed, m/h, or null when there are no segments. */
  meanVSpeed: number | null
}

/**
 * Standard segment parameters used for the STORED per-activity ascent mean
 * (sorting and best-of badges). Deliberately independent from each user's
 * chart settings: a ranking is only meaningful when every activity is
 * measured the same way.
 */
export const STANDARD_SEGMENT_PARAMS = {
  minGainM: 30,
  descentToleranceM: 10,
  pauseThresholdS: 30,
} as const

/**
 * Ascent/descent segments faster than this (m/h, absolute) are treated as
 * non-human — a mechanical lift, or a GPS artefact that survived despiking —
 * and excluded from the ascent/descent means, the ranking metric and the
 * badges. Slow resort lifts run as low as ~1450 m/h, so the cap sits just below
 * to catch them. Fixed (like `STANDARD_SEGMENT_PARAMS`) so rankings stay
 * comparable across activities; the chart's cap is the tunable `liftMaxVSpeed`
 * setting, which defaults to this value.
 */
export const MAX_HUMAN_VSPEED = 1400

/**
 * Split segments into those within human vertical speed (`kept`) and those above
 * it (`excluded` — lifts / artefacts). Symmetric on |meanVSpeed|, so it also
 * catches artefact-driven fast descents.
 */
export function partitionSegments(
  segments: readonly Ascent[],
  maxAbsVSpeed = MAX_HUMAN_VSPEED,
): { kept: Ascent[]; excluded: Ascent[] } {
  const kept: Ascent[] = []
  const excluded: Ascent[] = []
  for (const s of segments) {
    if (Math.abs(s.meanVSpeed) > maxAbsVSpeed) excluded.push(s)
    else kept.push(s)
  }
  return { kept, excluded }
}

/**
 * Whole-activity mean ascent speed (m/h, pause-excluded) with the standard
 * parameters. Returns null when the activity has no altitude data, 0 when it
 * has altitude but no qualifying ascent.
 */
/** The stored per-activity ascent metrics. */
export interface AscentMetrics {
  /** Mean ascent speed (m/h), 0 when no ascent qualifies. */
  meanVSpeed: number
  /** Total climbing gain (m) over the kept ascents, lift/artefact climbs excluded. */
  gainM: number
}

/**
 * The stored ascent metrics (mean speed + lift-excluded climbing gain) with the
 * standard parameters. Despikes GPS altitude spikes, detects ascents, drops
 * lift/artefact-fast segments, and aggregates the rest. Returns `null` when the
 * activity has no altitude data or the streams don't line up (unrankable); both
 * metrics are `0` when altitude exists but no human ascent qualifies.
 */
export function activityAscentStats(streams: ActivityStreams): AscentMetrics | null {
  const rawAltitude = streams.altitude
  if (rawAltitude === null || rawAltitude.length === 0) return null
  // Segmentation needs time/distance/altitude to line up. Some activities carry
  // an altitude stream but a missing or partial distance stream (e.g. a manual
  // or indoor entry); those can't be measured consistently, so they don't rank.
  if (
    streams.time.length !== rawAltitude.length ||
    streams.distance.length !== rawAltitude.length
  ) {
    return null
  }
  const altitude = despike(rawAltitude)
  const pauses = detectPauses(streams.time, streams.latlng, streams.distance, {
    thresholdS: STANDARD_SEGMENT_PARAMS.pauseThresholdS,
  })
  const ascents = detectAscents(streams.time, streams.distance, altitude, {
    minGainM: STANDARD_SEGMENT_PARAMS.minGainM,
    descentToleranceM: STANDARD_SEGMENT_PARAMS.descentToleranceM,
    pauses,
  })
  const agg = aggregateSegments(partitionSegments(ascents).kept)
  return { meanVSpeed: agg.meanVSpeed ?? 0, gainM: agg.totalGainM }
}

/**
 * Whole-activity mean ascent speed (m/h) — the ranking metric behind the "Best
 * ascent speed" sort and badges. Thin wrapper over `activityAscentStats`.
 */
export function activityAscentMean(streams: ActivityStreams): number | null {
  return activityAscentStats(streams)?.meanVSpeed ?? null
}

/** Aggregate segments into a whole-activity mean: Σ gain / Σ effective time. */
export function aggregateSegments(segments: readonly Ascent[]): SegmentAggregate {
  let totalGainM = 0
  let totalTimeS = 0
  for (const s of segments) {
    totalGainM += s.gainM
    totalTimeS += s.effectiveTimeS
  }
  return {
    totalGainM,
    totalTimeS,
    meanVSpeed: totalTimeS > 0 ? (totalGainM / totalTimeS) * 3600 : null,
  }
}
