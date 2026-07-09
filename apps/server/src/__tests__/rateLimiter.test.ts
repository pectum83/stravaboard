import { describe, expect, it } from 'vitest'
import { RateLimiter, nextQuarterHour, nextUtcMidnight } from '../sync/rateLimiter.js'

const T0 = Date.UTC(2026, 0, 5, 10, 2, 0) // 10:02 UTC — inside the 10:00 quarter

function headers(usage: string, limit = '200,2000'): Headers {
  return new Headers({ 'x-ratelimit-limit': limit, 'x-ratelimit-usage': usage })
}

describe('RateLimiter', () => {
  it('allows requests while under the soft caps', () => {
    const rl = new RateLimiter()
    rl.update(headers('100,500'), T0)
    expect(rl.waitUntil(T0)).toBeNull()
  })

  it('pauses until the next quarter hour at the 15-minute soft cap', () => {
    const rl = new RateLimiter()
    rl.update(headers('180,500'), T0)
    expect(rl.waitUntil(T0)).toBe(Date.UTC(2026, 0, 5, 10, 15, 0))
  })

  it('clears the 15-minute pause once the window rolls over', () => {
    const rl = new RateLimiter()
    rl.update(headers('180,500'), T0)
    const later = Date.UTC(2026, 0, 5, 10, 16, 0)
    expect(rl.waitUntil(later)).toBeNull()
  })

  it('pauses until UTC midnight at the daily soft cap, across quarter hours', () => {
    const rl = new RateLimiter()
    rl.update(headers('10,1990'), T0)
    expect(rl.waitUntil(T0)).toBe(Date.UTC(2026, 0, 6))
    const nextQuarter = Date.UTC(2026, 0, 5, 10, 20, 0)
    expect(rl.waitUntil(nextQuarter)).toBe(Date.UTC(2026, 0, 6))
  })

  it('clears the daily pause on the next UTC day', () => {
    const rl = new RateLimiter()
    rl.update(headers('10,1990'), T0)
    expect(rl.waitUntil(Date.UTC(2026, 0, 6, 0, 1, 0))).toBeNull()
  })

  it('ignores responses without rate-limit headers', () => {
    const rl = new RateLimiter()
    rl.update(new Headers(), T0)
    expect(rl.waitUntil(T0)).toBeNull()
  })
})

describe('boundary helpers', () => {
  it('computes the next quarter hour and next UTC midnight', () => {
    expect(nextQuarterHour(T0)).toBe(Date.UTC(2026, 0, 5, 10, 15, 0))
    expect(nextUtcMidnight(T0)).toBe(Date.UTC(2026, 0, 6))
  })
})
