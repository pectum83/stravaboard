import { detectAscents, detectDescents, type Ascent } from './ascents.js'
import { detectPauses } from './pauses.js'
import { despike, flattenNoiseBursts } from './smoothing.js'
import type { ActivityStreams, Settings } from '../types.js'

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
 * Default segment parameters for the stored per-activity metrics — kept in step
 * with the segment fields of `DEFAULT_SETTINGS`. Used when no settings are given
 * (see `STANDARD_METRIC_PARAMS`); each athlete's own settings override these via
 * `metricParamsFromSettings`, so a ranking reflects the same measurement the
 * athlete sees on their chart.
 */
export const STANDARD_SEGMENT_PARAMS = {
  minGainM: 30,
  descentToleranceM: 10,
  pauseThresholdS: 30,
  pauseRadiusM: 5,
} as const

/**
 * Default ascent lift/artefact cap (m/h): an ascent faster than this is treated
 * as non-human — a mechanical lift, or a GPS artefact that survived despiking —
 * and dropped from the ascent mean, the ranking metric and the badges. Slow
 * resort lifts run as low as ~1450 m/h, so the cap sits just below to catch
 * them. Equals the `liftMaxVSpeed` setting's default; the stored metric now uses
 * each athlete's own `liftMaxVSpeed` via `metricParamsFromSettings`. Descents are
 * never capped — see `partitionSegments` / `descentLossM`.
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
 * Segmentation parameters for the stored per-activity metrics. Defaults to
 * `STANDARD_METRIC_PARAMS`; the server passes each athlete's own settings via
 * `metricParamsFromSettings` so the stored ranking matches their chart.
 */
export interface MetricParams {
  /** Minimum gain for an ascent/descent segment to count, meters. */
  minGainM: number
  /** Maximum counter-move inside a segment before it ends, meters. */
  descentToleranceM: number
  /** Minimum stationary duration excluded from segment means, seconds. */
  pauseThresholdS: number
  /** Radius the position must stay within to count as stationary, meters. */
  pauseRadiusM: number
  /** Ascent lift/artefact cap (m/h); descents are never capped. */
  maxAscentVSpeed: number
}

/** Default metric parameters — the segment fields of `DEFAULT_SETTINGS`. */
export const STANDARD_METRIC_PARAMS: MetricParams = {
  ...STANDARD_SEGMENT_PARAMS,
  maxAscentVSpeed: MAX_HUMAN_VSPEED,
}

/**
 * Derive metric parameters from an athlete's settings so the stored ranking
 * metric is computed exactly like the chart's ascent/descent stats
 * (`computeVSpeedModel`). `liftMaxVSpeed` caps ascents only.
 */
export function metricParamsFromSettings(settings: Settings): MetricParams {
  return {
    minGainM: settings.ascentMinGainM,
    descentToleranceM: settings.ascentDescentToleranceM,
    pauseThresholdS: settings.pauseThresholdS,
    pauseRadiusM: settings.pauseRadiusM,
    maxAscentVSpeed: settings.liftMaxVSpeed,
  }
}

/** The stored per-activity sort/badge metrics. */
export interface ActivityMetrics {
  /** Mean ascent speed (m/h), 0 when no ascent qualifies. */
  meanVSpeed: number
  /** Total climbing gain (m) over the kept ascents, lift/artefact climbs excluded. */
  gainM: number
  /**
   * Total descent (m, positive) over every detected descent — deliberately NOT
   * speed-capped, so a fast alpine-ski descent counts in full (despiking,
   * noise-burst flattening + the min-gain hysteresis already reject sensor
   * noise). 0 when no descent qualifies.
   */
  descentLossM: number
}

/**
 * The stored per-activity metrics with the given segment `params` (default
 * `STANDARD_METRIC_PARAMS`). Despikes GPS altitude spikes and flattens
 * sustained noise bursts (submerged-watch garbage), then: for the ascent
 * metrics detects ascents and drops lift/artefact-fast segments (above
 * `params.maxAscentVSpeed`) before aggregating; for the descent total sums every
 * detected descent (no lift cap — see `descentLossM`). Returns `null` when the
 * activity has no altitude data or the streams don't line up (unrankable); all
 * metrics are `0` when altitude exists but nothing qualifies.
 */
export function activityMetrics(
  streams: ActivityStreams,
  params: MetricParams = STANDARD_METRIC_PARAMS,
): ActivityMetrics | null {
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
  // Despike first (isolated GPS spikes), then flatten sustained noise bursts
  // (submerged-watch garbage — a swim mid-hike) so a spike can't feed the
  // burst detector's both-ways sums.
  const altitude = flattenNoiseBursts(streams.time, despike(rawAltitude))
  const pauses = detectPauses(streams.time, streams.latlng, streams.distance, altitude, {
    thresholdS: params.pauseThresholdS,
    radiusM: params.pauseRadiusM,
  })
  const segmentOptions = {
    minGainM: params.minGainM,
    descentToleranceM: params.descentToleranceM,
    pauses,
  }
  const ascents = detectAscents(streams.time, streams.distance, altitude, segmentOptions)
  const ascentAgg = aggregateSegments(partitionSegments(ascents, params.maxAscentVSpeed).kept)
  // Descents keep every segment: a legitimately fast ski descent must count
  // toward D−, unlike ascents where a fast segment is a mechanical lift.
  const descents = detectDescents(streams.time, streams.distance, altitude, segmentOptions)
  // Descent gains are negative; report the magnitude. Math.abs also normalises
  // the −0 produced when there are no descents to a plain 0.
  const descentLossM = Math.abs(aggregateSegments(descents).totalGainM)
  return { meanVSpeed: ascentAgg.meanVSpeed ?? 0, gainM: ascentAgg.totalGainM, descentLossM }
}

/**
 * Whole-activity mean ascent speed (m/h) — the ranking metric behind the "Best
 * ascent speed" sort and badges. Thin wrapper over `activityMetrics`.
 */
export function activityAscentMean(
  streams: ActivityStreams,
  params: MetricParams = STANDARD_METRIC_PARAMS,
): number | null {
  return activityMetrics(streams, params)?.meanVSpeed ?? null
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
