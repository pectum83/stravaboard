/**
 * Minimal Strava API stand-in for e2e runs: the app's auto-sync finds an
 * empty activity feed and settles to idle without touching the network.
 */
import { createServer, type IncomingMessage } from 'node:http'

const port = Number(process.env.STUB_PORT ?? 4599)

/** Collect a request body as a string (for the UpdateActivity PUT). */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => (data += chunk))
    req.on('end', () => resolve(data))
  })
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`)
  res.setHeader('content-type', 'application/json')
  res.setHeader('x-ratelimit-limit', '200,2000')
  res.setHeader('x-ratelimit-usage', '1,1')

  const updateMatch = url.pathname.match(/\/activities\/(\d+)$/)

  if (url.pathname === '/health') {
    res.end(JSON.stringify({ ok: true }))
  } else if (url.pathname.endsWith('/oauth/authorize')) {
    // Instant OAuth grant: bounce straight back to the app's callback.
    res.statusCode = 302
    res.setHeader('location', `${url.searchParams.get('redirect_uri')}?code=e2e-code`)
    res.end()
  } else if (req.method === 'PUT' && updateMatch) {
    // UpdateActivity: echo the patched summary, as Strava does.
    const patch = JSON.parse((await readBody(req)) || '{}')
    res.end(
      JSON.stringify({
        id: Number(updateMatch[1]),
        name: patch.name ?? 'Activity',
        sport_type: patch.sport_type ?? 'Run',
        start_date: '2026-06-20T07:30:00Z',
        distance: 15_000,
        moving_time: 3600,
        elapsed_time: 3600,
        total_elevation_gain: 650,
      }),
    )
  } else if (url.pathname.endsWith('/athlete/activities')) {
    res.end(JSON.stringify([]))
  } else if (url.pathname.endsWith('/token')) {
    res.end(
      JSON.stringify({
        access_token: 'stub-access',
        refresh_token: 'stub-refresh',
        expires_at: Math.floor(Date.now() / 1000) + 21600,
        athlete: { id: 4242, firstname: 'E2E', lastname: 'Tester' },
      }),
    )
  } else {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found' }))
  }
}).listen(port, () => {
  console.log(`strava stub listening on :${port}`)
})
