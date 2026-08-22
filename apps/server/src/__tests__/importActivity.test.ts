import { describe, expect, it } from 'vitest'
import { upsertActivity, type ActivityRow } from '../repositories/activities.repo.js'
import type { StravaStreamSet } from '../strava/types.js'
import { connectAthlete, session, testApp, testDb } from './helpers.js'
import { makeActivity, stravaStub } from './stravaStub.js'

const ADMIN = 798002
const SON = 86370048
const SOURCE_ID = 19790883454
const adminConfig = { ADMIN_ATHLETE_ID: ADMIN } as const

/** Streams as the son's watch recorded them: GPS, altitude and — the point — heart rate. */
const watchStreams: StravaStreamSet = {
  time: { data: [0, 10, 20, 30] },
  distance: { data: [0, 25, 50, 75] },
  altitude: { data: [1200, 1210, 1222, 1235] },
  latlng: {
    data: [
      [45.1, 6.05],
      [45.101, 6.05],
      [45.102, 6.05],
      [45.103, 6.05],
    ],
  },
  heartrate: { data: [102, 128, 141, 149] },
  cadence: { data: [50, 52, 54, 56] },
}

function sourceRow(overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: SOURCE_ID,
    athleteId: SON,
    name: 'Randonnée le matin',
    sportType: 'Hike',
    startDate: '2026-08-18T07:16:56Z',
    startDateEpoch: Math.floor(Date.parse('2026-08-18T07:16:56Z') / 1000),
    distanceM: 7752.2,
    movingTimeS: 9000,
    elapsedTimeS: 11000,
    totalElevationGainM: 659,
    streamsStatus: 'done',
    rawSummary: JSON.stringify({ has_heartrate: true }),
    ...overrides,
  }
}

/** Both accounts connected, the source activity synced locally, Strava stubbed. */
async function importApp(stubOpts: Parameters<typeof stravaStub>[0] = {}) {
  const db = testDb()
  const stub = stravaStub({
    activities: [
      makeActivity(SOURCE_ID, '2026-08-18T07:16:56Z', {
        name: 'Randonnée le matin',
        sport_type: 'Hike',
        distance: 7752.2,
        elapsed_time: 11_000,
        total_elevation_gain: 659,
        calories: 812,
        has_heartrate: true,
      }),
    ],
    streams: { [SOURCE_ID]: watchStreams },
    ...stubOpts,
  })
  const { app } = await testApp(adminConfig, db, stub.fetchImpl)
  connectAthlete(db, ADMIN, 'christophe rousset')
  connectAthlete(db, SON, 'Max3600 Rousset')
  upsertActivity(db, sourceRow())
  return { app, db, stub, cookies: session(app, ADMIN) }
}

describe('admin activity import', () => {
  it("re-uploads the other athlete's activity with its heart rate", async () => {
    const { app, stub, cookies } = await importApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/import-activity',
      cookies,
      payload: { activityId: SOURCE_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      url: `https://www.strava.com/activities/${res.json().activityId as number}`,
      name: 'Randonnée le matin',
      averageHeartrate: 130, // (102+128+141+149)/4 = 130
      maxHeartrate: 149,
    })

    expect(stub.uploads).toHaveLength(1)
    const upload = stub.uploads[0]!
    expect(upload.dataType).toBe('tcx')
    expect(upload.externalId).toBe(`stravaboard-import-${SOURCE_ID}`)
    expect(upload.name).toBe('Randonnée le matin')
    expect(upload.description).toContain("Max3600 Rousset's watch")
    expect(upload.tcx).toContain('<Value>102</Value>')
    expect(upload.tcx).toContain('<Time>2026-08-18T07:16:56Z</Time>')
    expect(upload.tcx.match(/<Trackpoint>/g)).toHaveLength(4)
  })

  it('asks Strava for the heart-rate stream, not just the stored kinds', async () => {
    const { app, stub, cookies } = await importApp()
    await app.inject({
      method: 'POST',
      url: '/api/admin/import-activity',
      cookies,
      payload: { activityId: SOURCE_ID },
    })
    expect(stub.requests.some((r) => r.includes('/streams') && r.includes('heartrate'))).toBe(true)
  })

  it('restores the real sport type, which the TCX cannot express', async () => {
    const { app, stub, cookies } = await importApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/import-activity',
      cookies,
      payload: { activityId: SOURCE_ID },
    })
    const newId = res.json().activityId as number
    expect(stub.requests).toContain(`/api/v3/activities/${newId}`)
  })

  it('honours a custom name and description', async () => {
    const { app, stub, cookies } = await importApp()
    await app.inject({
      method: 'POST',
      url: '/api/admin/import-activity',
      cookies,
      payload: { activityId: SOURCE_ID, name: 'Blanche depuis Bonneval', description: 'Son watch' },
    })
    expect(stub.uploads[0]).toMatchObject({
      name: 'Blanche depuis Bonneval',
      description: 'Son watch',
    })
  })

  it('waits while Strava is still processing the upload', async () => {
    const { app, cookies } = await importApp({ uploadPolls: 3 })
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/import-activity',
      cookies,
      payload: { activityId: SOURCE_ID },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().activityId).toBeGreaterThan(0)
  })

  it('refuses an activity without heart rate — there would be nothing to gain', async () => {
    const { app, cookies } = await importApp({
      streams: { [SOURCE_ID]: { ...watchStreams, heartrate: undefined } },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/import-activity',
      cookies,
      payload: { activityId: SOURCE_ID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/no heart rate/)
  })

  it('reports a second import of the same activity as a duplicate', async () => {
    const { app, cookies } = await importApp()
    const payload = { activityId: SOURCE_ID }
    expect(
      (await app.inject({ method: 'POST', url: '/api/admin/import-activity', cookies, payload }))
        .statusCode,
    ).toBe(200)
    const again = await app.inject({
      method: 'POST',
      url: '/api/admin/import-activity',
      cookies,
      payload,
    })
    expect(again.statusCode).toBe(409)
    expect(again.json().error).toMatch(/duplicate of activity/)
  })

  it('surfaces an upload rejected by Strava as a bad gateway', async () => {
    const { app, cookies } = await importApp({ uploadError: 'Unsupported file format' })
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/import-activity',
      cookies,
      payload: { activityId: SOURCE_ID },
    })
    expect(res.statusCode).toBe(502)
    expect(res.json().error).toMatch(/Unsupported file format/)
  })

  it('surfaces an upload endpoint failure as a bad gateway', async () => {
    const { app, cookies } = await importApp({ uploadStatus: 500 })
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/import-activity',
      cookies,
      payload: { activityId: SOURCE_ID },
    })
    expect(res.statusCode).toBe(502)
  })

  it('404s an activity that is neither local nor attributed to an athlete', async () => {
    const { app, cookies } = await importApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/import-activity',
      cookies,
      payload: { activityId: 12345 },
    })
    expect(res.statusCode).toBe(404)
  })

  it('rejects an invalid body and non-admin callers', async () => {
    const { app, db, cookies } = await importApp()
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/admin/import-activity',
      cookies,
      payload: { activityId: 'nope' },
    })
    expect(invalid.statusCode).toBe(400)

    connectAthlete(db, 4242)
    const other = await app.inject({
      method: 'POST',
      url: '/api/admin/import-activity',
      cookies: session(app, 4242),
      payload: { activityId: SOURCE_ID },
    })
    expect(other.statusCode).toBe(403)
  })
})

describe('admin import pickers', () => {
  it('lists the connected athletes with their activity counts', async () => {
    const { app, cookies } = await importApp()
    const res = await app.inject({ method: 'GET', url: '/api/admin/athletes', cookies })
    expect(res.statusCode).toBe(200)
    expect(res.json().athletes).toEqual(
      expect.arrayContaining([
        { id: ADMIN, name: 'christophe rousset', activityCount: 0 },
        { id: SON, name: 'Max3600 Rousset', activityCount: 1 },
      ]),
    )
  })

  it("lists another athlete's activities, flagging the ones with heart rate", async () => {
    const { app, db, cookies } = await importApp()
    upsertActivity(
      db,
      sourceRow({ id: 42, startDateEpoch: 1, name: 'Sans cardio', rawSummary: '{}' }),
    )
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/import-candidates?athleteId=${SON}`,
      cookies,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().activities).toEqual([
      expect.objectContaining({ id: SOURCE_ID, hasHeartrate: true, sportType: 'Hike' }),
      expect.objectContaining({ id: 42, hasHeartrate: false }),
    ])
  })

  it('rejects a candidates query without an athlete', async () => {
    const { app, cookies } = await importApp()
    const res = await app.inject({ method: 'GET', url: '/api/admin/import-candidates', cookies })
    expect(res.statusCode).toBe(400)
  })
})
