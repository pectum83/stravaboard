import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app.js'
import { loadConfig, type Config } from '../config.js'
import { openDb, type Db } from '../db/client.js'
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
