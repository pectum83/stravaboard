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
  /** Signs the session cookie. MUST be set to a long random value in production. */
  COOKIE_SECRET: z.string().default('dev-secret-do-not-use-in-production'),
  /** Comma-separated Strava athlete ids allowed to connect; empty = anyone. */
  ALLOWED_ATHLETE_IDS: z.string().default(''),
  /** Where the OAuth callback sends the browser back to ('/' when the server serves the app). */
  WEB_APP_URL: z.string().default('/'),
  /** Strava athlete id of the owner; the only one allowed on /api/admin/*. 0 = no admin. */
  ADMIN_ATHLETE_ID: z.coerce.number().int().min(0).default(0),
  /** SMTP relay for the "sign-in refused" alert; empty host/user/password = no mail. */
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().positive().default(465),
  ),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  /** Envelope sender; falls back to SMTP_USER when empty. */
  MAIL_FROM: z.string().default(''),
  /** Where the alerts go; falls back to MAIL_FROM/SMTP_USER when empty. */
  MAIL_TO: z.string().default(''),
})

export type Config = z.infer<typeof envSchema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`)
  }
  return parsed.data
}

/** Parsed ALLOWED_ATHLETE_IDS; empty array = no restriction. */
export function allowedAthleteIds(config: Config): number[] {
  return config.ALLOWED_ATHLETE_IDS.split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
}

/** True for the single owner athlete; false when ADMIN_ATHLETE_ID is unset. */
export function isAdmin(config: Config, athleteId: number): boolean {
  return config.ADMIN_ATHLETE_ID > 0 && athleteId === config.ADMIN_ATHLETE_ID
}
