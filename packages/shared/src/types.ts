/** Summary of a synced activity, as served by GET /api/activities. */
export interface ActivitySummary {
  id: number
  name: string
  sportType: string
  /** ISO 8601 start date (UTC). */
  startDate: string
  distanceM: number
  movingTimeS: number
  elapsedTimeS: number
  totalElevationGainM: number
  streamsStatus: StreamsStatus
  /**
   * Whole-activity mean ascent speed (m/h) computed with the standard segment
   * parameters — used for sorting and badges. null until computed or when the
   * activity has no altitude data; 0 when it has no qualifying ascent.
   */
  ascentMeanVSpeed: number | null
  /**
   * Lift-excluded climbing gain (m): the sum of the kept ascent segments
   * (standard parameters, lifts/artefacts removed) — drives the "elevation"
   * sort/badge and the displayed D+. null until computed; 0 when no ascent.
   */
  ascentGainM: number | null
  /**
   * Total descent (m, positive): the sum of every detected descent (standard
   * parameters, NOT speed-capped so fast ski descents count) — drives the
   * "descent" sort and the displayed D−. null until computed; 0 when no descent.
   */
  descentLossM: number | null
}

export type StreamsStatus = 'pending' | 'done' | 'none'

/**
 * Strava's SportType enum values, accepted by the UpdateActivity API as
 * `sport_type`. Single source of truth for the server's edit validation and
 * the frontend's sport-type picker. Order roughly groups related sports.
 */
export const STRAVA_SPORT_TYPES = [
  'Run',
  'TrailRun',
  'VirtualRun',
  'Walk',
  'Hike',
  'Ride',
  'MountainBikeRide',
  'GravelRide',
  'EBikeRide',
  'EMountainBikeRide',
  'VirtualRide',
  'Velomobile',
  'Handcycle',
  'AlpineSki',
  'BackcountrySki',
  'NordicSki',
  'RollerSki',
  'Snowboard',
  'Snowshoe',
  'IceSkate',
  'InlineSkate',
  'Swim',
  'Surfing',
  'Kitesurf',
  'Windsurf',
  'StandUpPaddling',
  'Kayaking',
  'Canoeing',
  'Rowing',
  'VirtualRow',
  'Sail',
  'RockClimbing',
  'Skateboard',
  'Wheelchair',
  'Golf',
  'Soccer',
  'Tennis',
  'TableTennis',
  'Pickleball',
  'Badminton',
  'Racquetball',
  'Squash',
  'Crossfit',
  'Elliptical',
  'HighIntensityIntervalTraining',
  'Pilates',
  'StairStepper',
  'WeightTraining',
  'Workout',
  'Yoga',
] as const

export type SportType = (typeof STRAVA_SPORT_TYPES)[number]

/** Raw per-second streams of an activity, as served by GET /api/activities/:id/streams. */
export interface ActivityStreams {
  /** Seconds since activity start. */
  time: number[]
  /** Meters from start. */
  distance: number[]
  /** Altitude in meters, or null when the activity has no elevation data. */
  altitude: number[] | null
  /** GPS track as [lat, lng] pairs, or null when the activity has no GPS data. */
  latlng: [number, number][] | null
}

export interface Settings {
  /** Window for the instant vertical-speed series, seconds. */
  instantWindowS: number
  /** Window for the short-term vertical-speed series, seconds. */
  shortWindowS: number
  /** Window for the long-term vertical-speed series, seconds. */
  longWindowS: number
  /** Minimum total gain (drop) for an ascent or descent segment to count, meters. */
  ascentMinGainM: number
  /** Maximum counter-move inside an ascent or descent before it ends, meters. */
  ascentDescentToleranceM: number
  /** Minimum stationary duration excluded from ascent/descent means, seconds. */
  pauseThresholdS: number
  /**
   * Radius the position must stay within for a moment to count as stationary,
   * meters. Smaller = stricter (catches only true standstills but may split
   * rests under heavy GPS jitter); larger = more tolerant.
   */
  pauseRadiusM: number
  /** Distance window for the terrain-slope series, meters. */
  slopeWindowM: number
  /**
   * Ascents whose mean vertical speed exceeds this (m/h) are treated as
   * mechanical lifts / GPS artefacts and excluded from the ascent mean on the
   * chart. Slow resort lifts run ~1450 m/h, so the default sits just below.
   */
  liftMaxVSpeed: number
}

export const DEFAULT_SETTINGS: Settings = {
  instantWindowS: 60,
  shortWindowS: 120,
  longWindowS: 300,
  ascentMinGainM: 30,
  ascentDescentToleranceM: 10,
  pauseThresholdS: 30,
  // Matches PAUSE_RADIUS_M (see vspeed/pauses); tuned on production data.
  pauseRadiusM: 5,
  slopeWindowM: 100,
  // Kept in step with MAX_HUMAN_VSPEED (the default metric cap) — see vspeed/stats.
  liftMaxVSpeed: 1400,
}

/**
 * Settings that feed the STORED ranking metrics (mean ascent speed, climbing
 * gain, descent) — exactly the fields `metricParamsFromSettings` reads. Changing
 * any of them recomputes the stored metrics server-side and reloads the list;
 * the window/slope settings only affect the live chart, so they're excluded.
 */
export const METRIC_SETTING_KEYS: readonly (keyof Settings)[] = [
  'ascentMinGainM',
  'ascentDescentToleranceM',
  'pauseThresholdS',
  'pauseRadiusM',
  'liftMaxVSpeed',
]

export type SyncStateName = 'idle' | 'syncing' | 'waiting_rate_limit' | 'error'

export interface SyncStatus {
  state: SyncStateName
  /** Activities fetched during the current run. */
  fetchedActivities: number
  /** Activities still waiting for their streams. */
  pendingStreams: number
  /** Already-synced activities whose streams still lack a GPS track (one-time backfill). */
  pendingLatlngBackfill: number
  /** ISO date the sync will resume at when rate-limited. */
  rateLimitResumeAt?: string
  error?: string
}

export interface AuthStatus {
  connected: boolean
  athleteId?: number
  /** Display name of the logged-in athlete. */
  name?: string
}

/** Top-3 activity ids per ranking, best first. */
export interface ActivityBadges {
  ascentSpeed: number[]
  elevation: number[]
}

export interface ActivitiesPage {
  activities: ActivitySummary[]
  /** Cursor for the next page (pass as ?before=), absent on the last page. */
  nextBefore?: string
}

/** Whole-filter totals for the activity list (all matches, not just the loaded page). */
export interface ActivityAggregate {
  /** Number of activities matching the current filter. */
  count: number
  /** Cumulated lift-excluded climbing gain (m) across those activities. */
  totalAscentGainM: number
}
