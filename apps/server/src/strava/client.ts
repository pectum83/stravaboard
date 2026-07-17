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
    return this.get<StravaSummaryActivity[]>(athleteId, `/athlete/activities?${params}`)
  }

  /** Detailed activity — a superset of the summary fields we store. */
  async getActivity(athleteId: number, activityId: number) {
    return this.get<StravaSummaryActivity>(athleteId, `/activities/${activityId}`)
  }

  async getStreams(athleteId: number, activityId: number) {
    const params = new URLSearchParams({
      keys: 'time,distance,altitude,latlng',
      key_by_type: 'true',
    })
    return this.get<StravaStreamSet>(athleteId, `/activities/${activityId}/streams?${params}`)
  }

  private async get<T>(athleteId: number, path: string): Promise<T> {
    const wait = this.rateLimiter.waitUntil(this.nowMs())
    if (wait !== null) throw new RateLimitError(wait)

    const token = await ensureFreshToken(this.config, this.db, athleteId, this.fetchImpl, () =>
      Math.floor(this.nowMs() / 1000),
    )
    const res = await this.fetchImpl(`${this.config.STRAVA_API_BASE}${path}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    this.rateLimiter.update(res.headers, this.nowMs())

    if (res.status === 429) throw new RateLimitError(nextQuarterHour(this.nowMs()))
    if (res.status === 404) throw new NotFoundError()
    if (!res.ok) throw new StravaApiError(res.status, `Strava API ${res.status}: ${path}`)
    return (await res.json()) as T
  }
}
