import Fastify, { type FastifyInstance } from 'fastify'
import type { Config } from './config.js'

export interface AppDeps {
  config: Config
}

export async function buildApp({ config }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: 'info' } })

  app.get('/api/health', async () => ({ status: 'ok' }))

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
