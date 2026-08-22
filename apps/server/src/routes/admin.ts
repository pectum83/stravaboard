import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { AdminAthlete, ImportCandidate } from '@stravaboard/shared'
import { isAdmin, type Config } from '../config.js'
import type { Db } from '../db/client.js'
import { ImportError, importActivity } from '../import/importService.js'
import { addAllowed, listAllowed, removeAllowed } from '../repositories/allowlist.repo.js'
import {
  aggregateActivities,
  listActivities,
  type ActivityRow,
} from '../repositories/activities.repo.js'
import { getAthlete } from '../repositories/athletes.repo.js'
import { listConnectedAthleteIds } from '../repositories/tokens.repo.js'
import { NotFoundError, RateLimitError, StravaApiError } from '../strava/client.js'
import type { StravaClient } from '../strava/client.js'
import type { FetchLike } from '../strava/oauth.js'

const addSchema = z.object({
  athleteId: z.number().int().positive(),
  note: z.string().trim().max(100).optional(),
})

const idSchema = z.object({ id: z.coerce.number().int().positive() })

const candidatesSchema = z.object({
  athleteId: z.coerce.number().int().positive(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

const importSchema = z.object({
  activityId: z.number().int().positive(),
  /** Owner of the activity; read from the local row when omitted. */
  sourceAthleteId: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(2000).optional(),
})

/** ImportError code → HTTP status; everything else is a 500. */
const IMPORT_STATUS: Record<string, number> = {
  'unknown-source': 404,
  'no-streams': 400,
  'no-heartrate': 400,
  duplicate: 409,
  'upload-failed': 502,
  'upload-timeout': 504,
}

export interface AdminRouteOptions {
  /** Stops the process so systemd restarts it; injected in tests. */
  exit: () => void
  /** Strava access for the activity import (token refresh + rate limiter). */
  client: StravaClient
  fetchImpl: FetchLike
  /** Time seams of the upload polling loop; injected in tests. */
  nowMs?: () => number
  sleep?: (ms: number) => Promise<void>
}

export function registerAdminRoutes(
  app: FastifyInstance,
  config: Config,
  db: Db,
  { exit, client, fetchImpl, nowMs, sleep }: AdminRouteOptions,
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

  // The athletes whose activities can be copied: everyone connected.
  app.get('/api/admin/athletes', async (req, reply) => {
    if (denyNonAdmin(req, reply)) return reply
    const athletes: AdminAthlete[] = listConnectedAthleteIds(db).map((id) => ({
      id,
      name: getAthlete(db, id)?.displayName ?? `Athlete ${id}`,
      activityCount: aggregateActivities(db, id, {}).count,
    }))
    return { athletes }
  })

  // Recently synced activities of another athlete, newest first. Read from the
  // local rows — no Strava call until the import itself.
  app.get('/api/admin/import-candidates', async (req, reply) => {
    if (denyNonAdmin(req, reply)) return reply
    const parsed = candidatesSchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query', details: parsed.error.issues })
    }
    const { athleteId, limit } = parsed.data
    const activities = listActivities(db, { athleteId, limit }).map(toCandidate)
    return { activities }
  })

  /**
   * Copy another athlete's activity onto the admin's own account, heart rate
   * included — the "I wore my son's watch" case. Synchronous: Strava takes a
   * few seconds to turn the upload into an activity and the page waits for it.
   */
  app.post('/api/admin/import-activity', async (req, reply) => {
    if (denyNonAdmin(req, reply)) return reply
    const parsed = importSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid import request', details: parsed.error.issues })
    }
    const { activityId, sourceAthleteId, name, description } = parsed.data
    try {
      const result = await importActivity(
        { config, db, client, fetchImpl, nowMs, sleep, log: (msg) => app.log.info(msg) },
        {
          sourceActivityId: activityId,
          sourceAthleteId,
          targetAthleteId: req.athleteId,
          name,
          description,
        },
      )
      return {
        activityId: result.activityId,
        url: result.url,
        name: result.summary.name,
        averageHeartrate: result.summary.averageHeartrate,
        maxHeartrate: result.summary.maxHeartrate,
      }
    } catch (err) {
      if (err instanceof ImportError) {
        return reply.code(IMPORT_STATUS[err.code] ?? 500).send({ error: err.message })
      }
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ error: 'activity not found on Strava' })
      }
      if (err instanceof RateLimitError) {
        return reply.code(429).send({
          error: 'Strava rate limit reached',
          resumeAt: new Date(err.resumeAtMs).toISOString(),
        })
      }
      // Missing write scope on the target account: reconnecting re-grants it.
      if (err instanceof StravaApiError && (err.status === 401 || err.status === 403)) {
        return reply
          .code(403)
          .send({ error: 'write permission not granted — reconnect your Strava account' })
      }
      throw err
    }
  })

  app.post('/api/admin/restart', async (req, reply) => {
    if (denyNonAdmin(req, reply)) return reply
    // Answer first, then quit: systemd (Restart=always) brings the server back.
    setTimeout(exit, 100).unref()
    return reply.code(202).send({ restarting: true })
  })
}

/**
 * `has_heartrate` lives only in the verbatim Strava summary; the picker uses it
 * to grey out the activities an import would gain nothing from.
 */
function toCandidate(row: ActivityRow): ImportCandidate {
  let hasHeartrate = false
  try {
    hasHeartrate =
      (JSON.parse(row.rawSummary) as { has_heartrate?: boolean }).has_heartrate === true
  } catch {
    hasHeartrate = false
  }
  return {
    id: row.id,
    name: row.name,
    sportType: row.sportType,
    startDate: row.startDate,
    distanceM: row.distanceM,
    totalElevationGainM: row.totalElevationGainM,
    hasHeartrate,
  }
}
