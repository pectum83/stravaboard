import type { FastifyInstance } from 'fastify'
import type { Config } from '../config.js'

/** Client-visible configuration (only values that are safe to expose). */
export function registerConfigRoutes(app: FastifyInstance, config: Config): void {
  app.get('/api/config', async () => ({
    maptilerKey: config.MAPTILER_KEY === '' ? null : config.MAPTILER_KEY,
  }))
}
