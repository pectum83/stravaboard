import type { FastifyInstance } from 'fastify'
import type { ActivitiesPage } from '@stravaboard/shared'
import { z } from 'zod'
import type { Db } from '../db/client.js'
import { getActivity, listActivities, toSummary } from '../repositories/activities.repo.js'
import { getStreams } from '../repositories/streams.repo.js'

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.number().int().positive().optional(),
})

export function registerActivityRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/activities', async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query', details: parsed.error.issues })
    }
    const { limit, before } = parsed.data
    const rows = listActivities(db, { limit, beforeEpoch: before })
    const page: ActivitiesPage = {
      activities: rows.map(toSummary),
      ...(rows.length === limit
        ? { nextBefore: String(rows[rows.length - 1]!.startDateEpoch) }
        : {}),
    }
    return page
  })

  app.get('/api/activities/:id/streams', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid id' })
    const activity = getActivity(db, id)
    if (!activity) return reply.code(404).send({ error: 'unknown activity' })
    const streams = getStreams(db, id)
    if (!streams) {
      return reply.code(404).send({ error: 'no streams', streamsStatus: activity.streamsStatus })
    }
    return streams
  })
}
