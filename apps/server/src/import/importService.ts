import { buildTcx, type TcxSport, type TcxStreams } from '@stravaboard/shared'
import type { Config } from '../config.js'
import type { Db } from '../db/client.js'
import { getActivity } from '../repositories/activities.repo.js'
import { getAthlete } from '../repositories/athletes.repo.js'
import type { StravaClient } from '../strava/client.js'
import { ensureFreshToken, type FetchLike } from '../strava/oauth.js'
import type { StravaStreamSet, StravaSummaryActivity, StravaUpload } from '../strava/types.js'

/**
 * Re-uploads one athlete's activity to another athlete's account, heart rate
 * included.
 *
 * Why a file upload: Strava's API cannot attach streams to an existing
 * activity, so an activity recorded on someone else's watch can only reach my
 * account as a new upload. The heart rate is the point — without it Strava
 * computes neither Relative Effort nor the fitness curve.
 */

/** Stream kinds the TCX carries; a superset of what the sync stores. */
const IMPORT_STREAM_KEYS = 'time,distance,altitude,latlng,heartrate,cadence'

/** How long to wait for Strava to process the upload before giving up. */
const UPLOAD_TIMEOUT_MS = 90_000
const UPLOAD_POLL_MS = 2_000

export type ImportErrorCode =
  | 'unknown-source'
  | 'no-streams'
  | 'no-heartrate'
  | 'duplicate'
  | 'upload-failed'
  | 'upload-timeout'

export class ImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export interface ImportDeps {
  config: Config
  db: Db
  client: StravaClient
  fetchImpl?: FetchLike
  nowMs?: () => number
  sleep?: (ms: number) => Promise<void>
  log?: (message: string) => void
}

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
  if (request.dryRun === true) return { summary, tcx, activityId: null, url: null }

  const name = request.name?.trim() || activity.name
  const description = request.description ?? defaultDescription(db, sourceAthleteId, activity.id)
  const uploadId = await postUpload(deps, request.targetAthleteId, tcx, {
    name,
    description,
    externalId: externalIdFor(activity.id),
    commute: activity.commute === true,
    trainer: activity.trainer === true,
  })
  log(`upload ${uploadId} accepted, waiting for Strava to process it`)
  const activityId = await awaitUpload(deps, request.targetAthleteId, uploadId)

  // TCX only knows Running/Biking/Other — never a Strava sport type — so the
  // upload always lands on the wrong type and needs this correction. A PUT
  // combining name and sport_type can drop the type (see SyncService.editActivity),
  // hence a type-only call: the name was already set by the upload.
  await client.updateActivity(request.targetAthleteId, activityId, {
    sport_type: activity.sport_type,
  })
  return {
    summary,
    tcx,
    activityId,
    url: `https://www.strava.com/activities/${activityId}`,
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
function toTcxStreams(set: StravaStreamSet): TcxStreams | null {
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

interface UploadFields {
  name: string
  description: string
  externalId: string
  commute: boolean
  trainer: boolean
}

/**
 * POST /uploads is multipart, which StravaClient's JSON-only request helper
 * cannot express — hence the raw fetch, with the same token refresh and the
 * shared rate limiter kept up to date.
 */
async function postUpload(
  deps: ImportDeps,
  athleteId: number,
  tcx: string,
  fields: UploadFields,
): Promise<number> {
  const form = new FormData()
  form.set('file', new Blob([tcx], { type: 'application/xml' }), `${fields.externalId}.tcx`)
  form.set('data_type', 'tcx')
  form.set('name', fields.name)
  form.set('description', fields.description)
  form.set('external_id', fields.externalId)
  form.set('commute', fields.commute ? '1' : '0')
  form.set('trainer', fields.trainer ? '1' : '0')

  const body = await uploadRequest<StravaUpload>(deps, athleteId, '/uploads', {
    method: 'POST',
    body: form,
  })
  if (body.error) throw uploadError(body.error)
  return body.id
}

/** Poll until Strava turns the upload into an activity, it fails, or we give up. */
async function awaitUpload(deps: ImportDeps, athleteId: number, uploadId: number): Promise<number> {
  const nowMs = deps.nowMs ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const deadline = nowMs() + UPLOAD_TIMEOUT_MS
  for (;;) {
    await sleep(UPLOAD_POLL_MS)
    const body = await uploadRequest<StravaUpload>(deps, athleteId, `/uploads/${uploadId}`)
    if (body.error) throw uploadError(body.error)
    if (body.activity_id) return body.activity_id
    if (nowMs() >= deadline) {
      throw new ImportError(
        'upload-timeout',
        `Strava is still processing upload ${uploadId} (${body.status})`,
      )
    }
  }
}

function uploadError(message: string): ImportError {
  const duplicate = /duplicate/i.test(message)
  return new ImportError(duplicate ? 'duplicate' : 'upload-failed', message)
}

async function uploadRequest<T>(
  deps: ImportDeps,
  athleteId: number,
  path: string,
  init: { method?: string; body?: FormData } = {},
): Promise<T> {
  const { config, db, client } = deps
  const fetchImpl = deps.fetchImpl ?? fetch
  const nowMs = deps.nowMs ?? Date.now
  const token = await ensureFreshToken(config, db, athleteId, fetchImpl, () =>
    Math.floor(nowMs() / 1000),
  )
  const res = await fetchImpl(`${config.STRAVA_API_BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${token}` },
    ...(init.body ? { body: init.body } : {}),
  })
  client.rateLimiter.update(res.headers, nowMs())
  if (!res.ok) {
    throw new ImportError('upload-failed', `Strava upload API ${res.status}: ${await res.text()}`)
  }
  return (await res.json()) as T
}
