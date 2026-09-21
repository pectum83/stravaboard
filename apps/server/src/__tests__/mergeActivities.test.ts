import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MergeError, mergeActivities, type MergeRequest } from '../import/mergeService.js'
import { ImportError } from '../import/stravaUpload.js'
import { upsertActivity, getActivity, type ActivityRow } from '../repositories/activities.repo.js'
import { StravaClient } from '../strava/client.js'
import type { StravaStreamSet } from '../strava/types.js'
import { connectAthlete, testConfig, testDb } from './helpers.js'
import { makeActivity, stravaStub } from './stravaStub.js'

const ME = 798002
const SOMEONE_ELSE = 86370048
const CLIMB = 111
const DESCENT = 222
const CLIMB_START = '2026-09-20T08:13:03Z'
/** 20 minutes after the climb started, i.e. 10 minutes after it stopped recording. */
const DESCENT_START = '2026-09-20T08:33:03Z'

const M_PER_DEG_LAT = (6_371_000 * Math.PI) / 180

/** A straight northward leg at 1 Hz-ish, with the streams a watch really produces. */
function legStreams(startLat: number, startAltM: number, hr: number): StravaStreamSet {
  const time: number[] = []
  const distance: number[] = []
  const altitude: number[] = []
  const latlng: [number, number][] = []
  const heartrate: number[] = []
  const cadence: number[] = []
  for (let i = 0; i <= 6; i++) {
    const covered = i * 100
    time.push(i * 100)
    distance.push(covered)
    altitude.push(startAltM + i * 10)
    latlng.push([startLat + covered / M_PER_DEG_LAT, 5.52])
    heartrate.push(hr + i)
    cadence.push(50)
  }
  return {
    time: { data: time },
    distance: { data: distance },
    altitude: { data: altitude },
    latlng: { data: latlng },
    heartrate: { data: heartrate },
    cadence: { data: cadence },
  }
}

const climbStreams = legStreams(44.9, 2000, 120)
/** Starts 500 m further north than the climb ended — the stretch to invent. */
const descentStreams = legStreams(44.9 + (600 + 500) / M_PER_DEG_LAT, 2040, 110)

function row(id: number, startDate: string, overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id,
    athleteId: ME,
    name: `Activity ${id}`,
    sportType: 'Hike',
    startDate,
    startDateEpoch: Math.floor(Date.parse(startDate) / 1000),
    distanceM: 600,
    movingTimeS: 600,
    elapsedTimeS: 600,
    totalElevationGainM: 60,
    streamsStatus: 'done',
    rawSummary: JSON.stringify({ has_heartrate: true }),
    ...overrides,
  }
}

interface SetupOptions {
  /** Leave the two originals out of Strava, as if they had just been deleted. */
  deletedFromStrava?: boolean
  stub?: Parameters<typeof stravaStub>[0]
  rows?: ActivityRow[]
}

function setup(options: SetupOptions = {}) {
  const db = testDb()
  const sources = [
    makeActivity(CLIMB, CLIMB_START, {
      name: 'Montée plateau Vercor',
      sport_type: 'Hike',
      distance: 600,
      elapsed_time: 600,
      calories: 400,
      has_heartrate: true,
    }),
    makeActivity(DESCENT, DESCENT_START, {
      name: 'Descente plateau vercor',
      sport_type: 'Hike',
      distance: 600,
      elapsed_time: 600,
      calories: 300,
      has_heartrate: true,
    }),
  ]
  const stub = stravaStub({
    activities: options.deletedFromStrava === true ? [] : sources,
    streams: { [CLIMB]: climbStreams, [DESCENT]: descentStreams },
    ...options.stub,
  })
  const config = testConfig()
  connectAthlete(db, ME, 'christophe rousset')
  for (const activity of options.rows ?? [row(CLIMB, CLIMB_START), row(DESCENT, DESCENT_START)]) {
    upsertActivity(db, activity)
  }
  const deps = {
    config,
    db,
    client: new StravaClient(config, db, stub.fetchImpl),
    fetchImpl: stub.fetchImpl,
    sleep: async (): Promise<void> => {},
  }
  return { db, stub, deps }
}

const bridge = { pauseS: 300, bowM: 0 } as const

function pair(overrides: Partial<MergeRequest> = {}): MergeRequest {
  return {
    source: { kind: 'strava', firstActivityId: CLIMB, secondActivityId: DESCENT },
    bridge,
    ...overrides,
  }
}

function snapshotPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'merge-')), 'sources.json')
}

/** Dry run against a live Strava, then the real upload once the originals are gone. */
async function dryRunThenUpload(requestOverrides: Partial<MergeRequest> = {}) {
  const path = snapshotPath()
  const first = setup()
  await mergeActivities(first.deps, pair({ dryRun: true, snapshotPath: path }))

  const second = setup({ deletedFromStrava: true })
  const result = await mergeActivities(
    second.deps,
    pair({ source: { kind: 'snapshot', path }, ...requestOverrides }),
  )
  return { ...second, result, path }
}

describe('merging two interrupted activities — dry run', () => {
  it('builds one file covering both activities and the invented stretch', async () => {
    const { deps, stub } = setup()
    const path = snapshotPath()

    const { summary, tcx } = await mergeActivities(
      deps,
      pair({ dryRun: true, snapshotPath: path, name: 'Plateau du Vercors' }),
    )

    expect(stub.uploads).toHaveLength(0)
    expect(summary.name).toBe('Plateau du Vercors')
    expect(summary.bridge.gapS).toBe(600)
    expect(summary.bridge.pauseS).toBe(300)
    expect(summary.bridge.lengthM).toBeCloseTo(500, 0)
    expect(tcx.match(/<Trackpoint>/g)).toHaveLength(7 + summary.bridge.points + 7)
    expect(tcx).toContain(`<Time>${CLIMB_START}</Time>`)
    expect(tcx).toContain('<Time>2026-09-20T08:43:03Z</Time>')
  })

  it('writes the snapshot that outlives the originals', async () => {
    const { deps } = setup()
    const path = snapshotPath()

    await mergeActivities(deps, pair({ dryRun: true, snapshotPath: path }))
    const snapshot = JSON.parse(readFileSync(path, 'utf8')) as Record<string, never>

    expect(snapshot).toMatchObject({ athleteId: ME })
    expect(JSON.stringify(snapshot)).toContain('heartrate')
  })

  it('asks Strava for heart rate and cadence, not just the stored stream kinds', async () => {
    const { deps, stub } = setup()
    await mergeActivities(deps, pair({ dryRun: true }))

    const streamCalls = stub.requests.filter((r) => r.includes('/streams'))
    expect(streamCalls).toHaveLength(2)
    expect(streamCalls.every((r) => r.includes('heartrate') && r.includes('cadence'))).toBe(true)
  })

  it('takes the clock, not the argument order, as the sense of the outing', async () => {
    const forwards = await mergeActivities(setup().deps, pair({ dryRun: true }))
    const backwards = await mergeActivities(
      setup().deps,
      pair({
        dryRun: true,
        source: { kind: 'strava', firstActivityId: DESCENT, secondActivityId: CLIMB },
      }),
    )

    expect(backwards.tcx).toBe(forwards.tcx)
  })

  it('hands back the fabricated stretch as GeoJSON to look at on a map', async () => {
    const { geojson, summary } = await mergeActivities(setup().deps, pair({ dryRun: true }))
    const parsed = JSON.parse(geojson) as {
      features: { properties: { name: string }; geometry: { coordinates: number[][] } }[]
    }

    expect(parsed.features.map((f) => f.properties.name)).toEqual([
      'end of the first activity',
      'fabricated bridge',
      'start of the second activity',
    ])
    expect(parsed.features[1]!.geometry.coordinates).toHaveLength(summary.bridge.points + 2)
    // GeoJSON is longitude first — the opposite of a Strava latlng stream.
    expect(parsed.features[1]!.geometry.coordinates[0]![0]).toBeCloseTo(5.52, 4)
  })
})

describe('merging two interrupted activities — upload', () => {
  it('uploads the merge once the originals are gone and stores it locally', async () => {
    const { db, stub, result } = await dryRunThenUpload({ name: 'Plateau du Vercors' })

    expect(stub.uploads).toHaveLength(1)
    const upload = stub.uploads[0]!
    expect(upload.dataType).toBe('tcx')
    expect(upload.externalId).toBe(`stravaboard-merge-${CLIMB}-${DESCENT}`)
    expect(upload.name).toBe('Plateau du Vercors')
    expect(upload.description).toContain(`${CLIMB} and ${DESCENT}`)
    expect(upload.tcx).toContain(`<Time>${CLIMB_START}</Time>`)

    expect(result.activityId).toBe(990_001)
    expect(result.url).toBe('https://www.strava.com/activities/990001')
    const stored = getActivity(db, 990_001)
    expect(stored).toMatchObject({ athleteId: ME, sportType: 'Hike', streamsStatus: 'pending' })
  })

  it('never re-reads the deleted activities: the snapshot is the source', async () => {
    const { stub } = await dryRunThenUpload()

    expect(stub.requests.filter((r) => r.includes('/streams'))).toHaveLength(0)
  })

  it('leaves the source rows alone unless asked to forget them', async () => {
    const { db, result } = await dryRunThenUpload()

    expect(result.forgotten).toEqual([])
    expect(getActivity(db, CLIMB)).not.toBeNull()
    expect(getActivity(db, DESCENT)).not.toBeNull()
  })

  it('forgets the two source rows once the merge is stored', async () => {
    const { db, result } = await dryRunThenUpload({ forgetSources: true })

    expect(result.forgotten).toEqual([CLIMB, DESCENT])
    expect(getActivity(db, CLIMB)).toBeNull()
    expect(getActivity(db, DESCENT)).toBeNull()
    expect(getActivity(db, 990_001)).not.toBeNull()
  })

  it('never forgets anything on a dry run', async () => {
    const { deps, db } = setup()
    const { forgotten } = await mergeActivities(
      deps,
      pair({ dryRun: true, snapshotPath: snapshotPath(), forgetSources: true }),
    )

    expect(forgotten).toEqual([])
    expect(getActivity(db, CLIMB)).not.toBeNull()
  })

  it('lets a different tag replace a merge that came out wrong', async () => {
    const { stub } = await dryRunThenUpload({ tag: 'v2' })

    expect(stub.uploads[0]!.externalId).toBe(`stravaboard-merge-${CLIMB}-${DESCENT}-v2`)
  })

  it('restores the real sport type the TCX cannot express', async () => {
    const { db } = await dryRunThenUpload()
    expect(getActivity(db, 990_001)?.sportType).toBe('Hike')
  })

  it('asks again when Strava quietly ignores the sport type', async () => {
    const path = snapshotPath()
    await mergeActivities(setup().deps, pair({ dryRun: true, snapshotPath: path }))
    const { deps, db } = setup({ deletedFromStrava: true, stub: { dropSportTypeUpdateCount: 1 } })

    await mergeActivities(deps, pair({ source: { kind: 'snapshot', path } }))

    expect(getActivity(db, 990_001)?.sportType).toBe('Hike')
  })

  it('re-types a merge adopted from an earlier run that never finished', async () => {
    const path = snapshotPath()
    await mergeActivities(setup().deps, pair({ dryRun: true, snapshotPath: path }))
    const { deps, db } = setup({
      deletedFromStrava: true,
      stub: {
        activities: [makeActivity(990_500, CLIMB_START, { sport_type: 'Workout' })],
        uploadError: `duplicate of <a href='/activities/990500'>Plateau</a>`,
        dropSportTypeUpdateCount: 1,
      },
    })

    await mergeActivities(deps, pair({ source: { kind: 'snapshot', path } }))

    expect(getActivity(db, 990_500)?.sportType).toBe('Hike')
  })
})

describe('merging two interrupted activities — refusals', () => {
  const codeOf = async (run: () => Promise<unknown>): Promise<string> => {
    try {
      await run()
    } catch (err) {
      if (err instanceof MergeError || err instanceof ImportError) return err.code
      return `unexpected: ${String(err)}`
    }
    return 'no error'
  }

  it('refuses to upload while Strava still holds an original', async () => {
    const path = snapshotPath()
    const { deps, stub } = setup()
    await mergeActivities(deps, pair({ dryRun: true, snapshotPath: path }))

    expect(
      await codeOf(() => mergeActivities(deps, pair({ source: { kind: 'snapshot', path } }))),
    ).toBe('sources-still-present')
    expect(stub.uploads).toHaveLength(0)
  })

  it('refuses to adopt an original Strava matched the file against', async () => {
    const path = snapshotPath()
    await mergeActivities(setup().deps, pair({ dryRun: true, snapshotPath: path }))
    const { deps, db } = setup({
      deletedFromStrava: true,
      stub: { uploadError: `duplicate of <a href='/activities/${CLIMB}'>Mont&eacute;e</a>` },
    })

    expect(
      await codeOf(() => mergeActivities(deps, pair({ source: { kind: 'snapshot', path } }))),
    ).toBe('sources-still-present')
    expect(getActivity(db, CLIMB)).toBeTruthy()
  })

  it('adopts a merge an earlier run already uploaded', async () => {
    const path = snapshotPath()
    await mergeActivities(setup().deps, pair({ dryRun: true, snapshotPath: path }))
    const { deps, db } = setup({
      deletedFromStrava: true,
      stub: {
        activities: [makeActivity(990_500, CLIMB_START, { sport_type: 'Workout' })],
        uploadError: `duplicate of <a href='/activities/990500'>Plateau</a>`,
      },
    })

    const result = await mergeActivities(deps, pair({ source: { kind: 'snapshot', path } }))

    expect(result.alreadyExisted).toBe(true)
    expect(result.activityId).toBe(990_500)
    expect(getActivity(db, 990_500)?.sportType).toBe('Hike')
  })

  it('refuses to adopt the previous merge when a tag says to replace it', async () => {
    const path = snapshotPath()
    await mergeActivities(setup().deps, pair({ dryRun: true, snapshotPath: path }))
    const { deps, db } = setup({
      deletedFromStrava: true,
      stub: {
        activities: [makeActivity(990_500, CLIMB_START, { sport_type: 'Workout' })],
        uploadError: `duplicate of <a href='/activities/990500'>Plateau</a>`,
      },
    })

    expect(
      await codeOf(() =>
        mergeActivities(deps, pair({ source: { kind: 'snapshot', path }, tag: 'v2' })),
      ),
    ).toBe('previous-merge-present')
    expect(getActivity(db, 990_500)).toBeFalsy()
  })

  it('refuses two activities that belong to different athletes', async () => {
    const { deps, stub } = setup({
      rows: [row(CLIMB, CLIMB_START), row(DESCENT, DESCENT_START, { athleteId: SOMEONE_ELSE })],
    })

    expect(await codeOf(() => mergeActivities(deps, pair({ dryRun: true })))).toBe('mixed-athletes')
    expect(stub.requests).toHaveLength(0)
  })

  it('refuses activities it cannot attribute to anyone', async () => {
    const { deps } = setup({ rows: [] })
    expect(await codeOf(() => mergeActivities(deps, pair({ dryRun: true })))).toBe('unknown-source')
  })

  it('refuses to silently drop the heart rate of one side', async () => {
    const { deps } = setup({
      stub: {
        streams: { [CLIMB]: climbStreams, [DESCENT]: { ...descentStreams, heartrate: undefined } },
      },
    })

    expect(await codeOf(() => mergeActivities(deps, pair({ dryRun: true })))).toBe(
      'heartrate-asymmetric',
    )
  })

  it('drops it when told to, and says so', async () => {
    const { deps } = setup({
      stub: {
        streams: { [CLIMB]: climbStreams, [DESCENT]: { ...descentStreams, heartrate: undefined } },
      },
    })

    const { summary, tcx } = await mergeActivities(
      deps,
      pair({ dryRun: true, allowMissingHeartrate: true }),
    )

    expect(summary.dropped).toContain('heartrate')
    expect(tcx).not.toContain('<HeartRateBpm>')
  })

  it('reports an unreadable snapshot instead of crashing', async () => {
    expect(
      await codeOf(() =>
        mergeActivities(setup().deps, pair({ source: { kind: 'snapshot', path: '/nope.json' } })),
      ),
    ).toBe('snapshot-unreadable')
  })

  it('surfaces an upload the API refuses outright', async () => {
    const path = snapshotPath()
    await mergeActivities(setup().deps, pair({ dryRun: true, snapshotPath: path }))
    const { deps } = setup({ deletedFromStrava: true, stub: { uploadStatus: 500 } })

    expect(
      await codeOf(() => mergeActivities(deps, pair({ source: { kind: 'snapshot', path } }))),
    ).toBe('upload-failed')
  })

  it('gives up when Strava is still chewing on the file', async () => {
    const path = snapshotPath()
    await mergeActivities(setup().deps, pair({ dryRun: true, snapshotPath: path }))
    const { deps } = setup({ deletedFromStrava: true, stub: { uploadPolls: 5 } })

    expect(
      await codeOf(() =>
        mergeActivities(
          { ...deps, uploadTimeoutMs: 0 },
          pair({ source: { kind: 'snapshot', path } }),
        ),
      ),
    ).toBe('upload-timeout')
  })
})
