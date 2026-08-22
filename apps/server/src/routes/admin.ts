import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { isAdmin, type Config } from '../config.js'
import type { Db } from '../db/client.js'
import { addAllowed, listAllowed, removeAllowed } from '../repositories/allowlist.repo.js'

const addSchema = z.object({
  athleteId: z.number().int().positive(),
  note: z.string().trim().max(100).optional(),
})

const idSchema = z.object({ id: z.coerce.number().int().positive() })

export interface AdminRouteOptions {
  /** Stops the process so systemd restarts it; injected in tests. */
  exit: () => void
}

export function registerAdminRoutes(
  app: FastifyInstance,
  config: Config,
  db: Db,
  { exit }: AdminRouteOptions,
): void {
  /** The session guard already answers 401; only the owner gets past this. */
  function denyNonAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
    if (isAdmin(config, req.athleteId)) return false
    void reply.code(403).send({ error: 'forbidden' })
    return true
  }

  app.get('/api/admin/allowlist', async (req, reply) => {
    if (denyNonAdmin(req, reply)) return reply
    return { athletes: listAllowed(db) }
  })

  app.post('/api/admin/allowlist', async (req, reply) => {
    if (denyNonAdmin(req, reply)) return reply
    const parsed = addSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid athlete', details: parsed.error.issues })
    }
    const { athleteId, note } = parsed.data
    addAllowed(db, athleteId, note?.length ? note : null, new Date().toISOString())
    const entry = listAllowed(db).find((a) => a.athleteId === athleteId)
    return reply.code(201).send(entry)
  })

  app.delete('/api/admin/allowlist/:id', async (req, reply) => {
    if (denyNonAdmin(req, reply)) return reply
    const parsed = idSchema.safeParse(req.params)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid athlete id' })
    // Removing yourself would lock the owner out of their own app.
    if (parsed.data.id === config.ADMIN_ATHLETE_ID) {
      return reply.code(400).send({ error: 'cannot remove the administrator' })
    }
    if (!removeAllowed(db, parsed.data.id)) return reply.code(404).send({ error: 'not found' })
    return { removed: true }
  })

  app.post('/api/admin/restart', async (req, reply) => {
    if (denyNonAdmin(req, reply)) return reply
    // Answer first, then quit: systemd (Restart=always) brings the server back.
    setTimeout(exit, 100).unref()
    return reply.code(202).send({ restarting: true })
  })
}
