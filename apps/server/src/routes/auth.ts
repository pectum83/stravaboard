import type { FastifyInstance } from 'fastify'
import type { AuthStatus } from '@stravaboard/shared'
import { isAdmin, type Config } from '../config.js'
import type { Db } from '../db/client.js'
import type { DeniedLoginNotifier } from '../mail/deniedLogin.js'
import { getAthlete, upsertAthlete } from '../repositories/athletes.repo.js'
import { countAllowed, isAllowed } from '../repositories/allowlist.repo.js'
import { saveTokens } from '../repositories/tokens.repo.js'
import { clearSessionCookie, sessionAthleteId, setSessionCookie } from '../auth/session.js'
import { buildAuthorizeUrl, exchangeCode, type FetchLike } from '../strava/oauth.js'

export function registerAuthRoutes(
  app: FastifyInstance,
  config: Config,
  db: Db,
  fetchImpl: FetchLike,
  onConnected?: () => void,
  notifyDenied?: DeniedLoginNotifier,
): void {
  app.get('/api/auth/status', async (req): Promise<AuthStatus> => {
    const athleteId = sessionAthleteId(req)
    if (athleteId === null) return { connected: false }
    const athlete = getAthlete(db, athleteId)
    if (!athlete) return { connected: false }
    return {
      connected: true,
      athleteId,
      name: athlete.displayName,
      isAdmin: isAdmin(config, athleteId),
    }
  })

  app.get('/api/auth/strava/login', async (_req, reply) => {
    return reply.redirect(buildAuthorizeUrl(config))
  })

  app.get('/api/auth/strava/callback', async (req, reply) => {
    const { code, error } = req.query as { code?: string; error?: string }
    if (error || !code) {
      return reply.code(400).send({ error: error ?? 'missing code' })
    }
    const { tokens, athleteName } = await exchangeCode(config, db, code, fetchImpl)
    if (countAllowed(db) > 0 && !isAllowed(db, tokens.athleteId)) {
      // Not family: no account, no session, tokens discarded. The web app shows
      // the id, and the owner gets an email with it (fire-and-forget — the
      // redirect must not wait on SMTP).
      void notifyDenied?.(tokens.athleteId, athleteName)
      return reply.redirect(`${config.WEB_APP_URL}?denied=${tokens.athleteId}`)
    }
    saveTokens(db, tokens)
    upsertAthlete(db, tokens.athleteId, athleteName, new Date().toISOString())
    setSessionCookie(reply, tokens.athleteId)
    onConnected?.()
    return reply.redirect(config.WEB_APP_URL)
  })

  app.post('/api/auth/logout', async (_req, reply) => {
    clearSessionCookie(reply)
    return { loggedOut: true }
  })
}
