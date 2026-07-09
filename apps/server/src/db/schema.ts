import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** Single-row table (id = 1): tokens of the one connected athlete. */
export const oauthTokens = sqliteTable('oauth_tokens', {
  id: integer('id').primaryKey(),
  athleteId: integer('athlete_id').notNull(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  /** Unix epoch seconds. */
  expiresAt: integer('expires_at').notNull(),
})

export const activities = sqliteTable('activities', {
  /** Strava activity id. */
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  sportType: text('sport_type').notNull(),
  /** ISO 8601 UTC. */
  startDate: text('start_date').notNull(),
  /** Unix epoch seconds — sync checkpoint currency. */
  startDateEpoch: integer('start_date_epoch').notNull(),
  distanceM: real('distance_m').notNull(),
  movingTimeS: integer('moving_time_s').notNull(),
  elapsedTimeS: integer('elapsed_time_s').notNull(),
  totalElevationGainM: real('total_elevation_gain_m').notNull(),
  streamsStatus: text('streams_status', { enum: ['pending', 'done', 'none'] }).notNull(),
  /** Full Strava summary payload (JSON) so future features need no re-sync. */
  rawSummary: text('raw_summary').notNull(),
})

export const activityStreams = sqliteTable('activity_streams', {
  activityId: integer('activity_id')
    .primaryKey()
    .references(() => activities.id),
  /** JSON number[] — seconds since start. */
  time: text('time').notNull(),
  /** JSON number[] — meters from start. */
  distance: text('distance').notNull(),
  /** JSON number[] or null — altitude in meters. */
  altitude: text('altitude'),
  fetchedAt: text('fetched_at').notNull(),
})

/** Single-row table (id = 1): sync checkpoint and status. */
export const syncState = sqliteTable('sync_state', {
  id: integer('id').primaryKey(),
  /** Epoch seconds of the newest fully-processed activity; sync resumes after it. */
  lastActivityStartEpoch: integer('last_activity_start_epoch').notNull().default(0),
  status: text('status').notNull().default('idle'),
  error: text('error'),
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  /** JSON-encoded value. */
  value: text('value').notNull(),
})
