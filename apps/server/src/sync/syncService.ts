import type { SyncStatus } from '@stravaboard/shared'
import type { Db } from '../db/client.js'
import {
  countPendingStreams,
  listPendingStreams,
  setStreamsStatus,
  upsertActivitySummary,
  type ActivityRow,
} from '../repositories/activities.repo.js'
import { saveStreams } from '../repositories/streams.repo.js'
import { getSyncState, saveSyncState } from '../repositories/syncState.repo.js'
import { NotFoundError, RateLimitError, type StravaClient } from '../strava/client.js'
import { NotConnectedError } from '../strava/oauth.js'
import type { StravaSummaryActivity } from '../strava/types.js'

export interface SyncServiceOptions {
  perPage?: number
  nowMs?: () => number
  sleep?: (ms: number) => Promise<void>
  log?: (msg: string) => void
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Incremental, resumable Strava sync.
 *
 * Pass 1 pages through /athlete/activities (oldest first thanks to ?after)
 * and upserts summaries as streams_status='pending'. Pass 2 fetches streams
 * for every pending activity in start order; the checkpoint only advances
 * once an activity's streams are stored, so a crash or rate-limit pause
 * resumes exactly where it left off.
 */
export class SyncService {
  private state: SyncStatus['state'] = 'idle'
  private fetched = 0
  private resumeAtMs: number | null = null
  private lastError: string | null = null
  private running: Promise<void> | null = null

  private readonly perPage: number
  private readonly nowMs: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly log: (msg: string) => void

  constructor(
    private readonly db: Db,
    private readonly client: StravaClient,
    opts: SyncServiceOptions = {},
  ) {
    this.perPage = opts.perPage ?? 200
    this.nowMs = opts.nowMs ?? Date.now
    this.sleep = opts.sleep ?? defaultSleep
    this.log = opts.log ?? (() => {})
  }

  /** Fire-and-forget start; no-op when a sync is already running. */
  start(): void {
    if (this.running) return
    this.running = this.run()
      .catch((err: unknown) => {
        this.state = 'error'
        this.lastError = err instanceof Error ? err.message : String(err)
        this.log(`sync failed: ${this.lastError}`)
      })
      .finally(() => {
        this.running = null
      })
  }

  /** Resolves when the current sync (if any) is done — for tests and shutdown. */
  async whenIdle(): Promise<void> {
    await this.running
  }

  status(): SyncStatus {
    return {
      state: this.state,
      fetchedActivities: this.fetched,
      pendingStreams: countPendingStreams(this.db),
      ...(this.resumeAtMs !== null && this.state === 'waiting_rate_limit'
        ? { rateLimitResumeAt: new Date(this.resumeAtMs).toISOString() }
        : {}),
      ...(this.lastError !== null && this.state === 'error' ? { error: this.lastError } : {}),
    }
  }

  private async run(): Promise<void> {
    this.state = 'syncing'
    this.fetched = 0
    this.lastError = null
    saveSyncState(this.db, { status: 'syncing', error: null })

    try {
      await this.retryingOnRateLimit(() => this.fetchNewSummaries())
      await this.retryingOnRateLimit(() => this.fetchPendingStreams())
      this.state = 'idle'
      saveSyncState(this.db, { status: 'idle' })
      this.log(`sync done: ${this.fetched} activities fetched`)
    } catch (err) {
      if (err instanceof NotConnectedError) {
        this.state = 'idle'
        saveSyncState(this.db, { status: 'idle' })
        this.log('sync skipped: no Strava account connected')
        return
      }
      saveSyncState(this.db, {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  /** Runs `work`, sleeping through Strava rate-limit windows as needed. */
  private async retryingOnRateLimit(work: () => Promise<void>): Promise<void> {
    for (;;) {
      try {
        await work()
        return
      } catch (err) {
        if (!(err instanceof RateLimitError)) throw err
        this.state = 'waiting_rate_limit'
        this.resumeAtMs = err.resumeAtMs
        const waitMs = Math.max(0, err.resumeAtMs - this.nowMs()) + 1000
        this.log(`rate limited, resuming at ${new Date(err.resumeAtMs).toISOString()}`)
        await this.sleep(waitMs)
        this.state = 'syncing'
        this.resumeAtMs = null
      }
    }
  }

  private async fetchNewSummaries(): Promise<void> {
    // -1: re-include the checkpoint second itself, in case two activities
    // share it; upserts are idempotent so the overlap is free.
    const after = Math.max(0, getSyncState(this.db).lastActivityStartEpoch - 1)
    for (let page = 1; ; page++) {
      const batch = await this.client.listActivities(after, page, this.perPage)
      for (const a of batch) {
        upsertActivitySummary(this.db, toRow(a))
        this.fetched++
      }
      if (batch.length < this.perPage) return
    }
  }

  private async fetchPendingStreams(): Promise<void> {
    for (;;) {
      const pending = listPendingStreams(this.db, 50)
      if (pending.length === 0) return
      for (const activity of pending) {
        await this.fetchStreamsFor(activity)
      }
    }
  }

  private async fetchStreamsFor(activity: ActivityRow): Promise<void> {
    try {
      const set = await this.client.getStreams(activity.id)
      saveStreams(
        this.db,
        activity.id,
        {
          time: set.time?.data ?? [],
          distance: set.distance?.data ?? [],
          altitude: set.altitude?.data ?? null,
        },
        new Date(this.nowMs()).toISOString(),
      )
      setStreamsStatus(this.db, activity.id, 'done')
    } catch (err) {
      // Manual/indoor activities have no streams; that is a terminal state, not an error.
      if (!(err instanceof NotFoundError)) throw err
      setStreamsStatus(this.db, activity.id, 'none')
    }
    const checkpoint = getSyncState(this.db).lastActivityStartEpoch
    if (activity.startDateEpoch > checkpoint) {
      saveSyncState(this.db, { lastActivityStartEpoch: activity.startDateEpoch })
    }
  }
}

function toRow(a: StravaSummaryActivity): ActivityRow {
  return {
    id: a.id,
    name: a.name,
    sportType: a.sport_type,
    startDate: a.start_date,
    startDateEpoch: Math.floor(Date.parse(a.start_date) / 1000),
    distanceM: a.distance,
    movingTimeS: a.moving_time,
    elapsedTimeS: a.elapsed_time,
    totalElevationGainM: a.total_elevation_gain,
    streamsStatus: 'pending',
    rawSummary: JSON.stringify(a),
  }
}
