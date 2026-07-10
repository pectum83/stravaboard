import { loadEnvFile } from 'node:process'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { openDb } from './db/client.js'

// Load .env from the package dir or the repo root (dev). Node's loadEnvFile
// never overrides variables already present in the environment, and tsx does
// not forward --env-file flags, so the entry point loads it itself.
for (const envPath of ['.env', '../../.env']) {
  try {
    loadEnvFile(envPath)
  } catch {
    // missing file — fine
  }
}

const config = loadConfig()
const db = openDb(config.DATABASE_PATH)
const { app, sync } = await buildApp({ config, db })

try {
  await app.listen({ port: config.PORT, host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

// "Recover all activities since last import" on launch; skipped when not connected.
sync.start()
