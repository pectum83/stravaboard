import { buildTcx, type TcxSport, type TcxStreams } from '@stravaboard/shared'
import type { Db } from '../db/client.js'
import { getActivity, upsertActivitySummary } from '../repositories/activities.repo.js'
import { getAthlete } from '../repositories/athletes.repo.js'
import { toActivityRow } from '../sync/syncService.js'
import type { StravaStreamSet, StravaSummaryActivity } from '../strava/types.js'
import {
  awaitUpload,
  ImportError,
  IMPORT_STREAM_KEYS,
  postUpload,
  type UploadDeps,
} from './stravaUpload.js'

export {
  ImportError,
  IMPORT_STREAM_KEYS,
  UPLOAD_POLL_MS,
  UPLOAD_TIMEOUT_MS,
  type ImportErrorCode,
} from './stravaUpload.js'

/**
 * Re-uploads one athlete's activity to another athlete's account, heart rate
 * included.
 *
 * Why a file upload: Strava's API cannot attach streams to an existing
 * activity, so an activity recorded on someone else's watch can only reach my
 * account as a new upload. The heart rate is the point — without it Strava
 * computes neither Relative Effort nor the fitness curve.
 */

export type ImportDeps = UploadDeps

export interface ImportRequest {
  /** Activity to copy, as it exists on the source account. */
  sourceActivityId: number
  /** Owner of that activity; read from the local row when omitted. */
  sourceAthleteId?: number
  /** Account the copy lands on. */
  targetAthleteId: number
  name?: string
  description?: string
  /** Build the TCX and stop — nothing is sent to Strava. */
  dryRun?: boolean
  /** Import even though the source has no heart rate (defeats the purpose). */
  allowMissingHeartrate?: boolean
}

export interface ImportSummary {
  sourceActivityId: number
  sourceAthleteId: number
  name: string
  startDate: string
  sportType: string
  distanceM: number
  elapsedTimeS: number
  totalElevationGainM: number
  points: number
  /** Null when the source carries no heart rate. */
  averageHeartrate: number | null
  maxHeartrate: number | null
}

export interface ImportResult {
  summary: ImportSummary
  tcx: string
  /** Null on a dry run. */
  activityId: number | null
  url: string | null
  /** True when Strava recognised the file as an earlier import of the same activity. */
  alreadyExisted: boolean
}

export async function importActivity(
  deps: ImportDeps,
  request: ImportRequest,
): Promise<ImportResult> {
  const { db, client } = deps
  const log = deps.log ?? ((): void => {})
  const sourceAthleteId =
    request.sourceAthleteId ?? getActivity(db, request.sourceActivityId)?.athleteId
  if (sourceAthleteId === undefined) {
    throw new ImportError(
      'unknown-source',
      `activity ${request.sourceActivityId} is not in the database; pass the source athlete id`,
    )
  }

  const activity = await client.getActivity(sourceAthleteId, request.sourceActivityId)
  const set = await client.getStreams(sourceAthleteId, request.sourceActivityId, IMPORT_STREAM_KEYS)
  const streams = toTcxStreams(set)
  if (streams === null) {
    throw new ImportError('no-streams', `activity ${activity.id} has no time stream to re-upload`)
  }
  if (streams.heartrate === undefined && request.allowMissingHeartrate !== true) {
    throw new ImportError(
      'no-heartrate',
      `activity ${activity.id} has no heart rate, which is the reason to import it`,
    )
  }

  const summary = summarize(activity, sourceAthleteId, streams)
  const tcx = buildTcx({
    startDate: activity.start_date,
    sport: tcxSport(activity.sport_type),
    totalTimeS: activity.elapsed_time,
    distanceM: activity.distance,
    calories: activity.calories,
    streams,
  })
  log(`built a ${tcx.length}-byte TCX from ${summary.points} points`)
  if (request.dryRun === true) {
    return { summary, tcx, activityId: null, url: null, alreadyExisted: false }
  }

  const name = request.name?.trim() || activity.name
  const description = request.description ?? defaultDescription(db, sourceAthleteId, activity.id)
  let activityId: number
  let alreadyExisted = false
  let created: StravaSummaryActivity
  try {
    const uploadId = await postUpload(deps, request.targetAthleteId, tcx, {
      name,
      description,
      externalId: externalIdFor(activity.id),
      commute: activity.commute === true,
      trainer: activity.trainer === true,
    })
    log(`upload ${uploadId} accepted, waiting for Strava to process it`)
    activityId = await awaitUpload(deps, request.targetAthleteId, uploadId)
    // TCX only knows Running/Biking/Other — never a Strava sport type — so the
    // upload always lands on the wrong type and needs this correction. A PUT
    // combining name and sport_type can drop the type (see SyncService.editActivity),
    // hence a type-only call: the name was already set by the upload.
    created = await client.updateActivity(request.targetAthleteId, activityId, {
      sport_type: activity.sport_type,
    })
  } catch (err) {
    // Re-importing is not a failure: the stable external_id means Strava
    // already turned this activity into that one. Adopt it instead.
    if (!(err instanceof ImportError) || err.duplicateActivityId === undefined) throw err
    activityId = err.duplicateActivityId
    alreadyExisted = true
    created = await client.getActivity(request.targetAthleteId, activityId)
    log(`already imported earlier as activity ${activityId}`)
  }

  // Store it locally right away: the incremental sync pages Strava with
  // `?after=<newest start date>`, so an activity uploaded today but STARTED
  // weeks ago is never returned and would stay invisible in stravaBoard.
  // 'pending' streams make the next sync pass fetch its streams and metrics.
  upsertActivitySummary(db, toActivityRow(request.targetAthleteId, created))

  return {
    summary,
    tcx,
    activityId,
    url: `https://www.strava.com/activities/${activityId}`,
    alreadyExisted,
  }
}

/**
 * Stable per-source-activity id: Strava rejects a second upload carrying it as
 * "duplicate of activity N", so a double click cannot create two copies.
 */
export function externalIdFor(sourceActivityId: number): string {
  return `stravaboard-import-${sourceActivityId}`
}

/** Strava sport type → the three sports the TCX schema allows (Run, TrailRun, …). */
export function tcxSport(sportType: string): TcxSport {
  if (/Run$/.test(sportType)) return 'Running'
  if (/Ride$/.test(sportType)) return 'Biking'
  return 'Other'
}

/** Null when the set has no time stream — nothing can be rebuilt without it. */
export function toTcxStreams(set: StravaStreamSet): TcxStreams | null {
  if (!set.time?.data?.length) return null
  return {
    time: set.time.data,
    ...(set.distance ? { distance: set.distance.data } : {}),
    ...(set.altitude ? { altitude: set.altitude.data } : {}),
    ...(set.latlng ? { latlng: set.latlng.data } : {}),
    ...(set.heartrate ? { heartrate: set.heartrate.data } : {}),
    ...(set.cadence ? { cadence: set.cadence.data } : {}),
  }
}

function summarize(
  activity: StravaSummaryActivity,
  sourceAthleteId: number,
  streams: TcxStreams,
): ImportSummary {
  const hr = streams.heartrate ?? []
  return {
    sourceActivityId: activity.id,
    sourceAthleteId,
    name: activity.name,
    startDate: activity.start_date,
    sportType: activity.sport_type,
    distanceM: activity.distance,
    elapsedTimeS: activity.elapsed_time,
    totalElevationGainM: activity.total_elevation_gain,
    points: streams.time.length,
    averageHeartrate: hr.length ? Math.round(hr.reduce((a, b) => a + b, 0) / hr.length) : null,
    maxHeartrate: hr.length ? Math.round(Math.max(...hr)) : null,
  }
}

function defaultDescription(db: Db, sourceAthleteId: number, sourceActivityId: number): string {
  const who = getAthlete(db, sourceAthleteId)?.displayName ?? `athlete ${sourceAthleteId}`
  return `Imported from ${who}'s watch (Strava activity ${sourceActivityId}).`
}
