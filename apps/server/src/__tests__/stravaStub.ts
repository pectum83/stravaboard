import type { FetchLike } from '../strava/oauth.js'
import type { StravaStreamSet, StravaSummaryActivity } from '../strava/types.js'

export interface StravaStubOptions {
  activities?: StravaSummaryActivity[]
  streams?: Record<number, StravaStreamSet>
  /** Activity ids whose streams endpoint returns 404. */
  noStreams?: number[]
  /** Return 429 for this many API requests before behaving normally. */
  rateLimit429Count?: number
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
  let remaining429 = opts.rateLimit429Count ?? 0

  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(String(input))
    requests.push(url.pathname + url.search)

    if (url.pathname.endsWith('/oauth/token') || url.pathname.endsWith('/token')) {
      return Response.json({
        access_token: 'fresh',
        refresh_token: 'rotated',
        expires_at: Math.floor(Date.now() / 1000) + 21600,
        athlete: { id: 1 },
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
      const matching = activities.filter((a) => Date.parse(a.start_date) / 1000 > after)
      const start = (page - 1) * perPage
      return Response.json(matching.slice(start, start + perPage))
    }

    const streamsMatch = url.pathname.match(/\/activities\/(\d+)\/streams$/)
    if (streamsMatch) {
      const id = Number(streamsMatch[1])
      if (opts.noStreams?.includes(id)) {
        return new Response('not found', { status: 404 })
      }
      const set = opts.streams?.[id] ?? simpleStreams
      return Response.json(set)
    }

    void init
    return new Response(`stub: unhandled ${url.pathname}`, { status: 500 })
  }

  return { fetchImpl, requests }
}
