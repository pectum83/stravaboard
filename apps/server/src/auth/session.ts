import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

declare module 'fastify' {
  interface FastifyRequest {
    /** Strava athlete id of the logged-in user; set by the auth guard. */
    athleteId: number
  }
}

export const SESSION_COOKIE = 'session'

/** ~180 days — a family app should rarely ask to log in again. */
const SESSION_MAX_AGE_S = 180 * 24 * 3600

export function setSessionCookie(reply: FastifyReply, athleteId: number): void {
  void reply.setCookie(SESSION_COOKIE, String(athleteId), {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto',
    path: '/',
    maxAge: SESSION_MAX_AGE_S,
  })
}

export function clearSessionCookie(reply: FastifyReply): void {
  void reply.clearCookie(SESSION_COOKIE, { path: '/' })
}

/** Athlete id from a valid signed session cookie, or null. */
export function sessionAthleteId(req: FastifyRequest): number | null {
  const raw = req.cookies[SESSION_COOKIE]
  if (!raw) return null
  const unsigned = req.unsignCookie(raw)
  if (!unsigned.valid || unsigned.value === null) return null
  const athleteId = Number(unsigned.value)
  return Number.isInteger(athleteId) && athleteId > 0 ? athleteId : null
}

/**
 * Require a session on every /api route except the auth flow and the health
 * probe. Static SPA assets stay public — the app itself is the login page.
 */
export function registerAuthGuard(app: FastifyInstance): void {
  app.decorateRequest('athleteId', 0)
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0]!
    if (!path.startsWith('/api/')) return
    if (path.startsWith('/api/auth/') || path === '/api/health') return
    const athleteId = sessionAthleteId(req)
    if (athleteId === null) return reply.code(401).send({ error: 'not authenticated' })
    req.athleteId = athleteId
  })
}
