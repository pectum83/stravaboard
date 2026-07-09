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
}

export interface Settings {
  /** Window for the instant vertical-speed series, seconds. */
  instantWindowS: number
  /** Window for the short-term vertical-speed series, seconds. */
  shortWindowS: number
  /** Window for the long-term vertical-speed series, seconds. */
  longWindowS: number
  /** Minimum total gain for a climb to count as an ascent, meters. */
  ascentMinGainM: number
  /** Maximum drop inside an ascent before it ends, meters. */
  ascentDescentToleranceM: number
}

export const DEFAULT_SETTINGS: Settings = {
  instantWindowS: 2,
  shortWindowS: 60,
  longWindowS: 300,
  ascentMinGainM: 30,
  ascentDescentToleranceM: 10,
}

export type SyncStateName = 'idle' | 'syncing' | 'waiting_rate_limit' | 'error'

export interface SyncStatus {
  state: SyncStateName
  /** Activities fetched during the current run. */
  fetchedActivities: number
  /** Activities still waiting for their streams. */
  pendingStreams: number
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
