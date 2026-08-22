import { describe, expect, it } from 'vitest'
import { createDeniedLoginNotifier, DENIED_NOTICE_COOLDOWN_MS } from '../mail/deniedLogin.js'
import type { Mailer } from '../mail/mailer.js'
import { createMailer } from '../mail/mailer.js'
import {
  addAllowed,
  countAllowed,
  isAllowed,
  listAllowed,
  removeAllowed,
  seedAllowlist,
} from '../repositories/allowlist.repo.js'
import { connectAthlete, stubMailer, testApp, testConfig, testDb } from './helpers.js'
import type { FetchLike } from '../strava/oauth.js'

const NOW = '2026-08-22T10:00:00.000Z'

function tokenFetch(athleteId: number, name = 'Stranger'): FetchLike {
  return async () =>
    Response.json({
      access_token: 'at',
      refresh_token: 'rt',
      expires_at: 9999,
      athlete: { id: athleteId, firstname: name, lastname: '' },
    })
}

describe('allowlist repository', () => {
  it('adds, reports and removes ids', () => {
    const db = testDb()
    expect(countAllowed(db)).toBe(0)
    expect(isAllowed(db, 7)).toBe(false)

    addAllowed(db, 7, 'me', NOW)
    expect(isAllowed(db, 7)).toBe(true)
    expect(countAllowed(db)).toBe(1)

    // Re-adding keeps the original note rather than overwriting it.
    addAllowed(db, 7, 'other', '2026-09-01T00:00:00.000Z')
    expect(listAllowed(db)).toEqual([
      { athleteId: 7, note: 'me', addedAt: NOW, name: null, connected: false },
    ])

    expect(removeAllowed(db, 7)).toBe(true)
    expect(removeAllowed(db, 7)).toBe(false)
    expect(countAllowed(db)).toBe(0)
  })

  it('reports the display name of athletes that already connected', () => {
    const db = testDb()
    connectAthlete(db, 8, 'Chris')
    addAllowed(db, 8, null, NOW)
    expect(listAllowed(db)).toEqual([
      { athleteId: 8, note: null, addedAt: NOW, name: 'Chris', connected: true },
    ])
  })

  it('seeds from the env only while the table is empty', () => {
    const db = testDb()
    seedAllowlist(db, [7, 8], NOW)
    expect(listAllowed(db).map((a) => a.athleteId)).toEqual([7, 8])

    // An id removed from the admin page must not come back on the next boot.
    removeAllowed(db, 8)
    seedAllowlist(db, [7, 8], NOW)
    expect(listAllowed(db).map((a) => a.athleteId)).toEqual([7])
  })

  it('seeds nothing when the env list is empty', () => {
    const db = testDb()
    seedAllowlist(db, [], NOW)
    expect(countAllowed(db)).toBe(0)
  })
})

describe('sign-in gate', () => {
  it('lets anyone in while the allowlist is empty', async () => {
    const db = testDb()
    const { app } = await testApp({}, db, tokenFetch(999))
    const cb = await app.inject({ method: 'GET', url: '/api/auth/strava/callback?code=xyz' })
    expect(cb.cookies.find((c) => c.name === 'session')).toBeDefined()
  })

  it('accepts an athlete added to the table after boot', async () => {
    const db = testDb()
    const { app } = await testApp({ ALLOWED_ATHLETE_IDS: '7' }, db, tokenFetch(999))

    const denied = await app.inject({ method: 'GET', url: '/api/auth/strava/callback?code=xyz' })
    expect(denied.headers.location).toContain('denied=999')

    addAllowed(db, 999, null, NOW)
    const allowed = await app.inject({ method: 'GET', url: '/api/auth/strava/callback?code=xyz' })
    expect(allowed.cookies.find((c) => c.name === 'session')).toBeDefined()
  })

  it('emails the owner once per hour when an athlete is refused', async () => {
    const db = testDb()
    const mailer = stubMailer()
    let now = 1_000_000
    const { app } = await testApp({ ALLOWED_ATHLETE_IDS: '7' }, db, tokenFetch(999, 'Stranger'), {
      mailer,
    })
    // The app builds its own notifier; drive the clock through a local one to
    // assert the cooldown deterministically.
    const notify = createDeniedLoginNotifier({
      mailer,
      appBaseUrl: 'https://app.test/',
      now: () => now,
    })

    const cb = await app.inject({ method: 'GET', url: '/api/auth/strava/callback?code=xyz' })
    expect(cb.headers.location).toContain('denied=999')
    await new Promise((resolve) => setImmediate(resolve))
    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0]?.subject).toBe('stravaBoard: sign-in refused for athlete 999')
    expect(mailer.sent[0]?.text).toContain('Athlete id: 999')
    expect(mailer.sent[0]?.text).toContain('Stranger')

    await notify(999, 'Stranger')
    expect(mailer.sent).toHaveLength(2)
    await notify(999, 'Stranger')
    expect(mailer.sent).toHaveLength(2)
    now += DENIED_NOTICE_COOLDOWN_MS
    await notify(999, 'Stranger')
    expect(mailer.sent).toHaveLength(3)
    expect(mailer.sent[2]?.text).toContain('https://app.test/#/admin')
  })
})

describe('denied-login notifier', () => {
  it('does nothing without a configured mailer', async () => {
    const notify = createDeniedLoginNotifier({ mailer: null, appBaseUrl: 'https://app.test' })
    await expect(notify(1, 'Nobody')).resolves.toBeUndefined()
  })

  it('swallows send failures and retries on the next attempt', async () => {
    let attempts = 0
    const logged: string[] = []
    const failing: Mailer = {
      async send() {
        attempts += 1
        throw new Error('relay down')
      },
    }
    const notify = createDeniedLoginNotifier({
      mailer: failing,
      appBaseUrl: 'https://app.test',
      log: (m) => logged.push(m),
    })
    await notify(1, 'Nobody')
    await notify(1, 'Nobody')
    expect(attempts).toBe(2)
    expect(logged[0]).toContain('relay down')
  })
})

describe('createMailer', () => {
  it('is null until host, user and password are all set', () => {
    expect(createMailer(testConfig({}))).toBeNull()
    expect(createMailer(testConfig({ SMTP_HOST: 'mail.test', SMTP_USER: 'u' }))).toBeNull()
    expect(
      createMailer(testConfig({ SMTP_HOST: 'mail.test', SMTP_USER: 'u', SMTP_PASSWORD: 'p' })),
    ).not.toBeNull()
  })
})
