import type { FastifyInstance } from 'fastify'
import type { AuthStatus } from '@stravaboard/shared'
import type { Config } from '../config.js'
import type { Db } from '../db/client.js'
import { getTokens } from '../repositories/tokens.repo.js'
import { buildAuthorizeUrl, exchangeCode, type FetchLike } from '../strava/oauth.js'

export function registerAuthRoutes(
  app: FastifyInstance,
  config: Config,
  db: Db,
  fetchImpl: FetchLike,
  onConnected?: () => void,
): void {
  app.get('/api/auth/status', async (): Promise<AuthStatus> => {
    const tokens = getTokens(db)
    return tokens ? { connected: true, athleteId: tokens.athleteId } : { connected: false }
  })

  app.get('/api/auth/strava/login', async (_req, reply) => {
    return reply.redirect(buildAuthorizeUrl(config))
  })

  app.get('/api/auth/strava/callback', async (req, reply) => {
    const { code, error } = req.query as { code?: string; error?: string }
    if (error || !code) {
      return reply.code(400).send({ error: error ?? 'missing code' })
    }
    await exchangeCode(config, db, code, fetchImpl)
    onConnected?.()
    return reply.redirect(config.WEB_APP_URL)
  })
}
