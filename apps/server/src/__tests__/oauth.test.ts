import { describe, expect, it } from 'vitest'
import { getTokens, saveTokens } from '../repositories/tokens.repo.js'
import {
  buildAuthorizeUrl,
  ensureFreshToken,
  exchangeCode,
  NotConnectedError,
} from '../strava/oauth.js'
import type { FetchLike } from '../strava/oauth.js'
import { testApp, testConfig, testDb } from './helpers.js'

function fetchStub(handler: (url: string, body: URLSearchParams) => object | number): {
  fetch: FetchLike
  calls: URLSearchParams[]
} {
  const calls: URLSearchParams[] = []
  const impl: FetchLike = async (url, init) => {
    const body = new URLSearchParams(String(init?.body ?? ''))
    calls.push(body)
    const result = handler(String(url), body)
    if (typeof result === 'number') {
      return new Response('denied', { status: result })
    }
    return Response.json(result)
  }
  return { fetch: impl, calls }
}

const config = testConfig({
  STRAVA_CLIENT_ID: 'cid',
  STRAVA_CLIENT_SECRET: 'secret',
  STRAVA_OAUTH_BASE: 'https://strava.test/oauth',
})

describe('buildAuthorizeUrl', () => {
  it('targets the configured OAuth base with the derived redirect URI', () => {
    const url = new URL(buildAuthorizeUrl(config))
    expect(url.origin + url.pathname).toBe('https://strava.test/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('scope')).toBe('activity:read_all,activity:write')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3001/api/auth/strava/callback',
    )
  })
})

describe('exchangeCode', () => {
  it('exchanges the code and returns tokens WITHOUT persisting them', async () => {
    const db = testDb()
    const { fetch: f, calls } = fetchStub(() => ({
      access_token: 'at',
      refresh_token: 'rt',
      expires_at: 9999,
      athlete: { id: 42, firstname: 'Léa', lastname: 'R.' },
    }))
    const { tokens, athleteName } = await exchangeCode(config, db, 'the-code', f)
    expect(calls[0]?.get('grant_type')).toBe('authorization_code')
    expect(calls[0]?.get('code')).toBe('the-code')
    expect(tokens).toEqual({
      athleteId: 42,
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: 9999,
    })
    expect(athleteName).toBe('Léa R.')
    // Persistence is the caller's decision (allowlist gate).
    expect(getTokens(db, 42)).toBeNull()
  })

  it('throws on a non-OK token response', async () => {
    const { fetch: f } = fetchStub(() => 400)
    await expect(exchangeCode(config, testDb(), 'bad', f)).rejects.toThrow(
      /token request failed: 400/,
    )
  })
})

describe('ensureFreshToken', () => {
  it('throws NotConnectedError when the athlete has no tokens', async () => {
    const { fetch: f } = fetchStub(() => ({}))
    await expect(ensureFreshToken(config, testDb(), 1, f)).rejects.toThrow(NotConnectedError)
  })

  it('returns the stored token untouched while still valid', async () => {
    const db = testDb()
    saveTokens(db, { athleteId: 1, accessToken: 'valid', refreshToken: 'r0', expiresAt: 2000 })
    const { fetch: f, calls } = fetchStub(() => ({}))
    const token = await ensureFreshToken(config, db, 1, f, () => 1000)
    expect(token).toBe('valid')
    expect(calls).toHaveLength(0)
  })

  it('refreshes an expired token AND persists the rotated refresh token', async () => {
    const db = testDb()
    saveTokens(db, { athleteId: 1, accessToken: 'old', refreshToken: 'r0', expiresAt: 1000 })
    const { fetch: f, calls } = fetchStub(() => ({
      access_token: 'new',
      refresh_token: 'r1-rotated',
      expires_at: 9000,
    }))
    const token = await ensureFreshToken(config, db, 1, f, () => 1000)
    expect(token).toBe('new')
    expect(calls[0]?.get('grant_type')).toBe('refresh_token')
    expect(calls[0]?.get('refresh_token')).toBe('r0')
    // The rotated refresh token MUST be stored — Strava revokes the old one.
    expect(getTokens(db, 1)).toEqual({
      athleteId: 1,
      accessToken: 'new',
      refreshToken: 'r1-rotated',
      expiresAt: 9000,
    })
  })

  it("keeps each athlete's tokens separate", async () => {
    const db = testDb()
    saveTokens(db, { athleteId: 1, accessToken: 'a1', refreshToken: 'r1', expiresAt: 9000 })
    saveTokens(db, { athleteId: 2, accessToken: 'a2', refreshToken: 'r2', expiresAt: 9000 })
    const { fetch: f } = fetchStub(() => ({}))
    expect(await ensureFreshToken(config, db, 1, f, () => 1000)).toBe('a1')
    expect(await ensureFreshToken(config, db, 2, f, () => 1000)).toBe('a2')
  })
})

describe('auth routes', () => {
  const tokenResponse = (athleteId: number, name?: string) => ({
    access_token: 'at',
    refresh_token: 'rt',
    expires_at: 9999,
    athlete: { id: athleteId, firstname: name },
  })

  it('logs in via the callback: session cookie, athlete account, status with name', async () => {
    const db = testDb()
    const { fetch: f } = fetchStub(() => tokenResponse(7, 'Chris'))
    const { app } = await testApp({}, db, f)

    const before = await app.inject({ method: 'GET', url: '/api/auth/status' })
    expect(before.json()).toEqual({ connected: false })

    const cb = await app.inject({ method: 'GET', url: '/api/auth/strava/callback?code=xyz' })
    expect(cb.statusCode).toBe(302)
    const cookie = cb.cookies.find((c) => c.name === 'session')
    expect(cookie).toBeDefined()
    expect(getTokens(db, 7)).not.toBeNull()

    const after = await app.inject({
      method: 'GET',
      url: '/api/auth/status',
      cookies: { session: cookie!.value },
    })
    expect(after.json()).toEqual({ connected: true, athleteId: 7, name: 'Chris' })
  })

  it('denies athletes outside the allowlist without storing anything', async () => {
    const db = testDb()
    const { fetch: f } = fetchStub(() => tokenResponse(999, 'Stranger'))
    const { app } = await testApp({ ALLOWED_ATHLETE_IDS: '7, 8' }, db, f)

    const cb = await app.inject({ method: 'GET', url: '/api/auth/strava/callback?code=xyz' })
    expect(cb.statusCode).toBe(302)
    expect(cb.headers.location).toContain('denied=999')
    expect(cb.cookies.find((c) => c.name === 'session')).toBeUndefined()
    expect(getTokens(db, 999)).toBeNull()
  })

  it('accepts allowlisted athletes', async () => {
    const db = testDb()
    const { fetch: f } = fetchStub(() => tokenResponse(8))
    const { app } = await testApp({ ALLOWED_ATHLETE_IDS: '7,8' }, db, f)
    const cb = await app.inject({ method: 'GET', url: '/api/auth/strava/callback?code=xyz' })
    expect(cb.cookies.find((c) => c.name === 'session')).toBeDefined()
  })

  it('logout clears the session', async () => {
    const db = testDb()
    const { fetch: f } = fetchStub(() => tokenResponse(7))
    const { app } = await testApp({}, db, f)
    const cb = await app.inject({ method: 'GET', url: '/api/auth/strava/callback?code=xyz' })
    const cookie = cb.cookies.find((c) => c.name === 'session')!

    const out = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { session: cookie.value },
    })
    expect(out.statusCode).toBe(200)
    const cleared = out.cookies.find((c) => c.name === 'session')
    expect(cleared?.value).toBe('')
  })

  it('rejects a forged (unsigned) session cookie', async () => {
    const { app } = await testApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/activities',
      cookies: { session: '7' }, // no valid signature
    })
    expect(res.statusCode).toBe(401)
  })

  it('login redirects to the Strava authorize URL', async () => {
    const { app } = await testApp({ STRAVA_OAUTH_BASE: 'https://strava.test/oauth' })
    const res = await app.inject({ method: 'GET', url: '/api/auth/strava/login' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toContain('https://strava.test/oauth/authorize')
  })

  it('callback rejects a denial from Strava', async () => {
    const { app } = await testApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/strava/callback?error=access_denied',
    })
    expect(res.statusCode).toBe(400)
  })
})
