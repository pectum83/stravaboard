import { describe, expect, it } from 'vitest'
import { addAllowed, isAllowed, listAllowed } from '../repositories/allowlist.repo.js'
import { connectAthlete, session, testApp, testDb } from './helpers.js'

const ADMIN = 798002
const adminConfig = { ADMIN_ATHLETE_ID: ADMIN } as const

describe('admin API', () => {
  it('requires a session, then the admin athlete', async () => {
    const db = testDb()
    const { app } = await testApp(adminConfig, db)
    connectAthlete(db, 4242)

    const anonymous = await app.inject({ method: 'GET', url: '/api/admin/allowlist' })
    expect(anonymous.statusCode).toBe(401)

    const other = await app.inject({
      method: 'GET',
      url: '/api/admin/allowlist',
      cookies: session(app, 4242),
    })
    expect(other.statusCode).toBe(403)
  })

  it('refuses everyone when no admin is configured', async () => {
    const db = testDb()
    const { app } = await testApp({}, db)
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/allowlist',
      cookies: session(app, ADMIN),
    })
    expect(res.statusCode).toBe(403)
  })

  it('lists, adds and removes allowlist entries', async () => {
    const db = testDb()
    const { app } = await testApp({ ...adminConfig, ALLOWED_ATHLETE_IDS: String(ADMIN) }, db)
    const cookies = session(app, ADMIN)

    const initial = await app.inject({ method: 'GET', url: '/api/admin/allowlist', cookies })
    expect(initial.statusCode).toBe(200)
    expect(initial.json().athletes).toHaveLength(1)

    const added = await app.inject({
      method: 'POST',
      url: '/api/admin/allowlist',
      cookies,
      payload: { athleteId: 4242, note: 'cousin Paul' },
    })
    expect(added.statusCode).toBe(201)
    expect(added.json()).toMatchObject({ athleteId: 4242, note: 'cousin Paul', connected: false })
    expect(isAllowed(db, 4242)).toBe(true)

    const removed = await app.inject({
      method: 'DELETE',
      url: '/api/admin/allowlist/4242',
      cookies,
    })
    expect(removed.statusCode).toBe(200)
    expect(listAllowed(db).map((a) => a.athleteId)).toEqual([ADMIN])
  })

  it('rejects an invalid athlete id', async () => {
    const db = testDb()
    const { app } = await testApp(adminConfig, db)
    const cookies = session(app, ADMIN)

    for (const payload of [{}, { athleteId: 0 }, { athleteId: 'x' }, { athleteId: 1.5 }]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/allowlist',
        cookies,
        payload,
      })
      expect(res.statusCode).toBe(400)
    }

    const bad = await app.inject({ method: 'DELETE', url: '/api/admin/allowlist/abc', cookies })
    expect(bad.statusCode).toBe(400)
  })

  it('never removes the administrator, and 404s on an unknown id', async () => {
    const db = testDb()
    const { app } = await testApp(adminConfig, db)
    const cookies = session(app, ADMIN)
    addAllowed(db, ADMIN, null, '2026-08-22T10:00:00.000Z')

    const self = await app.inject({
      method: 'DELETE',
      url: `/api/admin/allowlist/${ADMIN}`,
      cookies,
    })
    expect(self.statusCode).toBe(400)
    expect(isAllowed(db, ADMIN)).toBe(true)

    const unknown = await app.inject({ method: 'DELETE', url: '/api/admin/allowlist/123', cookies })
    expect(unknown.statusCode).toBe(404)
  })

  it('restarts the process after answering', async () => {
    const db = testDb()
    let exits = 0
    const { app } = await testApp(adminConfig, db, undefined, { exit: () => (exits += 1) })

    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/admin/restart',
      cookies: session(app, 4242),
    })
    expect(forbidden.statusCode).toBe(403)

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/restart',
      cookies: session(app, ADMIN),
    })
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ restarting: true })
    expect(exits).toBe(0)
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(exits).toBe(1)
  })

  it('reports the admin flag on the auth status', async () => {
    const db = testDb()
    const { app } = await testApp(adminConfig, db)
    connectAthlete(db, ADMIN, 'Chris')
    connectAthlete(db, 4242, 'Léa')

    const admin = await app.inject({
      method: 'GET',
      url: '/api/auth/status',
      cookies: session(app, ADMIN),
    })
    expect(admin.json().isAdmin).toBe(true)

    const other = await app.inject({
      method: 'GET',
      url: '/api/auth/status',
      cookies: session(app, 4242),
    })
    expect(other.json().isAdmin).toBe(false)
  })
})
