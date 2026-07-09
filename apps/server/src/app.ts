import Fastify, { type FastifyInstance } from 'fastify'
import type { Config } from './config.js'
import type { Db } from './db/client.js'
import { registerSettingsRoutes } from './routes/settings.js'

export interface AppDeps {
  config: Config
  db: Db
  logger?: boolean
}

export async function buildApp({ config, db, logger = true }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: logger ? { level: 'info' } : false })

  app.get('/api/health', async () => ({ status: 'ok' }))

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
