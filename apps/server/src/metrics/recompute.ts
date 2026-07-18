import { activityMetrics, type ActivityStreams, type MetricParams } from '@stravaboard/shared'
import type { Db } from '../db/client.js'
import { listDoneActivityIds, setActivityMetrics } from '../repositories/activities.repo.js'
import { getStreams } from '../repositories/streams.repo.js'

/** The three stored sort/badge metrics for one activity. */
export interface StoredMetrics {
  meanVSpeed: number
  gainM: number
  descentLossM: number
}

/** "Computed, nothing rankable" — distinct from NULL ("not computed yet"). */
const UNRANKABLE: StoredMetrics = { meanVSpeed: 0, gainM: 0, descentLossM: 0 }

/**
 * The stored metrics for one stream set with the given `params`, defensively.
 * A single malformed stream set must never abort a sync or a settings save, so
 * any unexpected failure is logged and treated as unrankable (`0/0/0`). Shared
 * by the sync (`storeStreams`, `computeMissingMetrics`) and the settings-change
 * recompute so both compute the metric the exact same way.
 */
export function metricsFor(
  streams: ActivityStreams,
  params: MetricParams,
  log: (msg: string) => void = () => {},
): StoredMetrics {
  try {
    return activityMetrics(streams, params) ?? UNRANKABLE
  } catch (err) {
    log(`activity metric skipped: ${err instanceof Error ? err.message : String(err)}`)
    return UNRANKABLE
  }
}

/**
 * Recompute and re-store the metrics of every done activity for one athlete
 * using `params` (their current settings) — run after a metric-affecting
 * settings change so the sort, badges and list figures reflect the new
 * settings. Pure CPU, no API calls (the same guarantee as the sync's local
 * backfill).
 */
export function recomputeAllMetrics(
  db: Db,
  athleteId: number,
  params: MetricParams,
  log: (msg: string) => void = () => {},
): void {
  const ids = listDoneActivityIds(db, athleteId)
  if (ids.length === 0) return
  log(`recomputing metrics for ${ids.length} activities`)
  for (const id of ids) {
    const streams = getStreams(db, id)
    const { meanVSpeed, gainM, descentLossM } = streams
      ? metricsFor(streams, params, log)
      : UNRANKABLE
    setActivityMetrics(db, id, meanVSpeed, gainM, descentLossM)
  }
}
