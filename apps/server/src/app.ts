import Fastify, { type FastifyInstance } from 'fastify'
import type { Config } from './config.js'
import type { Db } from './db/client.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerSettingsRoutes } from './routes/settings.js'
import type { FetchLike } from './strava/oauth.js'

export interface AppDeps {
  config: Config
  db: Db
  logger?: boolean
  fetchImpl?: FetchLike
  /** Called when the Strava account is (re)connected — used to kick off a sync. */
  onConnected?: () => void
}

export async function buildApp({
  config,
  db,
  logger = true,
  fetchImpl = fetch,
  onConnected,
}: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: logger ? { level: 'info' } : false })

  app.get('/api/health', async () => ({ status: 'ok' }))

  registerAuthRoutes(app, config, db, fetchImpl, onConnected)
  registerSettingsRoutes(app, db)

  if (config.WEB_DIST_PATH) {
    const { default: fastifyStatic } = await import('@fastify/static')
    await app.register(fastifyStatic, { root: config.WEB_DIST_PATH })
    app.setNotFoundHandler((req, reply) => {
      // SPA fallback: non-API routes serve the app shell
      if (!req.url.startsWith('/api/')) return reply.sendFile('index.html')
      return reply.code(404).send({ error: 'not found' })
    })
  }

  return app
}
