import type { FastifyInstance } from 'fastify'
import type { SyncService } from '../sync/syncService.js'

export function registerSyncRoutes(app: FastifyInstance, sync: SyncService): void {
  app.post('/api/sync', async (_req, reply) => {
    sync.start()
    return reply.code(202).send({ started: true })
  })

  app.get('/api/sync/status', async () => sync.status())
}
