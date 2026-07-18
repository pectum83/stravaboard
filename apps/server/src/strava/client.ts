import type { Config } from '../config.js'
import type { Db } from '../db/client.js'
import { RateLimiter, nextQuarterHour } from '../sync/rateLimiter.js'
import { ensureFreshToken, type FetchLike } from './oauth.js'
import type { StravaStreamSet, StravaSummaryActivity } from './types.js'

export class StravaApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export class NotFoundError extends StravaApiError {
  constructor() {
    super(404, 'resource not found')
  }
}

export class RateLimitError extends Error {
  constructor(
    /** Epoch ms at which requests may resume. */
    readonly resumeAtMs: number,
  ) {
    super('Strava rate limit reached')
  }
}

export class StravaClient {
  readonly rateLimiter: RateLimiter

  constructor(
    private readonly config: Config,
    private readonly db: Db,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly nowMs: () => number = Date.now,
    rateLimiter = new RateLimiter(),
  ) {
    this.rateLimiter = rateLimiter
  }

  /** Activities strictly after `afterEpoch`, oldest first (Strava semantics of ?after). */
  async listActivities(athleteId: number, afterEpoch: number, page: number, perPage = 200) {
    const params = new URLSearchParams({
      after: String(afterEpoch),
      page: String(page),
      per_page: String(perPage),
    })
    return this.request<StravaSummaryActivity[]>(athleteId, `/athlete/activities?${params}`)
  }

  /** Detailed activity — a superset of the summary fields we store. */
  async getActivity(athleteId: number, activityId: number) {
    return this.request<StravaSummaryActivity>(athleteId, `/activities/${activityId}`)
  }

  async getStreams(athleteId: number, activityId: number) {
    const params = new URLSearchParams({
      keys: 'time,distance,altitude,latlng',
      key_by_type: 'true',
    })
    return this.request<StravaStreamSet>(athleteId, `/activities/${activityId}/streams?${params}`)
  }

  /**
   * Update an activity on Strava (UpdateActivity, `PUT /activities/{id}`) and
   * return the updated summary. Requires the `activity:write` scope — without
   * it Strava replies 401/403, surfaced as a StravaApiError for the caller to
   * turn into a "reconnect" message.
   */
  async updateActivity(
    athleteId: number,
    activityId: number,
    patch: { name?: string; sport_type?: string },
  ): Promise<StravaSummaryActivity> {
    return this.request<StravaSummaryActivity>(athleteId, `/activities/${activityId}`, {
      method: 'PUT',
      body: patch,
    })
  }

  /**
   * One request through the rate limiter with a fresh per-athlete token and
   * uniform status→error mapping. GET by default; pass a JSON `body` to send a
   * mutation (adds the content-type header and serialises it).
   */
  private async request<T>(
    athleteId: number,
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const wait = this.rateLimiter.waitUntil(this.nowMs())
    if (wait !== null) throw new RateLimitError(wait)

    const token = await ensureFreshToken(this.config, this.db, athleteId, this.fetchImpl, () =>
      Math.floor(this.nowMs() / 1000),
    )
    const hasBody = init.body !== undefined
    const res = await this.fetchImpl(`${this.config.STRAVA_API_BASE}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
    })
    this.rateLimiter.update(res.headers, this.nowMs())

    if (res.status === 429) throw new RateLimitError(nextQuarterHour(this.nowMs()))
    if (res.status === 404) throw new NotFoundError()
    if (!res.ok) throw new StravaApiError(res.status, `Strava API ${res.status}: ${path}`)
    return (await res.json()) as T
  }
}
