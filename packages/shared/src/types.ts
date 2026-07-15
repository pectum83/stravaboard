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
}

export type StreamsStatus = 'pending' | 'done' | 'none'

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
}

export const DEFAULT_SETTINGS: Settings = {
  instantWindowS: 60,
  shortWindowS: 120,
  longWindowS: 300,
  ascentMinGainM: 30,
  ascentDescentToleranceM: 10,
  pauseThresholdS: 30,
}

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
}

export interface ActivitiesPage {
  activities: ActivitySummary[]
  /** Cursor for the next page (pass as ?before=), absent on the last page. */
  nextBefore?: string
}
