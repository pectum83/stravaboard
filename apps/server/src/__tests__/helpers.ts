import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app.js'
import { loadConfig, type Config } from '../config.js'
import { openDb, type Db } from '../db/client.js'
import { upsertAthlete } from '../repositories/athletes.repo.js'
import { saveTokens } from '../repositories/tokens.repo.js'
import type { FetchLike } from '../strava/oauth.js'
import type { SyncService } from '../sync/syncService.js'

export function testDb(): Db {
  return openDb(':memory:')
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return { ...loadConfig({}), ...overrides }
}

export async function testApp(
  overrides: Partial<Config> = {},
  db: Db = testDb(),
  fetchImpl?: FetchLike,
): Promise<{ app: FastifyInstance; db: Db; sync: SyncService }> {
  const { app, sync } = await buildApp({
    config: testConfig(overrides),
    db,
    logger: false,
    fetchImpl,
    syncOptions: { sleep: async () => {} },
  })
  return { app, db, sync }
}

/** Signed session cookie for `app.inject({ cookies: session(app, id) })`. */
export function session(app: FastifyInstance, athleteId: number): Record<string, string> {
  return { session: app.signCookie(String(athleteId)) }
}

/** Register an athlete with stored tokens — the connected state. */
export function connectAthlete(db: Db, athleteId: number, name = `Athlete ${athleteId}`): void {
  upsertAthlete(db, athleteId, name, '2026-01-01T00:00:00Z')
  saveTokens(db, {
    athleteId,
    accessToken: 'valid',
    refreshToken: 'r',
    expiresAt: Math.floor(Date.now() / 1000) + 21600,
  })
}
