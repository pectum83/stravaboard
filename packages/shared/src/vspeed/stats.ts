import type { Ascent } from './ascents.js'

/** Whole-activity aggregate over ascent (or descent) segments. */
export interface SegmentAggregate {
  /** Sum of segment gains, meters. Negative for descents. */
  totalGainM: number
  /** Sum of segment effective (pause-excluded) times, seconds. */
  totalTimeS: number
  /** Overall mean vertical speed, m/h, or null when there are no segments. */
  meanVSpeed: number | null
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
