/**
 * Splices two consecutive Strava activities into one, filling the stretch the
 * watch never recorded.
 *
 * Why it is a re-upload and not an edit: Strava has no merge, and its API
 * cannot attach streams to an existing activity. The only way to turn one
 * interrupted outing back into one activity is to build a file covering the
 * whole thing and upload it.
 *
 * Why a snapshot: Strava refuses an upload that overlaps an existing activity,
 * and the merged file starts at the very second the first one did — so the two
 * originals have to be deleted from Strava *before* the merged file is
 * accepted. After that they can no longer be fetched, and the local database
 * is no help either: it stores neither heart rate nor cadence. So the first
 * pass writes everything it fetched to a snapshot file, and the pass that
 * actually uploads reads that file and calls nothing.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import {
  BridgeError,
  buildTcx,
  mergeTcxStreams,
  type BridgeOptions,
  type TcxStreams,
} from '@stravaboard/shared'
import { getActivity, upsertActivitySummary } from '../repositories/activities.repo.js'
import { NotFoundError } from '../strava/client.js'
import type { StravaStreamSet, StravaSummaryActivity } from '../strava/types.js'
import { toActivityRow } from '../sync/syncService.js'
import { tcxSport, toTcxStreams } from './importService.js'
import {
  awaitUpload,
  ImportError,
  IMPORT_STREAM_KEYS,
  postUpload,
  type UploadDeps,
} from './stravaUpload.js'

/** A merged file runs to thousands of points; Strava needs longer than for an import. */
const MERGE_UPLOAD_TIMEOUT_MS = 180_000
/** Samples of each real activity kept in the inspection GeoJSON either side of the bridge. */
const GEOJSON_CONTEXT_POINTS = 60

export type MergeErrorCode =
  /** Neither the request nor the local rows say who owns the activities. */
  | 'unknown-source'
  /** The two activities belong to different athletes. */
  | 'mixed-athletes'
  /** Strava still holds one of the originals, so the merge would be a duplicate. */
  | 'sources-still-present'
  /** One side has no heart rate, so the merged activity would lose it. */
  | 'heartrate-asymmetric'
  | 'snapshot-unreadable'

export class MergeError extends Error {
  constructor(
    readonly code: MergeErrorCode,
    message: string,
  ) {
    super(message)
  }
}

/** Everything the merge needs from Strava, frozen so it survives the deletions. */
export interface MergeSnapshot {
  athleteId: number
  first: { activity: StravaSummaryActivity; streams: StravaStreamSet }
  second: { activity: StravaSummaryActivity; streams: StravaStreamSet }
}

export interface MergeRequest {
  /** Fetch from Strava, or replay a snapshot written by an earlier dry run. */
  source:
    | { kind: 'strava'; firstActivityId: number; secondActivityId: number; athleteId?: number }
    | { kind: 'snapshot'; path: string }
  name?: string
  description?: string
  /** Suffix of the external id — bump it to re-upload a merge that came out wrong. */
  tag?: string
  /** Overrides the sport taken from the first activity. */
  sportType?: string
  bridge?: Omit<BridgeOptions, 'offsetS'>
  /** Build the file and stop; nothing is sent to Strava. */
  dryRun?: boolean
  /** Where to write the snapshot on a Strava-sourced run. */
  snapshotPath?: string
  /** Merge even though only one side has heart rate (the merged file loses it). */
  allowMissingHeartrate?: boolean
}

export interface MergeSummary {
  athleteId: number
  firstActivityId: number
  secondActivityId: number
  name: string
  sportType: string
  /** Start of the merged activity, ISO 8601 UTC. */
  startDate: string
  elapsedTimeS: number
  distanceM: number
  points: number
  /** Streams lost because only one of the two activities carried them. */
  dropped: string[]
  bridge: {
    gapS: number
    pauseS: number
    walkS: number
    vPlateauMps: number
    lengthM: number
    points: number
    elevationDeltaM: number
  }
}

export interface MergeResult {
  summary: MergeSummary
  tcx: string
  /** Three coloured lines — end of the first, the bridge, start of the second. */
  geojson: string
  snapshot: MergeSnapshot
  /** Null on a dry run. */
  activityId: number | null
  url: string | null
  /** True when Strava recognised the file as an earlier upload of the same merge. */
  alreadyExisted: boolean
}

export type MergeDeps = UploadDeps

export async function mergeActivities(
  deps: MergeDeps,
  request: MergeRequest,
): Promise<MergeResult> {
  const log = deps.log ?? ((): void => {})
  const snapshot =
    request.source.kind === 'snapshot'
      ? loadSnapshot(request.source.path)
      : await fetchSnapshot(deps, request.source)
  if (request.source.kind === 'strava' && request.snapshotPath !== undefined) {
    writeFileSync(request.snapshotPath, JSON.stringify(snapshot, null, 2))
    log(`wrote ${request.snapshotPath} — the only copy that carries heart rate and cadence`)
  }

  const { first, second } = snapshot
  const firstStreams = requireStreams(first)
  const secondStreams = requireStreams(second)
  if (
    (firstStreams.heartrate === undefined) !== (secondStreams.heartrate === undefined) &&
    request.allowMissingHeartrate !== true
  ) {
    throw new MergeError(
      'heartrate-asymmetric',
      'only one of the two activities has heart rate; the merge would drop it entirely',
    )
  }

  const offsetS = Math.round(
    (Date.parse(second.activity.start_date) - Date.parse(first.activity.start_date)) / 1000,
  )
  const merged = mergeTcxStreams(firstStreams, secondStreams, {
    ...request.bridge,
    offsetS,
  })
  const startDate = shiftIso(first.activity.start_date, merged.startShiftS)
  const sportType = request.sportType ?? first.activity.sport_type
  const name = request.name?.trim() || first.activity.name
  // The lap totals come from the merged samples, never from the summaries: a
  // summary's elapsed_time can outrun its own stream, and buildTcx never checks
  // the two against each other.
  const tcx = buildTcx({
    startDate,
    sport: tcxSport(sportType),
    totalTimeS: merged.streams.time[merged.streams.time.length - 1] ?? 0,
    distanceM: merged.streams.distance?.[merged.streams.distance.length - 1] ?? 0,
    ...(calories(first.activity, second.activity) === undefined
      ? {}
      : { calories: calories(first.activity, second.activity)! }),
    streams: merged.streams,
  })
  const summary: MergeSummary = {
    athleteId: snapshot.athleteId,
    firstActivityId: first.activity.id,
    secondActivityId: second.activity.id,
    name,
    sportType,
    startDate,
    elapsedTimeS: merged.streams.time[merged.streams.time.length - 1] ?? 0,
    distanceM: merged.streams.distance?.[merged.streams.distance.length - 1] ?? 0,
    points: merged.streams.time.length,
    dropped: merged.dropped,
    bridge: merged.bridge,
  }
  const geojson = inspectionGeoJson(merged.streams, firstStreams.time.length, merged.bridge.points)
  log(
    `built a ${tcx.length}-byte TCX: ${summary.points} points, bridge of ${merged.bridge.points}` +
      ` covering ${merged.bridge.lengthM.toFixed(0)} m in ${merged.bridge.gapS} s`,
  )
  if (request.dryRun === true) {
    return { summary, tcx, geojson, snapshot, activityId: null, url: null, alreadyExisted: false }
  }

  // Strava rejects an upload that overlaps an existing activity, and this file
  // starts where the first original did. Check before spending the upload.
  const sourceIds = [first.activity.id, second.activity.id]
  await assertDeleted(deps, snapshot.athleteId, sourceIds)

  const externalId = externalIdForMerge(sourceIds[0]!, sourceIds[1]!, request.tag)
  const uploadDeps: MergeDeps = {
    ...deps,
    uploadTimeoutMs: deps.uploadTimeoutMs ?? MERGE_UPLOAD_TIMEOUT_MS,
  }
  let activityId: number
  let alreadyExisted = false
  let created: StravaSummaryActivity
  try {
    const uploadId = await postUpload(uploadDeps, snapshot.athleteId, tcx, {
      name,
      description: request.description ?? defaultDescription(first.activity, second.activity),
      externalId,
      commute: first.activity.commute === true,
      trainer: first.activity.trainer === true,
    })
    log(`upload ${uploadId} accepted, waiting for Strava to process it`)
    activityId = await awaitUpload(uploadDeps, snapshot.athleteId, uploadId)
    // TCX only knows Running/Biking/Other, so the upload always lands on the
    // wrong type; a type-only PUT puts it back (see importService).
    created = await deps.client.updateActivity(snapshot.athleteId, activityId, {
      sport_type: sportType,
    })
  } catch (err) {
    if (!(err instanceof ImportError) || err.duplicateActivityId === undefined) throw err
    if (sourceIds.includes(err.duplicateActivityId)) {
      throw new MergeError(
        'sources-still-present',
        `Strava matched the merge against activity ${err.duplicateActivityId}:` +
          ` delete ${sourceIds.join(' and ')} on strava.com, then run again from the snapshot`,
      )
    }
    // Any other id is a merge this same file already became — adopt it, so a
    // run that died between the upload and the sport-type PUT can be repeated.
    activityId = err.duplicateActivityId
    alreadyExisted = true
    created = await deps.client.updateActivity(snapshot.athleteId, activityId, {
      sport_type: sportType,
    })
    log(`already uploaded earlier as activity ${activityId}`)
  }

  // Store it right away: the incremental sync pages Strava with `?after=<newest
  // start date>`, so an activity uploaded today but STARTED weeks ago is never
  // returned and would stay invisible in stravaBoard.
  upsertActivitySummary(deps.db, toActivityRow(snapshot.athleteId, created))

  return {
    summary,
    tcx,
    geojson,
    snapshot,
    activityId,
    url: `https://www.strava.com/activities/${activityId}`,
    alreadyExisted,
  }
}

/**
 * Stable per-pair id, so a repeated run comes back as "duplicate of activity N"
 * instead of uploading a second copy. `tag` breaks that on purpose: Strava
 * remembers an external id even after the activity it made is deleted, so a
 * corrected re-upload needs a fresh one.
 */
export function externalIdForMerge(firstId: number, secondId: number, tag?: string): string {
  const suffix = tag === undefined || tag === '' ? '' : `-${tag}`
  return `stravaboard-merge-${firstId}-${secondId}${suffix}`
}

export function loadSnapshot(path: string): MergeSnapshot {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new MergeError('snapshot-unreadable', `cannot read ${path}: ${String(err)}`)
  }
  const snapshot = parsed as MergeSnapshot
  if (
    typeof snapshot?.athleteId !== 'number' ||
    typeof snapshot.first?.activity?.id !== 'number' ||
    typeof snapshot.second?.activity?.id !== 'number'
  ) {
    throw new MergeError('snapshot-unreadable', `${path} is not a merge snapshot`)
  }
  return snapshot
}

async function fetchSnapshot(
  deps: MergeDeps,
  source: { firstActivityId: number; secondActivityId: number; athleteId?: number },
): Promise<MergeSnapshot> {
  const owners = [source.firstActivityId, source.secondActivityId].map(
    (id) => getActivity(deps.db, id)?.athleteId,
  )
  const athleteId = source.athleteId ?? owners[0] ?? owners[1]
  if (athleteId === undefined) {
    throw new MergeError(
      'unknown-source',
      'neither activity is in the database; pass the athlete id',
    )
  }
  if (owners[0] !== undefined && owners[1] !== undefined && owners[0] !== owners[1]) {
    throw new MergeError(
      'mixed-athletes',
      `activities ${source.firstActivityId} and ${source.secondActivityId} belong to different athletes`,
    )
  }

  const pair = await Promise.all(
    [source.firstActivityId, source.secondActivityId].map(async (id) => ({
      activity: await deps.client.getActivity(athleteId, id),
      streams: await deps.client.getStreams(athleteId, id, IMPORT_STREAM_KEYS),
    })),
  )
  // Argument order should not matter: the clock decides which one comes first.
  const [first, second] = pair.sort(
    (a, b) => Date.parse(a.activity.start_date) - Date.parse(b.activity.start_date),
  )
  return { athleteId, first: first!, second: second! }
}

/** Every source must be gone from Strava, or the upload is a guaranteed duplicate. */
async function assertDeleted(deps: MergeDeps, athleteId: number, ids: number[]): Promise<void> {
  for (const id of ids) {
    try {
      await deps.client.getActivity(athleteId, id)
    } catch (err) {
      if (err instanceof NotFoundError) continue
      throw err
    }
    throw new MergeError(
      'sources-still-present',
      `activity ${id} is still on Strava: delete ${ids.join(' and ')} there first,` +
        ' then run again from the snapshot',
    )
  }
}

function requireStreams(side: {
  activity: StravaSummaryActivity
  streams: StravaStreamSet
}): TcxStreams {
  const streams = toTcxStreams(side.streams)
  if (streams === null) {
    throw new BridgeError('misaligned', `activity ${side.activity.id} has no time stream`)
  }
  return streams
}

function calories(first: StravaSummaryActivity, second: StravaSummaryActivity): number | undefined {
  if (first.calories === undefined && second.calories === undefined) return undefined
  return (first.calories ?? 0) + (second.calories ?? 0)
}

function defaultDescription(first: StravaSummaryActivity, second: StravaSummaryActivity): string {
  return (
    `Merged from Strava activities ${first.id} and ${second.id};` +
    ' the stretch between them was reconstructed after the recording stopped.'
  )
}

/** Start date pushed by the seconds the first activity's stream was trimmed by. */
function shiftIso(startDate: string, shiftS: number): string {
  if (shiftS === 0) return startDate
  return new Date(Date.parse(startDate) + shiftS * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/**
 * The bridge and its two real neighbours as three separate lines, so the
 * fabricated stretch can be dropped on a map and looked at before it is sent.
 */
function inspectionGeoJson(streams: TcxStreams, firstLength: number, bridgePoints: number): string {
  const latlng = streams.latlng ?? []
  const line = (from: number, to: number): [number, number][] =>
    latlng.slice(Math.max(0, from), to).map((p) => [p[1], p[0]])
  const features = [
    {
      name: 'end of the first activity',
      coordinates: line(firstLength - GEOJSON_CONTEXT_POINTS, firstLength),
    },
    {
      name: 'fabricated bridge',
      coordinates: line(firstLength - 1, firstLength + bridgePoints + 1),
    },
    {
      name: 'start of the second activity',
      coordinates: line(
        firstLength + bridgePoints,
        firstLength + bridgePoints + GEOJSON_CONTEXT_POINTS,
      ),
    },
  ]
  return JSON.stringify({
    type: 'FeatureCollection',
    features: features.map((f) => ({
      type: 'Feature',
      properties: { name: f.name },
      geometry: { type: 'LineString', coordinates: f.coordinates },
    })),
  })
}
