/**
 * The `POST /uploads` side of Strava, shared by the activity import and the
 * activity merge.
 *
 * It lives apart from either caller because uploading is the one Strava call
 * `StravaClient` cannot make: the endpoint is multipart and the client's
 * request helper is JSON-only. Everything here is the raw-fetch version of it,
 * with the same token refresh and the same shared rate limiter.
 */
import type { Config } from '../config.js'
import type { Db } from '../db/client.js'
import type { StravaClient } from '../strava/client.js'
import { ensureFreshToken, type FetchLike } from '../strava/oauth.js'
import type { StravaUpload } from '../strava/types.js'

/** Stream kinds an uploaded file carries; a superset of what the sync stores. */
export const IMPORT_STREAM_KEYS = 'time,distance,altitude,latlng,heartrate,cadence'

/** How long to wait for Strava to process the upload before giving up. */
export const UPLOAD_TIMEOUT_MS = 90_000
export const UPLOAD_POLL_MS = 2_000

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
    /** For 'duplicate': the activity Strava says this file already became. */
    readonly duplicateActivityId?: number,
  ) {
    super(message)
  }
}

export interface UploadDeps {
  config: Config
  db: Db
  client: StravaClient
  fetchImpl?: FetchLike
  nowMs?: () => number
  sleep?: (ms: number) => Promise<void>
  log?: (message: string) => void
  /** Overrides the 90 s processing budget — a merged file is far bigger. */
  uploadTimeoutMs?: number
}

export interface UploadFields {
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
export async function postUpload(
  deps: UploadDeps,
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
export async function awaitUpload(
  deps: UploadDeps,
  athleteId: number,
  uploadId: number,
): Promise<number> {
  const nowMs = deps.nowMs ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const deadline = nowMs() + (deps.uploadTimeoutMs ?? UPLOAD_TIMEOUT_MS)
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

/**
 * Strava's upload errors are meant for a web page: they carry markup and HTML
 * entities ("duplicate of <a href='/activities/42'>Rando</a>").
 * Turn one into a plain sentence, keeping the activity id when there is one.
 */
export function uploadError(message: string): ImportError {
  const duplicateId = Number(/\/activities\/(\d+)/.exec(message)?.[1])
  if (/duplicate/i.test(message)) {
    return Number.isInteger(duplicateId)
      ? new ImportError('duplicate', `already imported as activity ${duplicateId}`, duplicateId)
      : new ImportError('duplicate', plainText(message))
  }
  return new ImportError('upload-failed', plainText(message))
}

/** Strip tags and decode the entities Strava actually emits. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&([a-zA-Z])(?:acute|grave|circ|uml|tilde|cedil);/g, '$1')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
}

async function uploadRequest<T>(
  deps: UploadDeps,
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
