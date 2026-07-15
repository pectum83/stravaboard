import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Db } from '../db/client.js'
import { getSettings, saveSettings } from '../repositories/settings.repo.js'

const settingsSchema = z.object({
  instantWindowS: z.number().int().min(1).max(600),
  shortWindowS: z.number().int().min(1).max(3600),
  longWindowS: z.number().int().min(1).max(7200),
  ascentMinGainM: z.number().min(1).max(1000),
  ascentDescentToleranceM: z.number().min(0).max(500),
  pauseThresholdS: z.number().int().min(5).max(600),
})

export function registerSettingsRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/settings', async () => getSettings(db))

  app.put('/api/settings', async (req, reply) => {
    const parsed = settingsSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid settings', details: parsed.error.issues })
    }
    saveSettings(db, parsed.data)
    return parsed.data
  })
}
