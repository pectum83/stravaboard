import type { FetchLike } from '../strava/oauth.js'
import type { StravaStreamSet, StravaSummaryActivity } from '../strava/types.js'

export interface StravaStubOptions {
  activities?: StravaSummaryActivity[]
  streams?: Record<number, StravaStreamSet>
  /** Activity ids whose streams endpoint returns 404. */
  noStreams?: number[]
  /** Return 429 for this many API requests before behaving normally. */
  rateLimit429Count?: number
  /** HTTP status returned by the UpdateActivity (PUT) endpoint instead of 200. */
  updateStatus?: number
  /**
   * Ignore `sport_type` in this many UpdateActivity (PUT) requests, mimicking
   * Strava's flaky sport-type handling on combined updates.
   */
  dropSportTypeUpdateCount?: number
  /** Athlete returned by the token endpoint (OAuth code exchange / refresh). */
  athlete?: { id: number; firstname?: string; lastname?: string }
  /** Failure message returned by POST /uploads instead of an upload id. */
  uploadError?: string
  /** HTTP status returned by POST /uploads instead of 201. */
  uploadStatus?: number
  /** Polls of GET /uploads/{id} that answer "still processing" (default 1). */
  uploadPolls?: number
}

/** One accepted upload, for assertions on what was sent to Strava. */
export interface StubUpload {
  externalId: string
  name: string
  description: string
  commute: string
  trainer: string
  dataType: string
  tcx: string
}

export function makeActivity(
  id: number,
  startDate: string,
  overrides: Partial<StravaSummaryActivity> = {},
): StravaSummaryActivity {
  return {
    id,
    name: `Activity ${id}`,
    sport_type: 'TrailRun',
    start_date: startDate,
    distance: 12_000,
    moving_time: 5400,
    elapsed_time: 5600,
    total_elevation_gain: 800,
    ...overrides,
  }
}

export const simpleStreams: StravaStreamSet = {
  time: { data: [0, 1, 2, 3] },
  distance: { data: [0, 3, 6, 9] },
  altitude: { data: [100, 101, 102, 103] },
  latlng: {
    data: [
      [45.1, 6.05],
      [45.10003, 6.05],
      [45.10006, 6.05],
      [45.10009, 6.05],
    ],
  },
}

/**
 * In-memory Strava API double covering the endpoints the sync uses.
 * Also answers the OAuth token endpoint so token refreshes keep working.
 */
export function stravaStub(opts: StravaStubOptions = {}) {
  const activities = [...(opts.activities ?? [])].sort(
    (a, b) => Date.parse(a.start_date) - Date.parse(b.start_date),
  )
  const requests: string[] = []
  const uploads: StubUpload[] = []
  /** external_id → activity it created, so a re-upload answers "duplicate". */
  const uploadedExternalIds = new Map<string, number>()
  const pending = new Map<number, { activityId: number; pollsLeft: number }>()
  /**
   * Activities born from an upload. The stub has no per-athlete feed, so they
   * stay out of /athlete/activities: otherwise every athlete's sync would claim
   * the copy that belongs to the account that uploaded it.
   */
  const uploaded = new Set<number>()
  let remaining429 = opts.rateLimit429Count ?? 0
  let remainingDroppedSportTypes = opts.dropSportTypeUpdateCount ?? 0
  let nextUploadId = 1
  let nextActivityId = 990_001

  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(String(input))
    requests.push(url.pathname + url.search)

    if (url.pathname.endsWith('/oauth/token') || url.pathname.endsWith('/token')) {
      return Response.json({
        access_token: 'fresh',
        refresh_token: 'rotated',
        expires_at: Math.floor(Date.now() / 1000) + 21600,
        athlete: opts.athlete ?? { id: 1 },
      })
    }

    if (remaining429 > 0) {
      remaining429--
      return new Response('too many requests', { status: 429 })
    }

    if (url.pathname.endsWith('/athlete/activities')) {
      const after = Number(url.searchParams.get('after') ?? 0)
      const page = Number(url.searchParams.get('page') ?? 1)
      const perPage = Number(url.searchParams.get('per_page') ?? 200)
      const matching = activities.filter(
        (a) => Date.parse(a.start_date) / 1000 > after && !uploaded.has(a.id),
      )
      const start = (page - 1) * perPage
      return Response.json(matching.slice(start, start + perPage))
    }

    // Upload API: POST accepts a file, GET polls until Strava built the activity.
    if (url.pathname.endsWith('/uploads') && init?.method === 'POST') {
      if (opts.uploadStatus) return new Response('upload refused', { status: opts.uploadStatus })
      const form = init.body as FormData
      const externalId = String(form.get('external_id') ?? '')
      const duplicateOf = uploadedExternalIds.get(externalId)
      const id = nextUploadId++
      if (duplicateOf !== undefined) {
        return Response.json({
          id,
          external_id: externalId,
          // Strava's own wording: HTML meant for its web page.
          error: `duplicate of <a href='/activities/${duplicateOf}' target='_blank'>Randonn&eacute;e le matin</a>`,
          status: 'error',
          activity_id: null,
        })
      }
      if (opts.uploadError) {
        return Response.json({
          id,
          external_id: externalId,
          error: opts.uploadError,
          status: 'error',
          activity_id: null,
        })
      }
      uploads.push({
        externalId,
        name: String(form.get('name') ?? ''),
        description: String(form.get('description') ?? ''),
        commute: String(form.get('commute') ?? ''),
        trainer: String(form.get('trainer') ?? ''),
        dataType: String(form.get('data_type') ?? ''),
        tcx: await (form.get('file') as Blob).text(),
      })
      const activityId = nextActivityId++
      uploadedExternalIds.set(externalId, activityId)
      uploaded.add(activityId)
      // The activity only exists once processing ends; register it now so the
      // sport-type correction that follows the poll finds it.
      activities.push(makeActivity(activityId, new Date().toISOString(), { sport_type: 'Workout' }))
      pending.set(id, { activityId, pollsLeft: opts.uploadPolls ?? 1 })
      return Response.json({
        id,
        external_id: externalId,
        error: null,
        status: 'Your activity is still being processed.',
        activity_id: null,
      })
    }

    const uploadMatch = url.pathname.match(/\/uploads\/(\d+)$/)
    if (uploadMatch) {
      const state = pending.get(Number(uploadMatch[1]))
      if (!state) return new Response('not found', { status: 404 })
      if (state.pollsLeft > 0) {
        state.pollsLeft--
        return Response.json({
          id: Number(uploadMatch[1]),
          external_id: null,
          error: null,
          status: 'Your activity is still being processed.',
          activity_id: null,
        })
      }
      return Response.json({
        id: Number(uploadMatch[1]),
        external_id: null,
        error: null,
        status: 'Your activity is ready.',
        activity_id: state.activityId,
      })
    }

    const detailMatch = url.pathname.match(/\/activities\/(\d+)$/)
    if (detailMatch) {
      const activity = activities.find((a) => a.id === Number(detailMatch[1]))
      // UpdateActivity: apply the JSON patch and echo the updated summary,
      // mirroring Strava's canonical response.
      if (init?.method === 'PUT') {
        if (opts.updateStatus) return new Response('error', { status: opts.updateStatus })
        if (!activity) return new Response('not found', { status: 404 })
        const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>
        if ('sport_type' in body && remainingDroppedSportTypes > 0) {
          remainingDroppedSportTypes--
          delete body.sport_type
        }
        Object.assign(activity, body)
        return Response.json(activity)
      }
      return activity ? Response.json(activity) : new Response('not found', { status: 404 })
    }

    const streamsMatch = url.pathname.match(/\/activities\/(\d+)\/streams$/)
    if (streamsMatch) {
      const id = Number(streamsMatch[1])
      if (opts.noStreams?.includes(id)) {
        return new Response('not found', { status: 404 })
      }
      const set = opts.streams?.[id] ?? simpleStreams
      // Strava only returns the requested keys; callers ask for different sets.
      const keys = (url.searchParams.get('keys') ?? '').split(',')
      const selected = Object.fromEntries(Object.entries(set).filter(([key]) => keys.includes(key)))
      return Response.json(selected)
    }

    void init
    return new Response(`stub: unhandled ${url.pathname}`, { status: 500 })
  }

  return { fetchImpl, requests, uploads }
}
