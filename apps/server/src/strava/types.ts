/** Subset of Strava's token response we rely on. */
export interface StravaTokenResponse {
  access_token: string
  refresh_token: string
  /** Unix epoch seconds. */
  expires_at: number
  athlete?: { id: number; firstname?: string; lastname?: string }
}

/** Subset of a Strava SummaryActivity. */
export interface StravaSummaryActivity {
  id: number
  name: string
  sport_type: string
  /** ISO 8601 UTC, e.g. 2026-01-01T10:00:00Z */
  start_date: string
  distance: number
  moving_time: number
  elapsed_time: number
  total_elevation_gain: number
  /** Detail-only fields, used when re-uploading an activity to another account. */
  calories?: number
  commute?: boolean
  trainer?: boolean
  has_heartrate?: boolean
}

/** Response of POST /uploads and GET /uploads/{id}. */
export interface StravaUpload {
  id: number
  external_id: string | null
  /** Human-readable failure ("duplicate of activity 123"); null while healthy. */
  error: string | null
  status: string
  /** Set once Strava finished processing the file. */
  activity_id: number | null
}

/**
 * Streams response with key_by_type=true. Only `time`/`distance`/`altitude`/
 * `latlng` are stored; heart rate and cadence are fetched on demand by the
 * import service (they go into the uploaded TCX, never into the database).
 */
export interface StravaStreamSet {
  time?: { data: number[] }
  distance?: { data: number[] }
  altitude?: { data: number[] }
  latlng?: { data: [number, number][] }
  heartrate?: { data: number[] }
  cadence?: { data: number[] }
}
