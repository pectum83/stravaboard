/**
 * Splice two consecutive Strava activities into one, inventing the stretch the
 * watch never recorded — for the days the recording stopped mid-outing.
 *
 * Runs where the tokens live (the VPS), because a refresh rotates them and the
 * new pair must be persisted in the database the server reads.
 *
 * Two passes, and the order matters:
 *
 *   1. node22 server/scripts/mergeActivities.js --first A --second B --pause 1440 \
 *        --dry-run --out merge.tcx --snapshot merge.json --geojson merge.geojson
 *      Nothing is sent. Check the file, look at the GeoJSON on a map.
 *   2. Delete A and B on strava.com — Strava refuses an upload overlapping an
 *      existing activity, and the merged file starts where A did.
 *   3. node22 server/scripts/mergeActivities.js --from-snapshot merge.json \
 *        --name "..." --pause 1440
 *      The snapshot is the only copy that still has heart rate and cadence.
 */
import { writeFileSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import { parseArgs } from 'node:util'
import { BridgeError } from '@stravaboard/shared'
import { loadConfig } from '../config.js'
import { openDb } from '../db/client.js'
import { MergeError, mergeActivities } from '../import/mergeService.js'
import { ImportError } from '../import/stravaUpload.js'
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
    first: { type: 'string' },
    second: { type: 'string' },
    athlete: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    sport: { type: 'string' },
    tag: { type: 'string' },
    pause: { type: 'string' },
    speed: { type: 'string' },
    ramp: { type: 'string' },
    sample: { type: 'string' },
    'pause-sample': { type: 'string' },
    bow: { type: 'string' },
    via: { type: 'string' },
    undulation: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    out: { type: 'string' },
    snapshot: { type: 'string' },
    'from-snapshot': { type: 'string' },
    geojson: { type: 'string' },
    'allow-missing-heartrate': { type: 'boolean', default: false },
    forget: { type: 'boolean', default: false },
  },
})

function fail(message: string): never {
  console.error(message)
  process.exit(2)
}

function positiveInt(name: string, raw: string | undefined): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) fail(`--${name} must be a positive integer`)
  return value
}

function optionalNumber(name: string, raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) fail(`--${name} must be a non-negative number`)
  return value
}

const config = loadConfig()
const fromSnapshot = values['from-snapshot']
if (fromSnapshot === undefined && (values.first === undefined || values.second === undefined)) {
  fail('pass --first <id> --second <id>, or --from-snapshot <file.json>')
}

const bridge = {
  ...defined('pauseS', optionalNumber('pause', values.pause)),
  ...defined('cruiseSpeedMps', optionalNumber('speed', values.speed)),
  ...defined('rampS', optionalNumber('ramp', values.ramp)),
  ...defined('sampleS', optionalNumber('sample', values.sample)),
  ...defined('pauseSampleS', optionalNumber('pause-sample', values['pause-sample'])),
  ...defined('bowM', optionalNumber('bow', values.bow)),
  ...defined('via', waypoints(values.via)),
  ...defined('undulationM', optionalNumber('undulation', values.undulation)),
}

function defined<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value }
}

/** `--via "44.8961,5.5213;44.8941,5.5207"` → the points the bridge must pass through. */
function waypoints(raw: string | undefined): [number, number][] | undefined {
  if (raw === undefined) return undefined
  return raw.split(';').map((pair) => {
    const [lat, lng] = pair.split(',').map(Number)
    if (lat === undefined || lng === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      fail(`--via wants "lat,lng;lat,lng", got "${pair}"`)
    }
    return [lat, lng] as [number, number]
  })
}

const db = openDb(config.DATABASE_PATH)
const client = new StravaClient(config, db)

try {
  const result = await mergeActivities(
    { config, db, client, log: (msg) => console.log(msg) },
    {
      source:
        fromSnapshot === undefined
          ? {
              kind: 'strava',
              firstActivityId: positiveInt('first', values.first),
              secondActivityId: positiveInt('second', values.second),
              ...defined('athleteId', optionalNumber('athlete', values.athlete)),
            }
          : { kind: 'snapshot', path: fromSnapshot },
      bridge,
      dryRun: values['dry-run'],
      allowMissingHeartrate: values['allow-missing-heartrate'],
      forgetSources: values.forget,
      ...defined('name', values.name),
      ...defined('description', values.description),
      ...defined('sportType', values.sport),
      ...defined('tag', values.tag),
      ...defined(
        'snapshotPath',
        values.snapshot ??
          (fromSnapshot === undefined && values['dry-run']
            ? `/tmp/merge-${values.first}-${values.second}.sources.json`
            : undefined),
      ),
    },
  )

  const { summary } = result
  const km = (m: number): string => (m / 1000).toFixed(2)
  console.log(
    [
      `${summary.name} — ${summary.sportType} on ${summary.startDate}`,
      `  ${km(summary.distanceM)} km, ${Math.round(summary.elapsedTimeS / 60)} min,` +
        ` ${summary.points} points`,
      `  bridge: ${summary.bridge.gapS} s of silence →` +
        ` ${Math.round(summary.bridge.pauseS / 60)} min standing +` +
        ` ${Math.round(summary.bridge.walkS / 60)} min walking` +
        ` ${summary.bridge.lengthM.toFixed(0)} m at` +
        ` ${(summary.bridge.vPlateauMps * 3.6).toFixed(1)} km/h` +
        ` (${summary.bridge.elevationDeltaM.toFixed(0)} m),` +
        ` ${summary.bridge.points} fabricated points`,
      summary.dropped.length === 0
        ? '  no stream lost'
        : `  dropped: ${summary.dropped.join(', ')}`,
      `  activities ${summary.firstActivityId} + ${summary.secondActivityId} → athlete ${summary.athleteId}`,
    ].join('\n'),
  )

  if (values.geojson !== undefined) {
    writeFileSync(values.geojson, result.geojson)
    console.log(`wrote ${values.geojson} — open it on a map before uploading anything`)
  }

  if (values['dry-run']) {
    const out =
      values.out ?? `/tmp/merge-${summary.firstActivityId}-${summary.secondActivityId}.tcx`
    writeFileSync(out, result.tcx)
    console.log(`dry run: wrote ${out}, nothing sent to Strava`)
    console.log(
      'next: check the file, delete both originals on strava.com, then re-run with --from-snapshot',
    )
  } else {
    console.log(
      result.alreadyExisted
        ? `already on Strava as activity ${result.activityId}: ${result.url}`
        : `merged into activity ${result.activityId}: ${result.url}`,
    )
    console.log(
      result.forgotten.length > 0
        ? `dropped the local rows for ${result.forgotten.join(' and ')}`
        : 'the two source rows are still in the database — pass --forget to drop them',
    )
    console.log('stored locally as pending — run a sync from /#/admin to fetch its streams')
  }
} catch (err) {
  if (err instanceof MergeError || err instanceof BridgeError || err instanceof ImportError) {
    console.error(`${err.code}: ${err.message}`)
  } else {
    console.error(err)
  }
  process.exit(1)
}
