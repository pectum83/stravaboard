import Fastify, { type FastifyInstance } from 'fastify'
import type { Config } from './config.js'
import type { Db } from './db/client.js'
import { registerActivityRoutes } from './routes/activities.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerSettingsRoutes } from './routes/settings.js'
import { registerSyncRoutes } from './routes/sync.js'
import { StravaClient } from './strava/client.js'
import type { FetchLike } from './strava/oauth.js'
import { SyncService, type SyncServiceOptions } from './sync/syncService.js'

export interface AppDeps {
  config: Config
  db: Db
  logger?: boolean
  fetchImpl?: FetchLike
  syncOptions?: SyncServiceOptions
}

export interface App {
  app: FastifyInstance
  sync: SyncService
}

export async function buildApp({
  config,
  db,
  logger = true,
  fetchImpl = fetch,
  syncOptions,
}: AppDeps): Promise<App> {
  const app = Fastify({ logger: logger ? { level: 'info' } : false })
  const client = new StravaClient(config, db, fetchImpl)
  const sync = new SyncService(db, client, {
    log: (msg) => app.log.info(msg),
    ...syncOptions,
  })

  app.get('/api/health', async () => ({ status: 'ok' }))

  registerAuthRoutes(app, config, db, fetchImpl, () => sync.start())
  registerSettingsRoutes(app, db)
  registerSyncRoutes(app, sync)
  registerActivityRoutes(app, db)

  if (config.WEB_DIST_PATH) {
    const { default: fastifyStatic } = await import('@fastify/static')
    await app.register(fastifyStatic, { root: config.WEB_DIST_PATH })
    app.setNotFoundHandler((req, reply) => {
      // SPA fallback: non-API routes serve the app shell
      if (!req.url.startsWith('/api/')) return reply.sendFile('index.html')
      return reply.code(404).send({ error: 'not found' })
    })
  }

  return { app, sync }
}
