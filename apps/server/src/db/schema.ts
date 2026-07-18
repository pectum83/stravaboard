import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** One row per family member who has connected their Strava account. */
export const athletes = sqliteTable('athletes', {
  /** Strava athlete id. */
  id: integer('id').primaryKey(),
  displayName: text('display_name').notNull(),
  createdAt: text('created_at').notNull(),
})

/** One row per connected athlete: their OAuth tokens. */
export const oauthTokens = sqliteTable('oauth_tokens', {
  athleteId: integer('athlete_id').primaryKey(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  /** Unix epoch seconds. */
  expiresAt: integer('expires_at').notNull(),
})

export const activities = sqliteTable(
  'activities',
  {
    /** Strava activity id. */
    id: integer('id').primaryKey(),
    /** Owner (Strava athlete id); default 0 only exists for the ALTER migration. */
    athleteId: integer('athlete_id').notNull().default(0),
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
    /**
     * Whole-activity mean ascent speed (m/h), standard segment parameters —
     * the sort/badge metric. NULL = not computed yet or no altitude data;
     * 0 = computed, no qualifying ascent.
     */
    ascentMeanVSpeed: real('ascent_mean_vspeed'),
    /**
     * Total climbing gain (m) over the kept ascent segments — lift/artefact
     * climbs and sub-threshold bumps excluded (standard segment parameters).
     * Drives the "elevation" sort/badge and the list's D+, instead of Strava's
     * raw total_elevation_gain. NULL = not computed yet; 0 = no qualifying ascent.
     */
    ascentGainM: real('ascent_gain_m'),
    /**
     * Total descent (m, positive) over every detected descent — NOT speed-capped
     * (see shared `activityMetrics`), so fast ski descents count in full. Drives
     * the "descent" sort. NULL = not computed yet; 0 = no qualifying descent.
     */
    descentLossM: real('descent_loss_m'),
    /** Full Strava summary payload (JSON) so future features need no re-sync. */
    rawSummary: text('raw_summary').notNull(),
  },
  (t) => [
    index('idx_activities_athlete_start').on(t.athleteId, t.startDateEpoch),
    index('idx_activities_athlete_vspeed').on(t.athleteId, t.ascentMeanVSpeed),
    index('idx_activities_athlete_descent').on(t.athleteId, t.descentLossM),
  ],
)

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
  /**
   * JSON [lat,lng][] — GPS track. SQL NULL means "not fetched yet" (row
   * predates the column, awaiting backfill); '[]' means "activity has no GPS"
   * (terminal, never re-fetched).
   */
  latlng: text('latlng'),
  fetchedAt: text('fetched_at').notNull(),
})

/** One row per connected athlete: their sync checkpoint and status. */
export const syncState = sqliteTable('sync_state', {
  athleteId: integer('athlete_id').primaryKey(),
  /** Epoch seconds of the newest fully-processed activity; sync resumes after it. */
  lastActivityStartEpoch: integer('last_activity_start_epoch').notNull().default(0),
  status: text('status').notNull().default('idle'),
  error: text('error'),
})

export const settings = sqliteTable('settings', {
  /** `settings:<athleteId>`. */
  key: text('key').primaryKey(),
  /** JSON-encoded value. */
  value: text('value').notNull(),
})
