import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export const DB_PATH = join(here, '.tmp', 'e2e.sqlite')
export const WEB_DIST = join(here, '..', 'apps', 'web', 'dist')
export const SERVER_ENTRY = join(here, '..', 'apps', 'server', 'src', 'index.ts')

export const APP_PORT = 3998
export const STUB_PORT = 4599
