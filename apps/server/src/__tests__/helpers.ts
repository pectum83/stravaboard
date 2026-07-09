import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app.js'
import { loadConfig, type Config } from '../config.js'
import { openDb, type Db } from '../db/client.js'

export function testDb(): Db {
  return openDb(':memory:')
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return { ...loadConfig({}), ...overrides }
}

export async function testApp(
  overrides: Partial<Config> = {},
  db: Db = testDb(),
): Promise<{ app: FastifyInstance; db: Db }> {
  const app = await buildApp({ config: testConfig(overrides), db, logger: false })
  return { app, db }
}
