import type { FastifyInstance } from 'fastify'
import { type ActivitiesPage, STRAVA_SPORT_TYPES } from '@stravaboard/shared'
import { z } from 'zod'
import type { Db } from '../db/client.js'
import {
  type ActivityFilter,
  cursorFor,
  getActivity,
  listActivities,
  listSportTypes,
  parseCursor,
  topByAscentSpeed,
  topByElevation,
  toSummary,
} from '../repositories/activities.repo.js'
import { getStreams } from '../repositories/streams.repo.js'
import { NotFoundError, RateLimitError, StravaApiError } from '../strava/client.js'
import type { SyncService } from '../sync/syncService.js'

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Opaque keyset cursor `<sortValue>:<id>` from a previous page. */
  before: z.string().optional(),
  sort: z.enum(['date', 'ascentSpeed', 'elevation']).default('date'),
  q: z.string().trim().min(1).max(100).optional(),
  from: isoDay.optional(),
  to: isoDay.optional(),
  sportType: z.string().min(1).max(50).optional(),
})

/** Badge rankings take the same filter as the list (minus paging/sort). */
const badgeQuerySchema = listQuerySchema.pick({ q: true, from: true, to: true, sportType: true })

/** Edit body for PATCH /api/activities/:id — at least one field required. */
const editBodySchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    sportType: z.enum(STRAVA_SPORT_TYPES).optional(),
  })
  .refine((b) => b.name !== undefined || b.sportType !== undefined, {
    message: 'provide name and/or sportType',
  })

const dayToEpoch = (day: string): number => Date.parse(`${day}T00:00:00Z`) / 1000

/** Build the repository filter from validated query fields. */
function toFilter(f: {
  q?: string
  from?: string
  to?: string
  sportType?: string
}): ActivityFilter {
  return {
    q: f.q,
    fromEpoch: f.from === undefined ? undefined : dayToEpoch(f.from),
    // `to` day is inclusive for the user: bound by the next midnight.
    toEpochExclusive: f.to === undefined ? undefined : dayToEpoch(f.to) + 86_400,
    sportType: f.sportType,
  }
}

export function registerActivityRoutes(app: FastifyInstance, db: Db, sync: SyncService): void {
  app.get('/api/activities', async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query', details: parsed.error.issues })
    }
    const { limit, before, sort, q, from, to, sportType } = parsed.data
    const cursor = before === undefined ? undefined : parseCursor(before)
    if (before !== undefined && cursor === null) {
      return reply.code(400).send({ error: 'invalid cursor' })
    }
    const rows = listActivities(db, {
      athleteId: req.athleteId,
      limit,
      cursor: cursor ?? undefined,
      sort,
      filter: toFilter({ q, from, to, sportType }),
    })
    const page: ActivitiesPage = {
      activities: rows.map(toSummary),
      ...(rows.length === limit ? { nextBefore: cursorFor(sort, rows[rows.length - 1]!) } : {}),
    }
    return page
  })

  // Top-3 activity ids per ranking, within the current filter — the list
  // decorates them with badges, so a filtered view badges its own best.
  app.get('/api/activities/badges', async (req, reply) => {
    const parsed = badgeQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query', details: parsed.error.issues })
    }
    const filter = toFilter(parsed.data)
    return {
      ascentSpeed: topByAscentSpeed(db, req.athleteId, 3, filter),
      elevation: topByElevation(db, req.athleteId, 3, filter),
    }
  })

  app.get('/api/activities/sport-types', async (req) => listSportTypes(db, req.athleteId))

  // Re-fetch one activity from Strava (after it was edited/cropped there).
  app.post('/api/activities/:id/refresh', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid id' })
    const owned = getActivity(db, id)
    if (!owned || owned.athleteId !== req.athleteId) {
      return reply.code(404).send({ error: 'unknown activity' })
    }
    try {
      return toSummary(await sync.refreshActivity(id))
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ error: 'activity not found on Strava' })
      }
      if (err instanceof RateLimitError) {
        return reply.code(429).send({
          error: 'Strava rate limit reached',
          resumeAt: new Date(err.resumeAtMs).toISOString(),
        })
      }
      throw err
    }
  })

  // Rename / re-type one activity, writing the change through to Strava.
  app.patch('/api/activities/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid id' })
    const parsed = editBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body', details: parsed.error.issues })
    }
    const owned = getActivity(db, id)
    if (!owned || owned.athleteId !== req.athleteId) {
      return reply.code(404).send({ error: 'unknown activity' })
    }
    try {
      return toSummary(await sync.editActivity(id, parsed.data))
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ error: 'activity not found on Strava' })
      }
      if (err instanceof RateLimitError) {
        return reply.code(429).send({
          error: 'Strava rate limit reached',
          resumeAt: new Date(err.resumeAtMs).toISOString(),
        })
      }
      // Missing write scope: Strava rejects with 401/403 until the athlete
      // reconnects and grants activity:write.
      if (err instanceof StravaApiError && (err.status === 401 || err.status === 403)) {
        return reply
          .code(403)
          .send({ error: 'write permission not granted — reconnect your Strava account' })
      }
      throw err
    }
  })

  app.get('/api/activities/:id/streams', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid id' })
    const activity = getActivity(db, id)
    if (!activity || activity.athleteId !== req.athleteId) {
      return reply.code(404).send({ error: 'unknown activity' })
    }
    const streams = getStreams(db, id)
    if (!streams) {
      return reply.code(404).send({ error: 'no streams', streamsStatus: activity.streamsStatus })
    }
    return streams
  })
}
