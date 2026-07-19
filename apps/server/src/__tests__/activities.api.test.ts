import { describe, expect, it } from 'vitest'
import { getActivity, upsertActivity, type ActivityRow } from '../repositories/activities.repo.js'
import { getStreams, saveStreams } from '../repositories/streams.repo.js'
import type { Db } from '../db/client.js'
import { connectAthlete, session, testApp, testDb } from './helpers.js'
import { makeActivity, stravaStub, type StravaStubOptions } from './stravaStub.js'

function activity(id: number, epoch: number, overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id,
    athleteId: 1,
    name: `Activity ${id}`,
    sportType: 'TrailRun',
    startDate: new Date(epoch * 1000).toISOString(),
    startDateEpoch: epoch,
    distanceM: 10_000,
    movingTimeS: 3600,
    elapsedTimeS: 3700,
    totalElevationGainM: 500,
    streamsStatus: 'done',
    rawSummary: '{}',
    ...overrides,
  }
}

async function appWithAthlete(db = testDb()) {
  connectAthlete(db, 1)
  const { app } = await testApp({}, db)
  return { app, db, cookies: session(app, 1) }
}

describe('activities API', () => {
  it('requires a session', async () => {
    const { app } = await testApp()
    expect((await app.inject({ method: 'GET', url: '/api/activities' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/api/activities/1/streams' })).statusCode) //
      .toBe(401)
    expect(
      (await app.inject({ method: 'PATCH', url: '/api/activities/1', payload: { name: 'x' } }))
        .statusCode,
    ).toBe(401)
  })

  it('lists newest-first with keyset pagination', async () => {
    const db = testDb()
    for (let i = 1; i <= 5; i++) upsertActivity(db, activity(i, i * 1000))
    const { app, cookies } = await appWithAthlete(db)

    const p1 = await app.inject({ method: 'GET', url: '/api/activities?limit=2', cookies })
    const body1 = p1.json()
    expect(body1.activities.map((a: { id: number }) => a.id)).toEqual([5, 4])
    expect(body1.nextBefore).toBe('4000:4')

    const p2 = await app.inject({
      method: 'GET',
      url: `/api/activities?limit=2&before=${body1.nextBefore}`,
      cookies,
    })
    expect(p2.json().activities.map((a: { id: number }) => a.id)).toEqual([3, 2])

    const last = await app.inject({
      method: 'GET',
      url: `/api/activities?limit=2&before=${p2.json().nextBefore}`,
      cookies,
    })
    expect(last.json().activities.map((a: { id: number }) => a.id)).toEqual([1])
    expect(last.json().nextBefore).toBeUndefined()
  })

  it('sorts by ascent speed and elevation with paging cursors', async () => {
    const db = testDb()
    upsertActivity(db, activity(1, 1000, { ascentMeanVSpeed: 500, ascentGainM: 100 }))
    upsertActivity(db, activity(2, 2000, { ascentMeanVSpeed: 900, ascentGainM: 50 }))
    upsertActivity(db, activity(3, 3000, { ascentMeanVSpeed: null, ascentGainM: 800 }))
    const { app, cookies } = await appWithAthlete(db)

    const speed = await app.inject({
      method: 'GET',
      url: '/api/activities?sort=ascentSpeed',
      cookies,
    })
    expect(speed.json().activities.map((a: { id: number }) => a.id)).toEqual([2, 1, 3])
    expect(speed.json().activities[0].ascentMeanVSpeed).toBe(900)

    const p1 = await app.inject({
      method: 'GET',
      url: '/api/activities?sort=elevation&limit=1',
      cookies,
    })
    expect(p1.json().activities[0].id).toBe(3)
    const p2 = await app.inject({
      method: 'GET',
      url: `/api/activities?sort=elevation&limit=1&before=${p1.json().nextBefore}`,
      cookies,
    })
    expect(p2.json().activities[0].id).toBe(1)

    const bad = await app.inject({
      method: 'GET',
      url: '/api/activities?sort=elevation&before=garbage',
      cookies,
    })
    expect(bad.statusCode).toBe(400)
  })

  it('sorts by total descent, biggest drop first with NULL last', async () => {
    const db = testDb()
    upsertActivity(db, activity(1, 1000, { descentLossM: 300 }))
    upsertActivity(db, activity(2, 2000, { descentLossM: 1500 })) // biggest drop (ski)
    upsertActivity(db, activity(3, 3000, { descentLossM: null })) // not computed yet
    const { app, cookies } = await appWithAthlete(db)

    const res = await app.inject({ method: 'GET', url: '/api/activities?sort=descent', cookies })
    expect(res.json().activities.map((a: { id: number }) => a.id)).toEqual([2, 1, 3])
    expect(res.json().activities[0].descentLossM).toBe(1500)
  })

  it('serves whole-filter totals (count + cumulated D+)', async () => {
    const db = testDb()
    upsertActivity(db, activity(1, 1000, { sportType: 'Hike', ascentGainM: 200 }))
    upsertActivity(db, activity(2, 2000, { sportType: 'Hike', ascentGainM: 800 }))
    upsertActivity(db, activity(3, 3000, { sportType: 'Run', ascentGainM: 500 }))
    const { app, cookies } = await appWithAthlete(db)

    const all = await app.inject({ method: 'GET', url: '/api/activities/stats', cookies })
    expect(all.json()).toEqual({ count: 3, totalAscentGainM: 1500 })

    const hike = await app.inject({
      method: 'GET',
      url: '/api/activities/stats?sportType=Hike',
      cookies,
    })
    expect(hike.json()).toEqual({ count: 2, totalAscentGainM: 1000 })

    const bad = await app.inject({ method: 'GET', url: '/api/activities/stats?from=nope', cookies })
    expect(bad.statusCode).toBe(400)
  })

  it('serves top-3 badges per ranking', async () => {
    const db = testDb()
    for (const [id, vspeed, gain] of [
      [1, 500, 100],
      [2, 900, 50],
      [3, 0, 800],
      [4, 700, 200],
      [5, 600, 300],
    ] as const) {
      upsertActivity(db, activity(id, id * 1000, { ascentMeanVSpeed: vspeed, ascentGainM: gain }))
    }
    const { app, cookies } = await appWithAthlete(db)
    const res = await app.inject({ method: 'GET', url: '/api/activities/badges', cookies })
    // Effort (all 10 km): 5 → 14.5, 4 → 13.5, 1 → 11.25 km-effort.
    expect(res.json()).toEqual({
      ascentSpeed: [2, 4, 5],
      elevation: [3, 5, 4],
      effort: [5, 4, 1],
    })
  })

  it('restricts badges to the query filter', async () => {
    const db = testDb()
    upsertActivity(db, activity(1, 1000, { ascentMeanVSpeed: 900, sportType: 'Run' }))
    upsertActivity(db, activity(2, 2000, { ascentMeanVSpeed: 500, sportType: 'Hike' }))
    upsertActivity(db, activity(3, 3000, { ascentMeanVSpeed: 700, sportType: 'Hike' }))
    const { app, cookies } = await appWithAthlete(db)
    const res = await app.inject({
      method: 'GET',
      url: '/api/activities/badges?sportType=Hike',
      cookies,
    })
    expect(res.json().ascentSpeed).toEqual([3, 2])
  })

  it("never serves another athlete's activities or streams", async () => {
    const db = testDb()
    connectAthlete(db, 2)
    upsertActivity(db, activity(1, 1000)) // athlete 1
    upsertActivity(db, activity(2, 2000, { athleteId: 2 }))
    saveStreams(db, 2, { time: [0], distance: [0], altitude: [1], latlng: [] }, '2026-01-01')
    const { app, cookies } = await appWithAthlete(db)

    const list = await app.inject({ method: 'GET', url: '/api/activities', cookies })
    expect(list.json().activities.map((a: { id: number }) => a.id)).toEqual([1])

    const streams = await app.inject({ method: 'GET', url: '/api/activities/2/streams', cookies })
    expect(streams.statusCode).toBe(404)

    const refresh = await app.inject({
      method: 'POST',
      url: '/api/activities/2/refresh',
      cookies,
    })
    expect(refresh.statusCode).toBe(404)
  })

  it('rejects invalid pagination query', async () => {
    const { app, cookies } = await appWithAthlete()
    const res = await app.inject({ method: 'GET', url: '/api/activities?limit=0', cookies })
    expect(res.statusCode).toBe(400)
  })

  it('filters by name substring, case-insensitively', async () => {
    const db = testDb()
    upsertActivity(db, activity(1, 1000, { name: 'Morning Mountain Run' }))
    upsertActivity(db, activity(2, 2000, { name: 'Flat River Loop' }))
    const { app, cookies } = await appWithAthlete(db)

    const res = await app.inject({ method: 'GET', url: '/api/activities?q=mountain', cookies })
    expect(res.json().activities.map((a: { id: number }) => a.id)).toEqual([1])

    const none = await app.inject({ method: 'GET', url: '/api/activities?q=alpine', cookies })
    expect(none.json().activities).toEqual([])
  })

  it('matches LIKE wildcards in the search literally', async () => {
    const db = testDb()
    upsertActivity(db, activity(1, 1000, { name: '100% climb' }))
    upsertActivity(db, activity(2, 2000, { name: 'plain run' }))
    const { app, cookies } = await appWithAthlete(db)
    const res = await app.inject({ method: 'GET', url: '/api/activities?q=%25', cookies }) // '%'
    expect(res.json().activities.map((a: { id: number }) => a.id)).toEqual([1])
  })

  it('filters by inclusive date range', async () => {
    const db = testDb()
    const day = (d: string) => Date.parse(`${d}T12:00:00Z`) / 1000
    upsertActivity(db, activity(1, day('2026-06-10')))
    upsertActivity(db, activity(2, day('2026-06-15')))
    upsertActivity(db, activity(3, day('2026-06-20')))
    const { app, cookies } = await appWithAthlete(db)

    const res = await app.inject({
      method: 'GET',
      url: '/api/activities?from=2026-06-12&to=2026-06-15',
      cookies,
    })
    // `to` day itself is included
    expect(res.json().activities.map((a: { id: number }) => a.id)).toEqual([2])

    const upper = await app.inject({ method: 'GET', url: '/api/activities?to=2026-06-15', cookies })
    expect(upper.json().activities.map((a: { id: number }) => a.id)).toEqual([2, 1])
  })

  it('filters by sport type and combines filters with pagination', async () => {
    const db = testDb()
    for (let i = 1; i <= 4; i++) {
      upsertActivity(db, activity(i, i * 1000, { sportType: i % 2 === 0 ? 'Run' : 'TrailRun' }))
    }
    const { app, cookies } = await appWithAthlete(db)

    const runs = await app.inject({ method: 'GET', url: '/api/activities?sportType=Run', cookies })
    expect(runs.json().activities.map((a: { id: number }) => a.id)).toEqual([4, 2])

    // Cursor pages stay consistent under an active filter
    const p1 = await app.inject({
      method: 'GET',
      url: '/api/activities?sportType=Run&limit=1',
      cookies,
    })
    expect(p1.json().activities.map((a: { id: number }) => a.id)).toEqual([4])
    const p2 = await app.inject({
      method: 'GET',
      url: `/api/activities?sportType=Run&limit=1&before=${p1.json().nextBefore}`,
      cookies,
    })
    expect(p2.json().activities.map((a: { id: number }) => a.id)).toEqual([2])
  })

  it('rejects malformed date filters', async () => {
    const { app, cookies } = await appWithAthlete()
    const res = await app.inject({
      method: 'GET',
      url: '/api/activities?from=15-06-2026',
      cookies,
    })
    expect(res.statusCode).toBe(400)
  })

  it('lists distinct analyzable sport types, sorted', async () => {
    const db = testDb()
    upsertActivity(db, activity(1, 1000, { sportType: 'TrailRun' }))
    upsertActivity(db, activity(2, 2000, { sportType: 'Run' }))
    upsertActivity(db, activity(3, 3000, { sportType: 'TrailRun' }))
    // No-elevation sport (e.g. indoor trainer) is excluded from the filter.
    upsertActivity(db, activity(4, 4000, { sportType: 'Workout', totalElevationGainM: 0 }))
    const { app, cookies } = await appWithAthlete(db)
    const res = await app.inject({ method: 'GET', url: '/api/activities/sport-types', cookies })
    expect(res.json()).toEqual(['Run', 'TrailRun'])
  })

  describe('POST /api/activities/:id/refresh', () => {
    async function refreshApp(db: Db, stubOpts: StravaStubOptions) {
      connectAthlete(db, 1)
      const stub = stravaStub(stubOpts)
      const { app } = await testApp(
        {
          STRAVA_API_BASE: 'https://strava.test/api/v3',
          STRAVA_OAUTH_BASE: 'https://strava.test/oauth',
        },
        db,
        stub.fetchImpl,
      )
      return { app, cookies: session(app, 1) }
    }

    it('re-fetches the summary and streams from Strava', async () => {
      const db = testDb()
      upsertActivity(db, activity(101, 1000, { name: 'Before crop' }))
      saveStreams(db, 101, { time: [0, 1], distance: [0, 5], altitude: [1, 2], latlng: [] }, 'old')

      const cropped = makeActivity(101, new Date(1000 * 1000).toISOString(), {
        name: 'After crop',
        distance: 9000,
      })
      const { app, cookies } = await refreshApp(db, { activities: [cropped] })

      const res = await app.inject({ method: 'POST', url: '/api/activities/101/refresh', cookies })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ id: 101, name: 'After crop', distanceM: 9000 })
      // Streams replaced by the stub's fresh set (incl. latlng)
      expect(getStreams(db, 101)?.altitude).toEqual([100, 101, 102, 103])
      expect(getStreams(db, 101)?.latlng).not.toBeNull()
      expect(getActivity(db, 101)?.streamsStatus).toBe('done')
    })

    it('404s for an activity unknown locally', async () => {
      const { app, cookies } = await refreshApp(testDb(), { activities: [] })
      const res = await app.inject({ method: 'POST', url: '/api/activities/9/refresh', cookies })
      expect(res.statusCode).toBe(404)
    })

    it('404s without touching local data when Strava no longer has the activity', async () => {
      const db = testDb()
      upsertActivity(db, activity(101, 1000, { name: 'Kept' }))
      const { app, cookies } = await refreshApp(db, { activities: [] })

      const res = await app.inject({ method: 'POST', url: '/api/activities/101/refresh', cookies })
      expect(res.statusCode).toBe(404)
      expect(res.json().error).toContain('Strava')
      expect(getActivity(db, 101)?.name).toBe('Kept')
    })

    it('drops stale streams when Strava stops serving them', async () => {
      const db = testDb()
      upsertActivity(db, activity(101, 1000))
      saveStreams(db, 101, { time: [0], distance: [0], altitude: [1], latlng: [] }, 'old')
      const { app, cookies } = await refreshApp(db, {
        activities: [makeActivity(101, new Date(1000 * 1000).toISOString())],
        noStreams: [101],
      })

      const res = await app.inject({ method: 'POST', url: '/api/activities/101/refresh', cookies })
      expect(res.statusCode).toBe(200)
      expect(res.json().streamsStatus).toBe('none')
      expect(getStreams(db, 101)).toBeNull()
    })

    it('surfaces Strava rate limiting as 429 with a resume time', async () => {
      const db = testDb()
      upsertActivity(db, activity(101, 1000))
      const { app, cookies } = await refreshApp(db, {
        activities: [makeActivity(101, new Date(1000 * 1000).toISOString())],
        rateLimit429Count: 1,
      })

      const res = await app.inject({ method: 'POST', url: '/api/activities/101/refresh', cookies })
      expect(res.statusCode).toBe(429)
      expect(res.json().resumeAt).toBeDefined()
    })
  })

  describe('PATCH /api/activities/:id', () => {
    async function editApp(db: Db, stubOpts: StravaStubOptions) {
      connectAthlete(db, 1)
      const stub = stravaStub(stubOpts)
      const { app } = await testApp(
        {
          STRAVA_API_BASE: 'https://strava.test/api/v3',
          STRAVA_OAUTH_BASE: 'https://strava.test/oauth',
        },
        db,
        stub.fetchImpl,
      )
      return { app, cookies: session(app, 1), requests: stub.requests }
    }

    const start = new Date(1000 * 1000).toISOString()

    it('renames an activity, writing through to Strava and locally', async () => {
      const db = testDb()
      upsertActivity(db, activity(101, 1000, { name: 'Old name' }))
      const { app, cookies, requests } = await editApp(db, {
        activities: [makeActivity(101, start, { name: 'Old name' })],
      })

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/activities/101',
        cookies,
        payload: { name: 'New name' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ id: 101, name: 'New name' })
      expect(getActivity(db, 101)?.name).toBe('New name')
      // The write went out as a PUT to the activity.
      expect(requests).toContain('/api/v3/activities/101')
    })

    it('changes the sport type', async () => {
      const db = testDb()
      upsertActivity(db, activity(101, 1000, { sportType: 'Run' }))
      const { app, cookies } = await editApp(db, {
        activities: [makeActivity(101, start, { sport_type: 'Run' })],
      })

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/activities/101',
        cookies,
        payload: { sportType: 'Hike' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().sportType).toBe('Hike')
      expect(getActivity(db, 101)?.sportType).toBe('Hike')
    })

    it('rejects an empty body', async () => {
      const db = testDb()
      upsertActivity(db, activity(101, 1000))
      const { app, cookies } = await editApp(db, { activities: [makeActivity(101, start)] })
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/activities/101',
        cookies,
        payload: {},
      })
      expect(res.statusCode).toBe(400)
    })

    it('rejects an unknown sport type', async () => {
      const db = testDb()
      upsertActivity(db, activity(101, 1000))
      const { app, cookies } = await editApp(db, { activities: [makeActivity(101, start)] })
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/activities/101',
        cookies,
        payload: { sportType: 'Teleportation' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('404s for an activity unknown locally', async () => {
      const { app, cookies } = await editApp(testDb(), { activities: [] })
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/activities/9',
        cookies,
        payload: { name: 'x' },
      })
      expect(res.statusCode).toBe(404)
    })

    it("never edits another athlete's activity", async () => {
      const db = testDb()
      connectAthlete(db, 2)
      upsertActivity(db, activity(202, 2000, { athleteId: 2, name: 'Theirs' }))
      const { app, cookies } = await editApp(db, {
        activities: [makeActivity(202, start, { name: 'Theirs' })],
      })
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/activities/202',
        cookies,
        payload: { name: 'Hijacked' },
      })
      expect(res.statusCode).toBe(404)
      expect(getActivity(db, 202)?.name).toBe('Theirs')
    })

    it('maps a missing write scope (Strava 403) to a reconnect message', async () => {
      const db = testDb()
      upsertActivity(db, activity(101, 1000))
      const { app, cookies } = await editApp(db, {
        activities: [makeActivity(101, start)],
        updateStatus: 403,
      })
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/activities/101',
        cookies,
        payload: { name: 'New name' },
      })
      expect(res.statusCode).toBe(403)
      expect(res.json().error).toContain('reconnect')
    })

    it('surfaces Strava rate limiting as 429 with a resume time', async () => {
      const db = testDb()
      upsertActivity(db, activity(101, 1000))
      const { app, cookies } = await editApp(db, {
        activities: [makeActivity(101, start)],
        rateLimit429Count: 1,
      })
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/activities/101',
        cookies,
        payload: { name: 'New name' },
      })
      expect(res.statusCode).toBe(429)
      expect(res.json().resumeAt).toBeDefined()
    })
  })

  it('serves stored streams', async () => {
    const db = testDb()
    upsertActivity(db, activity(1, 1000))
    const latlng: [number, number][] = [
      [45.1, 6.05],
      [45.10005, 6.05],
    ]
    saveStreams(db, 1, { time: [0, 1], distance: [0, 5], altitude: [10, 11], latlng }, '2026-01-01')
    const { app, cookies } = await appWithAthlete(db)
    const res = await app.inject({ method: 'GET', url: '/api/activities/1/streams', cookies })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ time: [0, 1], distance: [0, 5], altitude: [10, 11], latlng })
  })

  it('404s with the streams status when streams are absent', async () => {
    const db = testDb()
    upsertActivity(db, activity(1, 1000, { streamsStatus: 'none' }))
    const { app, cookies } = await appWithAthlete(db)
    const res = await app.inject({ method: 'GET', url: '/api/activities/1/streams', cookies })
    expect(res.statusCode).toBe(404)
    expect(res.json().streamsStatus).toBe('none')
  })

  it('404s for an unknown activity', async () => {
    const { app, cookies } = await appWithAthlete()
    const res = await app.inject({ method: 'GET', url: '/api/activities/9/streams', cookies })
    expect(res.statusCode).toBe(404)
  })
})
