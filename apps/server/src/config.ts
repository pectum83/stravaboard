import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  /** Bind address; 127.0.0.1 in production so only the reverse proxy reaches the app. */
  HOST: z.string().default('0.0.0.0'),
  APP_BASE_URL: z.string().url().default('http://localhost:3001'),
  DATABASE_PATH: z.string().default('./data/stravaboard.sqlite'),
  STRAVA_CLIENT_ID: z.string().default(''),
  STRAVA_CLIENT_SECRET: z.string().default(''),
  STRAVA_API_BASE: z.string().url().default('https://www.strava.com/api/v3'),
  STRAVA_OAUTH_BASE: z.string().url().default('https://www.strava.com/oauth'),
  /** Absolute path of the built web app to serve statically; empty in dev. */
  WEB_DIST_PATH: z.string().default(''),
  /** MapTiler API key for map layers; empty disables satellite/3D (OSM fallback). */
  MAPTILER_KEY: z.string().default(''),
  /** Where the OAuth callback sends the browser back to ('/' when the server serves the app). */
  WEB_APP_URL: z.string().default('/'),
})

export type Config = z.infer<typeof envSchema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`)
  }
  return parsed.data
}
