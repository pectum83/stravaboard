/** Subset of Strava's token response we rely on. */
export interface StravaTokenResponse {
  access_token: string
  refresh_token: string
  /** Unix epoch seconds. */
  expires_at: number
  athlete?: { id: number }
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
}

/** Streams response with key_by_type=true. */
export interface StravaStreamSet {
  time?: { data: number[] }
  distance?: { data: number[] }
  altitude?: { data: number[] }
  latlng?: { data: [number, number][] }
}
