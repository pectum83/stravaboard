/** E2E server entry: seeds a fresh database, then boots the real server. */
import { mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { DB_PATH } from './paths.js'
import { seed } from './seed.js'

rmSync(dirname(DB_PATH), { recursive: true, force: true })
mkdirSync(dirname(DB_PATH), { recursive: true })
seed(DB_PATH)

await import('../apps/server/src/index.js')
