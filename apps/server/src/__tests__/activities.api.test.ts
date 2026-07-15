import { describe, expect, it } from 'vitest'
import { upsertActivity, type ActivityRow } from '../repositories/activities.repo.js'
import { saveStreams } from '../repositories/streams.repo.js'
import { testApp, testDb } from './helpers.js'

function activity(id: number, epoch: number, overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id,
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

describe('activities API', () => {
  it('lists newest-first with keyset pagination', async () => {
    const db = testDb()
    for (let i = 1; i <= 5; i++) upsertActivity(db, activity(i, i * 1000))
    const { app } = await testApp({}, db)

    const p1 = await app.inject({ method: 'GET', url: '/api/activities?limit=2' })
    const body1 = p1.json()
    expect(body1.activities.map((a: { id: number }) => a.id)).toEqual([5, 4])
    expect(body1.nextBefore).toBe('4000')

    const p2 = await app.inject({
      method: 'GET',
      url: `/api/activities?limit=2&before=${body1.nextBefore}`,
    })
    expect(p2.json().activities.map((a: { id: number }) => a.id)).toEqual([3, 2])

    const last = await app.inject({ method: 'GET', url: '/api/activities?limit=2&before=2000' })
    expect(last.json().activities.map((a: { id: number }) => a.id)).toEqual([1])
    expect(last.json().nextBefore).toBeUndefined()
  })

  it('rejects invalid pagination query', async () => {
    const { app } = await testApp()
    const res = await app.inject({ method: 'GET', url: '/api/activities?limit=0' })
    expect(res.statusCode).toBe(400)
  })

  it('serves stored streams', async () => {
    const db = testDb()
    upsertActivity(db, activity(1, 1000))
    const latlng: [number, number][] = [
      [45.1, 6.05],
      [45.10005, 6.05],
    ]
    saveStreams(db, 1, { time: [0, 1], distance: [0, 5], altitude: [10, 11], latlng }, '2026-01-01')
    const { app } = await testApp({}, db)
    const res = await app.inject({ method: 'GET', url: '/api/activities/1/streams' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ time: [0, 1], distance: [0, 5], altitude: [10, 11], latlng })
  })

  it('404s with the streams status when streams are absent', async () => {
    const db = testDb()
    upsertActivity(db, activity(1, 1000, { streamsStatus: 'none' }))
    const { app } = await testApp({}, db)
    const res = await app.inject({ method: 'GET', url: '/api/activities/1/streams' })
    expect(res.statusCode).toBe(404)
    expect(res.json().streamsStatus).toBe('none')
  })

  it('404s for an unknown activity', async () => {
    const { app } = await testApp()
    const res = await app.inject({ method: 'GET', url: '/api/activities/9/streams' })
    expect(res.statusCode).toBe(404)
  })
})
