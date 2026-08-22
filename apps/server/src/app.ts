import Fastify, { type FastifyInstance } from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { registerAuthGuard } from './auth/session.js'
import { allowedAthleteIds, type Config } from './config.js'
import type { Db } from './db/client.js'
import { createDeniedLoginNotifier } from './mail/deniedLogin.js'
import { createMailer, type Mailer } from './mail/mailer.js'
import { seedAllowlist } from './repositories/allowlist.repo.js'
import { registerActivityRoutes } from './routes/activities.js'
import { registerAdminRoutes } from './routes/admin.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerConfigRoutes } from './routes/config.js'
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
  /** Alert relay; defaults to the configured SMTP one (null when unconfigured). */
  mailer?: Mailer | null
  /** Stops the process on POST /api/admin/restart; injected in tests. */
  exit?: () => void
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
  mailer,
  exit,
}: AppDeps): Promise<App> {
  const app = Fastify({ logger: logger ? { level: 'info' } : false })
  const client = new StravaClient(config, db, fetchImpl)
  const sync = new SyncService(db, client, {
    log: (msg) => app.log.info(msg),
    ...syncOptions,
  })

  await app.register(fastifyCookie, { secret: config.COOKIE_SECRET })
  registerAuthGuard(app)

  // First boot only: ALLOWED_ATHLETE_IDS bootstraps the table, which is the
  // source of truth from then on (the admin page edits it live).
  seedAllowlist(db, allowedAthleteIds(config), new Date().toISOString())

  const notifyDenied = createDeniedLoginNotifier({
    mailer: mailer === undefined ? createMailer(config) : mailer,
    appBaseUrl: config.APP_BASE_URL,
    log: (msg) => app.log.warn(msg),
  })

  app.get('/api/health', async () => ({ status: 'ok' }))

  registerAuthRoutes(app, config, db, fetchImpl, () => sync.start(), notifyDenied)
  registerConfigRoutes(app, config)
  registerSettingsRoutes(app, db)
  registerSyncRoutes(app, sync)
  registerActivityRoutes(app, db, sync)
  registerAdminRoutes(app, config, db, {
    exit:
      exit ??
      (() => {
        void app.close().then(() => process.exit(0))
      }),
  })

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
