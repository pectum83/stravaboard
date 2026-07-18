import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { METRIC_SETTING_KEYS, metricParamsFromSettings } from '@stravaboard/shared'
import type { Db } from '../db/client.js'
import { recomputeAllMetrics } from '../metrics/recompute.js'
import { getSettings, saveSettings } from '../repositories/settings.repo.js'

const settingsSchema = z.object({
  instantWindowS: z.number().int().min(1).max(600),
  shortWindowS: z.number().int().min(1).max(3600),
  longWindowS: z.number().int().min(1).max(7200),
  ascentMinGainM: z.number().min(1).max(1000),
  ascentDescentToleranceM: z.number().min(0).max(500),
  pauseThresholdS: z.number().int().min(5).max(600),
  pauseRadiusM: z.number().int().min(2).max(15),
  slopeWindowM: z.number().int().min(10).max(2000),
  liftMaxVSpeed: z.number().int().min(500).max(6000),
})

export function registerSettingsRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/settings', async (req) => getSettings(db, req.athleteId))

  app.put('/api/settings', async (req, reply) => {
    const parsed = settingsSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid settings', details: parsed.error.issues })
    }
    const previous = getSettings(db, req.athleteId)
    saveSettings(db, req.athleteId, parsed.data)
    // A change to any metric-affecting setting re-ranks this athlete's
    // activities: recompute their stored metrics (local, no Strava calls) so the
    // sort, badges and list figures agree with the chart. Window/slope-only
    // changes touch just the live chart, so they skip this.
    if (METRIC_SETTING_KEYS.some((k) => previous[k] !== parsed.data[k])) {
      recomputeAllMetrics(db, req.athleteId, metricParamsFromSettings(parsed.data))
    }
    return parsed.data
  })
}
