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
    expect(url.searchParams.get('scope')).toBe('activity:read_all')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3001/api/auth/strava/callback',
    )
  })
})

describe('exchangeCode', () => {
  it('exchanges the code and persists tokens with the athlete id', async () => {
    const db = testDb()
    const { fetch: f, calls } = fetchStub(() => ({
      access_token: 'at',
      refresh_token: 'rt',
      expires_at: 9999,
      athlete: { id: 42 },
    }))
    await exchangeCode(config, db, 'the-code', f)
    expect(calls[0]?.get('grant_type')).toBe('authorization_code')
    expect(calls[0]?.get('code')).toBe('the-code')
    expect(getTokens(db)).toEqual({
      athleteId: 42,
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: 9999,
    })
  })

  it('throws on a non-OK token response', async () => {
    const { fetch: f } = fetchStub(() => 400)
    await expect(exchangeCode(config, testDb(), 'bad', f)).rejects.toThrow(
      /token request failed: 400/,
    )
  })
})

describe('ensureFreshToken', () => {
  it('throws NotConnectedError when no tokens are stored', async () => {
    const { fetch: f } = fetchStub(() => ({}))
    await expect(ensureFreshToken(config, testDb(), f)).rejects.toThrow(NotConnectedError)
  })

  it('returns the stored token untouched while still valid', async () => {
    const db = testDb()
    saveTokens(db, { athleteId: 1, accessToken: 'valid', refreshToken: 'r0', expiresAt: 2000 })
    const { fetch: f, calls } = fetchStub(() => ({}))
    const token = await ensureFreshToken(config, db, f, () => 1000)
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
    const token = await ensureFreshToken(config, db, f, () => 1000)
    expect(token).toBe('new')
    expect(calls[0]?.get('grant_type')).toBe('refresh_token')
    expect(calls[0]?.get('refresh_token')).toBe('r0')
    // The rotated refresh token MUST be stored — Strava revokes the old one.
    expect(getTokens(db)).toEqual({
      athleteId: 1,
      accessToken: 'new',
      refreshToken: 'r1-rotated',
      expiresAt: 9000,
    })
  })
})

describe('auth routes', () => {
  it('reports disconnected then connected status around the callback', async () => {
    const db = testDb()
    const { fetch: f } = fetchStub(() => ({
      access_token: 'at',
      refresh_token: 'rt',
      expires_at: 9999,
      athlete: { id: 7 },
    }))
    const { app } = await testApp({}, db, f)

    const before = await app.inject({ method: 'GET', url: '/api/auth/status' })
    expect(before.json()).toEqual({ connected: false })

    const cb = await app.inject({ method: 'GET', url: '/api/auth/strava/callback?code=xyz' })
    expect(cb.statusCode).toBe(302)

    const after = await app.inject({ method: 'GET', url: '/api/auth/status' })
    expect(after.json()).toEqual({ connected: true, athleteId: 7 })
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
