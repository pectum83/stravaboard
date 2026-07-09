/**
 * Tracks Strava rate-limit usage from response headers:
 *   X-RateLimit-Limit: 200,2000   (15-minute, daily)
 *   X-RateLimit-Usage: 87,412
 *
 * The 15-minute window resets on quarter-hour boundaries (:00/:15/:30/:45),
 * the daily window at midnight UTC.
 */
export class RateLimiter {
  private limit15 = 200
  private limitDay = 2000
  private usage15 = 0
  private usageDay = 0
  private usageAtMs = 0

  constructor(
    /** Requests kept in reserve below each limit before we self-throttle. */
    private readonly margin = 20,
  ) {}

  update(headers: Headers, nowMs: number): void {
    const limit = headers.get('x-ratelimit-limit')
    const usage = headers.get('x-ratelimit-usage')
    if (!limit || !usage) return
    const [l15, lDay] = limit.split(',').map(Number)
    const [u15, uDay] = usage.split(',').map(Number)
    if (Number.isFinite(l15)) this.limit15 = l15!
    if (Number.isFinite(lDay)) this.limitDay = lDay!
    if (Number.isFinite(u15)) this.usage15 = u15!
    if (Number.isFinite(uDay)) this.usageDay = uDay!
    this.usageAtMs = nowMs
  }

  /** Epoch ms until which requests should pause, or null if clear to go. */
  waitUntil(nowMs: number): number | null {
    // Usage observed in an earlier window no longer binds.
    const q = quarterHourStart(nowMs)
    if (this.usageAtMs < q) {
      if (this.usageAtMs < utcMidnight(nowMs)) return null
      // Same day: only the daily budget still applies.
      if (this.usageDay >= this.limitDay - this.margin) return nextUtcMidnight(nowMs)
      return null
    }
    if (this.usageDay >= this.limitDay - this.margin) return nextUtcMidnight(nowMs)
    if (this.usage15 >= this.limit15 - this.margin) return q + 15 * 60_000
    return null
  }
}

function quarterHourStart(nowMs: number): number {
  return nowMs - (nowMs % (15 * 60_000))
}

function utcMidnight(nowMs: number): number {
  return nowMs - (nowMs % 86_400_000)
}

export function nextUtcMidnight(nowMs: number): number {
  return utcMidnight(nowMs) + 86_400_000
}

export function nextQuarterHour(nowMs: number): number {
  return quarterHourStart(nowMs) + 15 * 60_000
}
