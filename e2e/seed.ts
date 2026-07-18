/**
 * Seeds a stravaBoard database with fixture activities for e2e tests and
 * local UI work. Usage: SEED_DB_PATH=/tmp/seed.sqlite tsx seed.ts
 */
import { activityMetrics } from '@stravaboard/shared'
import { openDb } from '../apps/server/src/db/client.js'
import { upsertActivity } from '../apps/server/src/repositories/activities.repo.js'
import { upsertAthlete } from '../apps/server/src/repositories/athletes.repo.js'
import { saveStreams } from '../apps/server/src/repositories/streams.repo.js'
import { saveTokens } from '../apps/server/src/repositories/tokens.repo.js'
import { saveSyncState } from '../apps/server/src/repositories/syncState.repo.js'

/** The athlete the Strava stub logs in as. */
export const E2E_ATHLETE_ID = 4242

interface Profile {
  time: number[]
  distance: number[]
  altitude: number[] | null
  latlng: [number, number][] | null
}

/** Meters of northward travel per degree of latitude. */
const M_PER_DEG_LAT = 111_320

/** GPS track heading north from [45.1, 6.05], displacement matching distance. */
function trackFromDistance(distance: number[]): [number, number][] {
  return distance.map((d): [number, number] => [45.1 + d / M_PER_DEG_LAT, 6.05])
}

/**
 * A mountain run: two climbs (400 m and 250 m) separated by a descent, with
 * noise, and a 90 s standstill in the middle of climb 1 (position frozen, so
 * the pause exclusion is observable in the ascent mean).
 */
function mountainProfile(): Profile {
  const time: number[] = []
  const distance: number[] = []
  const altitude: number[] = []
  let alt = 800
  let dist = 0
  const legs: Array<{ durationS: number; vSpeed: number; speed: number }> = [
    { durationS: 900, vSpeed: 0.22, speed: 1.7 }, // climb 1, first half
    { durationS: 90, vSpeed: 0, speed: 0 }, // standstill (pause)
    { durationS: 900, vSpeed: 0.22, speed: 1.7 }, // climb 1, second half
    { durationS: 900, vSpeed: -0.3, speed: 2.8 }, // descent
    { durationS: 1500, vSpeed: 0.17, speed: 1.8 }, // climb 2: ~250 m
    { durationS: 1200, vSpeed: -0.35, speed: 3.0 }, // final descent
  ]
  let t = 0
  for (const leg of legs) {
    for (let s = 0; s < leg.durationS; s++) {
      // Deterministic pseudo-noise ±0.4 m
      const noise = 0.4 * Math.sin(t * 1.7) * Math.cos(t * 0.31)
      time.push(t)
      distance.push(dist)
      altitude.push(alt + noise)
      alt += leg.vSpeed
      dist += leg.speed
      t++
    }
  }
  return { time, distance, altitude, latlng: trackFromDistance(distance) }
}

/** A flat road run. */
function flatProfile(): Profile {
  const time: number[] = []
  const distance: number[] = []
  const altitude: number[] = []
  for (let t = 0; t <= 2400; t++) {
    time.push(t)
    distance.push(t * 3.2)
    altitude.push(120 + 0.2 * Math.sin(t / 60))
  }
  return { time, distance, altitude, latlng: trackFromDistance(distance) }
}

export function seed(dbPath: string): void {
  const db = openDb(dbPath)

  upsertAthlete(db, E2E_ATHLETE_ID, 'E2E Tester', new Date().toISOString())
  saveTokens(db, {
    athleteId: E2E_ATHLETE_ID,
    accessToken: 'e2e-access',
    refreshToken: 'e2e-refresh',
    expiresAt: Math.floor(Date.now() / 1000) + 86_400 * 365,
  })

  const fixtures = [
    {
      id: 1,
      name: 'Morning Mountain Run',
      sportType: 'TrailRun',
      startDate: '2026-06-20T07:30:00Z',
      profile: mountainProfile(),
      gain: 650,
    },
    {
      id: 2,
      name: 'Flat River Loop',
      sportType: 'Run',
      startDate: '2026-06-15T18:00:00Z',
      profile: flatProfile(),
      gain: 5,
    },
    {
      id: 3,
      name: 'Indoor Trainer Session',
      sportType: 'VirtualRide',
      startDate: '2026-06-10T19:00:00Z',
      profile: null,
      gain: 0,
    },
  ]

  for (const f of fixtures) {
    const lastDistance = f.profile?.distance.at(-1) ?? 15_000
    const lastTime = f.profile?.time.at(-1) ?? 3600
    // Same metrics the sync would compute, so the seeded list looks realistic.
    const metrics = f.profile ? activityMetrics(f.profile) : null
    upsertActivity(db, {
      id: f.id,
      athleteId: E2E_ATHLETE_ID,
      name: f.name,
      sportType: f.sportType,
      startDate: f.startDate,
      startDateEpoch: Math.floor(Date.parse(f.startDate) / 1000),
      distanceM: lastDistance,
      movingTimeS: lastTime,
      elapsedTimeS: lastTime,
      totalElevationGainM: f.gain,
      ascentMeanVSpeed: metrics?.meanVSpeed ?? null,
      ascentGainM: metrics?.gainM ?? null,
      descentLossM: metrics?.descentLossM ?? null,
      streamsStatus: f.profile ? 'done' : 'none',
      rawSummary: '{}',
    })
    if (f.profile) {
      saveStreams(db, f.id, f.profile, new Date().toISOString())
    }
  }

  saveSyncState(db, E2E_ATHLETE_ID, {
    lastActivityStartEpoch: Math.floor(Date.parse('2026-06-20T07:30:00Z') / 1000),
    status: 'idle',
  })
}

const target = process.env.SEED_DB_PATH
if (target) {
  seed(target)
  console.log(`seeded ${target}`)
}
