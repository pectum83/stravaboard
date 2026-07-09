import type { Config } from '../config.js'
import type { Db } from '../db/client.js'
import { getTokens, saveTokens, type StoredTokens } from '../repositories/tokens.repo.js'
import type { StravaTokenResponse } from './types.js'

export type FetchLike = typeof fetch

/** Seconds of validity below which the access token is refreshed before use. */
const REFRESH_MARGIN_S = 60

export function buildAuthorizeUrl(config: Config): string {
  const params = new URLSearchParams({
    client_id: config.STRAVA_CLIENT_ID,
    response_type: 'code',
    redirect_uri: `${config.APP_BASE_URL}/api/auth/strava/callback`,
    scope: 'activity:read_all',
    approval_prompt: 'auto',
  })
  return `${config.STRAVA_OAUTH_BASE}/authorize?${params}`
}

/** Exchange an authorization code for tokens and persist them. */
export async function exchangeCode(
  config: Config,
  db: Db,
  code: string,
  fetchImpl: FetchLike = fetch,
): Promise<StoredTokens> {
  const body = await tokenRequest(config, { grant_type: 'authorization_code', code }, fetchImpl)
  const athleteId = body.athlete?.id
  if (!athleteId) throw new Error('token response has no athlete id')
  const tokens: StoredTokens = {
    athleteId,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: body.expires_at,
  }
  saveTokens(db, tokens)
  return tokens
}

/**
 * Return a valid access token, refreshing it first when (nearly) expired.
 * Strava rotates refresh tokens: the one returned by each refresh MUST be
 * persisted or the app silently loses access when the old one is revoked.
 */
export async function ensureFreshToken(
  config: Config,
  db: Db,
  fetchImpl: FetchLike = fetch,
  nowS: () => number = () => Math.floor(Date.now() / 1000),
): Promise<string> {
  const stored = getTokens(db)
  if (!stored) throw new NotConnectedError()
  if (stored.expiresAt - nowS() > REFRESH_MARGIN_S) return stored.accessToken

  const body = await tokenRequest(
    config,
    { grant_type: 'refresh_token', refresh_token: stored.refreshToken },
    fetchImpl,
  )
  const next: StoredTokens = {
    athleteId: stored.athleteId,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: body.expires_at,
  }
  saveTokens(db, next)
  return next.accessToken
}

export class NotConnectedError extends Error {
  constructor() {
    super('no Strava account connected')
  }
}

async function tokenRequest(
  config: Config,
  params: Record<string, string>,
  fetchImpl: FetchLike,
): Promise<StravaTokenResponse> {
  const res = await fetchImpl(`${config.STRAVA_OAUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.STRAVA_CLIENT_ID,
      client_secret: config.STRAVA_CLIENT_SECRET,
      ...params,
    }),
  })
  if (!res.ok) {
    throw new Error(`Strava token request failed: ${res.status} ${await res.text()}`)
  }
  return (await res.json()) as StravaTokenResponse
}
