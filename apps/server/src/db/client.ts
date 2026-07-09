import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema.js'

export type Db = BetterSQLite3Database<typeof schema>

/**
 * Open (creating if needed) the SQLite database and apply pending migrations.
 * Pass ':memory:' for tests.
 */
export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: migrationsFolder() })
  return db
}

function migrationsFolder(): string {
  // From src this file lives in src/db/ next to migrations/; in the tsup bundle
  // it is inlined into dist/index.js and the build copies migrations to dist/migrations.
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, 'migrations')
}
