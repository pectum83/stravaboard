/**
 * Copy another athlete's Strava activity onto an account of this app, heart
 * rate included — the same import the admin page offers, from a shell.
 *
 * Runs where the tokens live (the VPS), because a refresh rotates them and the
 * new pair must be persisted in the database the server reads:
 *
 *   node22 server/scripts/importActivity.js --activity 19790883454 [--dry-run]
 *
 * Options: --activity <id> (required), --from <athleteId> (defaults to the
 * local row's owner), --to <athleteId> (defaults to ADMIN_ATHLETE_ID),
 * --name, --description, --dry-run, --out <file.tcx>.
 */
import { writeFileSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import { parseArgs } from 'node:util'
import { loadConfig } from '../config.js'
import { openDb } from '../db/client.js'
import { ImportError, importActivity } from '../import/importService.js'
import { StravaClient } from '../strava/client.js'

for (const envPath of ['.env', '../../.env']) {
  try {
    loadEnvFile(envPath)
  } catch {
    // missing file — fine
  }
}

const { values } = parseArgs({
  options: {
    activity: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    out: { type: 'string' },
  },
})

function required(name: string, raw: string | undefined): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    console.error(`--${name} must be a positive integer`)
    process.exit(2)
  }
  return value
}

const config = loadConfig()
const sourceActivityId = required('activity', values.activity)
const targetAthleteId =
  values.to === undefined ? config.ADMIN_ATHLETE_ID : required('to', values.to)
if (targetAthleteId <= 0) {
  console.error('no target athlete: pass --to <athleteId> or set ADMIN_ATHLETE_ID')
  process.exit(2)
}

const db = openDb(config.DATABASE_PATH)
const client = new StravaClient(config, db)

try {
  const { summary, tcx, activityId, url } = await importActivity(
    { config, db, client, log: (msg) => console.log(msg) },
    {
      sourceActivityId,
      ...(values.from === undefined ? {} : { sourceAthleteId: required('from', values.from) }),
      targetAthleteId,
      ...(values.name === undefined ? {} : { name: values.name }),
      ...(values.description === undefined ? {} : { description: values.description }),
      dryRun: values['dry-run'],
    },
  )

  console.log(
    [
      `${summary.name} — ${summary.sportType} on ${summary.startDate}`,
      `  ${(summary.distanceM / 1000).toFixed(1)} km, D+ ${Math.round(summary.totalElevationGainM)} m,` +
        ` ${Math.round(summary.elapsedTimeS / 60)} min`,
      `  ${summary.points} points, heart rate ${summary.averageHeartrate ?? '—'} bpm avg /` +
        ` ${summary.maxHeartrate ?? '—'} bpm max`,
      `  athlete ${summary.sourceAthleteId} → athlete ${targetAthleteId}`,
    ].join('\n'),
  )

  if (values['dry-run']) {
    const out = values.out ?? `/tmp/import-${sourceActivityId}.tcx`
    writeFileSync(out, tcx)
    console.log(`dry run: wrote ${out}, nothing sent to Strava`)
  } else {
    console.log(`imported as activity ${activityId}: ${url}`)
  }
} catch (err) {
  console.error(err instanceof ImportError ? `${err.code}: ${err.message}` : err)
  process.exit(1)
}
