import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { openDb } from './db/client.js'

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
