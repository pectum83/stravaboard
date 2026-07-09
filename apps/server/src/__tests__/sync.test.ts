import { describe, expect, it } from 'vitest'
import { getActivity, listActivities, upsertActivity } from '../repositories/activities.repo.js'
import { getStreams } from '../repositories/streams.repo.js'
import { getSyncState } from '../repositories/syncState.repo.js'
import { saveTokens } from '../repositories/tokens.repo.js'
import { StravaClient } from '../strava/client.js'
import { SyncService } from '../sync/syncService.js'
import { testConfig, testDb } from './helpers.js'
import { makeActivity, stravaStub, type StravaStubOptions } from './stravaStub.js'
import type { Db } from '../db/client.js'

const config = testConfig({
  STRAVA_API_BASE: 'https://strava.test/api/v3',
  STRAVA_OAUTH_BASE: 'https://strava.test/oauth',
})

function connectedDb(): Db {
  const db = testDb()
  saveTokens(db, {
    athleteId: 1,
    accessToken: 'valid',
    refreshToken: 'r',
    expiresAt: Math.floor(Date.now() / 1000) + 21600,
  })
  return db
}

function makeSync(db: Db, stubOpts: StravaStubOptions, perPage = 200) {
  const stub = stravaStub(stubOpts)
  const client = new StravaClient(config, db, stub.fetchImpl)
  const sleeps: number[] = []
  const sync = new SyncService(db, client, {
    perPage,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
  })
  return { sync, stub, sleeps }
}

const A1 = makeActivity(101, '2026-01-01T08:00:00Z')
const A2 = makeActivity(102, '2026-02-01T08:00:00Z')
const A3 = makeActivity(103, '2026-03-01T08:00:00Z')

async function runSync(sync: SyncService): Promise<void> {
  sync.start()
  await sync.whenIdle()
}

describe('SyncService', () => {
  it('syncs summaries and streams across multiple pages', async () => {
    const db = connectedDb()
    const { sync, stub } = makeSync(db, { activities: [A1, A2, A3] }, 2)
    await runSync(sync)

    expect(listActivities(db, { limit: 10 })).toHaveLength(3)
    expect(getActivity(db, 101)?.streamsStatus).toBe('done')
    expect(getStreams(db, 102)?.altitude).toEqual([100, 101, 102, 103])
    expect(sync.status()).toMatchObject({ state: 'idle', pendingStreams: 0 })
    // Two summary pages (2 + 1) then one streams request per activity.
    expect(stub.requests.filter((r) => r.includes('/athlete/activities'))).toHaveLength(2)
    expect(stub.requests.filter((r) => r.includes('/streams'))).toHaveLength(3)
  })

  it('advances the checkpoint so the next sync only asks for newer activities', async () => {
    const db = connectedDb()
    const first = makeSync(db, { activities: [A1, A2] })
    await runSync(first.sync)
    expect(getSyncState(db).lastActivityStartEpoch).toBe(Date.parse(A2.start_date) / 1000)

    const second = makeSync(db, { activities: [A1, A2, A3] })
    await runSync(second.sync)
    const afterParam = new URL(
      'https://x' + second.stub.requests.find((r) => r.includes('/athlete/activities'))!,
    ).searchParams.get('after')
    expect(Number(afterParam)).toBe(Date.parse(A2.start_date) / 1000 - 1)
    // Only A3's streams are fetched — A1/A2 are already done.
    expect(second.stub.requests.filter((r) => r.includes('/streams'))).toEqual([
      expect.stringContaining('/activities/103/streams'),
    ])
  })

  it('marks activities without streams as none and keeps going', async () => {
    const db = connectedDb()
    const { sync } = makeSync(db, { activities: [A1, A2], noStreams: [101] })
    await runSync(sync)
    expect(getActivity(db, 101)?.streamsStatus).toBe('none')
    expect(getActivity(db, 102)?.streamsStatus).toBe('done')
    expect(sync.status().state).toBe('idle')
  })

  it('sleeps through a 429 and finishes the sync', async () => {
    const db = connectedDb()
    const { sync, sleeps } = makeSync(db, { activities: [A1], rateLimit429Count: 1 })
    await runSync(sync)
    expect(sleeps.length).toBeGreaterThan(0)
    expect(sync.status().state).toBe('idle')
    expect(getActivity(db, 101)?.streamsStatus).toBe('done')
  })

  it('stays idle when no Strava account is connected', async () => {
    const db = testDb() // no tokens
    const { sync, stub } = makeSync(db, { activities: [A1] })
    await runSync(sync)
    expect(sync.status().state).toBe('idle')
    expect(stub.requests.filter((r) => r.includes('/athlete/activities'))).toHaveLength(0)
  })

  it('does not reset a done activity back to pending on re-sync', async () => {
    const db = connectedDb()
    const { sync } = makeSync(db, { activities: [A1] })
    await runSync(sync)
    expect(getActivity(db, 101)?.streamsStatus).toBe('done')

    // Same activity comes back in a later sync window (checkpoint - 1 overlap).
    const again = makeSync(db, { activities: [A1] })
    await runSync(again.sync)
    expect(getActivity(db, 101)?.streamsStatus).toBe('done')
    expect(again.stub.requests.filter((r) => r.includes('/streams'))).toHaveLength(0)
  })

  it('reports an error state on unexpected API failures', async () => {
    const db = connectedDb()
    const stub = stravaStub({ activities: [A1] })
    const failing: typeof stub.fetchImpl = async (input, init) => {
      const url = String(input)
      if (url.includes('/athlete/activities')) return new Response('boom', { status: 500 })
      return stub.fetchImpl(input, init)
    }
    const client = new StravaClient(config, db, failing)
    const sync = new SyncService(db, client, { sleep: async () => {} })
    sync.start()
    await sync.whenIdle()
    expect(sync.status().state).toBe('error')
    expect(sync.status().error).toContain('500')
  })

  it('retries streams left pending by a previous interrupted run', async () => {
    const db = connectedDb()
    // Simulate an interrupted run: summary stored, streams never fetched.
    upsertActivity(db, {
      id: 999,
      name: 'Interrupted',
      sportType: 'TrailRun',
      startDate: '2025-06-01T08:00:00Z',
      startDateEpoch: Date.parse('2025-06-01T08:00:00Z') / 1000,
      distanceM: 1000,
      movingTimeS: 600,
      elapsedTimeS: 600,
      totalElevationGainM: 100,
      streamsStatus: 'pending',
      rawSummary: '{}',
    })
    const { sync } = makeSync(db, { activities: [] })
    await runSync(sync)
    expect(getActivity(db, 999)?.streamsStatus).toBe('done')
  })
})
