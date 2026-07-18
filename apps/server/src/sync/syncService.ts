import { activityAscentMean, type ActivityStreams, type SyncStatus } from '@stravaboard/shared'
import type { Db } from '../db/client.js'
import {
  countPendingStreams,
  countStreamsMissingLatlng,
  getActivity,
  listMissingMetrics,
  listPendingStreams,
  listStreamsMissingLatlng,
  setAscentMeanVSpeed,
  setStreamsStatus,
  updateActivityFields,
  upsertActivitySummary,
  type ActivityRow,
} from '../repositories/activities.repo.js'
import { deleteStreams, getStreams, saveStreams } from '../repositories/streams.repo.js'
import { getSyncState, saveSyncState } from '../repositories/syncState.repo.js'
import { listConnectedAthleteIds } from '../repositories/tokens.repo.js'
import { NotFoundError, RateLimitError, type StravaClient } from '../strava/client.js'
import { NotConnectedError } from '../strava/oauth.js'
import type { StravaStreamSet, StravaSummaryActivity } from '../strava/types.js'

export interface SyncServiceOptions {
  perPage?: number
  nowMs?: () => number
  sleep?: (ms: number) => Promise<void>
  log?: (msg: string) => void
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Consecutive no-progress network failures tolerated before the sync errors out. */
const MAX_NETWORK_FAILURES = 6

/**
 * Undici surfaces connection drops, DNS blips and timeouts as
 * `TypeError: fetch failed`; those deserve a retry, unlike HTTP-level
 * errors (StravaApiError) or bugs.
 */
function isTransientNetworkError(err: unknown): boolean {
  return err instanceof TypeError
}

interface AthleteSyncState {
  state: SyncStatus['state']
  fetched: number
  resumeAtMs: number | null
  lastError: string | null
}

/**
 * Incremental, resumable Strava sync, one athlete at a time (the Strava rate
 * limit is per application, so athletes share one RateLimiter via the client).
 *
 * Per athlete: pass 1 pages through /athlete/activities (oldest first thanks
 * to ?after) and upserts summaries as streams_status='pending'. Pass 2
 * fetches streams for every pending activity in start order; the checkpoint
 * only advances once an activity's streams are stored, so a crash or
 * rate-limit pause resumes exactly where it left off. Pass 3 backfills GPS
 * tracks for activities synced before the latlng column existed ('[]' is the
 * terminal "no GPS" marker, so each activity is re-fetched at most once).
 *
 * One athlete failing (revoked tokens, API errors) does not block the others.
 */
export class SyncService {
  private readonly states = new Map<number, AthleteSyncState>()
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
    this.running = this.run().finally(() => {
      this.running = null
    })
  }

  /** Resolves when the current sync (if any) is done — for tests and shutdown. */
  async whenIdle(): Promise<void> {
    await this.running
  }

  status(athleteId: number): SyncStatus {
    const st = this.stateFor(athleteId)
    return {
      state: st.state,
      fetchedActivities: st.fetched,
      pendingStreams: countPendingStreams(this.db, athleteId),
      pendingLatlngBackfill: countStreamsMissingLatlng(this.db, athleteId),
      ...(st.resumeAtMs !== null && st.state === 'waiting_rate_limit'
        ? { rateLimitResumeAt: new Date(st.resumeAtMs).toISOString() }
        : {}),
      ...(st.lastError !== null && st.state === 'error' ? { error: st.lastError } : {}),
    }
  }

  /**
   * Re-fetch one activity's summary and streams from Strava on demand — for
   * activities edited on strava.com after they were synced. Callers verify
   * ownership and handle NotFoundError / RateLimitError.
   */
  async refreshActivity(id: number): Promise<ActivityRow> {
    const existing = getActivity(this.db, id)
    if (!existing) throw new NotFoundError()
    const athleteId = existing.athleteId
    const detail = await this.client.getActivity(athleteId, id)
    upsertActivitySummary(this.db, toRow(athleteId, detail))
    try {
      const set = await this.client.getStreams(athleteId, id)
      this.storeStreams(id, toStoredStreams(set))
      setStreamsStatus(this.db, id, 'done')
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err
      deleteStreams(this.db, id)
      setStreamsStatus(this.db, id, 'none')
    }
    return getActivity(this.db, id)!
  }

  /**
   * Rename and/or retype one activity, writing the change back to Strava
   * (UpdateActivity) and mirroring it into the local row. The athlete is
   * derived from the stored row. Callers verify ownership and handle
   * NotFoundError / RateLimitError / StravaApiError (missing write scope).
   */
  async editActivity(
    id: number,
    patch: { name?: string; sportType?: string },
  ): Promise<ActivityRow> {
    const existing = getActivity(this.db, id)
    if (!existing) throw new NotFoundError()
    const updated = await this.client.updateActivity(existing.athleteId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.sportType !== undefined ? { sport_type: patch.sportType } : {}),
    })
    // Trust Strava's canonical response for the stored values.
    updateActivityFields(this.db, id, { name: updated.name, sportType: updated.sport_type })
    return getActivity(this.db, id)!
  }

  private stateFor(athleteId: number): AthleteSyncState {
    let st = this.states.get(athleteId)
    if (!st) {
      st = { state: 'idle', fetched: 0, resumeAtMs: null, lastError: null }
      this.states.set(athleteId, st)
    }
    return st
  }

  private async run(): Promise<void> {
    for (const athleteId of listConnectedAthleteIds(this.db)) {
      await this.runFor(athleteId)
    }
  }

  private async runFor(athleteId: number): Promise<void> {
    const st = this.stateFor(athleteId)
    st.state = 'syncing'
    st.fetched = 0
    st.lastError = null
    saveSyncState(this.db, athleteId, { status: 'syncing', error: null })

    try {
      this.computeMissingMetrics(athleteId) // local only, no API budget
      await this.retryingOnRateLimit(athleteId, () => this.fetchNewSummaries(athleteId))
      await this.retryingOnRateLimit(athleteId, () => this.fetchPendingStreams(athleteId))
      await this.retryingOnRateLimit(athleteId, () => this.backfillLatlng(athleteId))
      st.state = 'idle'
      saveSyncState(this.db, athleteId, { status: 'idle' })
      this.log(`sync done for athlete ${athleteId}: ${st.fetched} activities fetched`)
    } catch (err) {
      if (err instanceof NotConnectedError) {
        st.state = 'idle'
        saveSyncState(this.db, athleteId, { status: 'idle' })
        return
      }
      // Record and move on — one athlete's failure must not block the family.
      st.state = 'error'
      st.lastError = err instanceof Error ? err.message : String(err)
      saveSyncState(this.db, athleteId, { status: 'error', error: st.lastError })
      this.log(`sync failed for athlete ${athleteId}: ${st.lastError}`)
    }
  }

  /**
   * Runs `work`, sleeping through Strava rate-limit windows and retrying
   * transient network failures with backoff. Progress is checkpointed, so
   * re-running `work` after a mid-flight failure is safe; any progress since
   * the last failure resets the retry budget — only a *persistently* dead
   * network exhausts it.
   */
  private async retryingOnRateLimit(athleteId: number, work: () => Promise<void>): Promise<void> {
    const st = this.stateFor(athleteId)
    let networkFailures = 0
    for (;;) {
      const progressBefore = this.progressMarker(athleteId)
      try {
        await work()
        return
      } catch (err) {
        if (err instanceof RateLimitError) {
          st.state = 'waiting_rate_limit'
          st.resumeAtMs = err.resumeAtMs
          const waitMs = Math.max(0, err.resumeAtMs - this.nowMs()) + 1000
          this.log(`rate limited, resuming at ${new Date(err.resumeAtMs).toISOString()}`)
          await this.sleep(waitMs)
          st.state = 'syncing'
          st.resumeAtMs = null
          continue
        }
        if (isTransientNetworkError(err)) {
          if (this.progressMarker(athleteId) !== progressBefore) networkFailures = 0
          networkFailures++
          if (networkFailures > MAX_NETWORK_FAILURES) throw err
          const backoffMs = Math.min(60_000, 2000 * 2 ** (networkFailures - 1))
          this.log(
            `network error (${(err as Error).message}), retry ${networkFailures}/${MAX_NETWORK_FAILURES} in ${backoffMs / 1000}s`,
          )
          await this.sleep(backoffMs)
          continue
        }
        throw err
      }
    }
  }

  /** Cheap fingerprint of one athlete's sync progress, resets the network-retry budget. */
  private progressMarker(athleteId: number): string {
    const st = this.stateFor(athleteId)
    return `${st.fetched}:${countPendingStreams(this.db, athleteId)}:${countStreamsMissingLatlng(this.db, athleteId)}`
  }

  private async fetchNewSummaries(athleteId: number): Promise<void> {
    // -1: re-include the checkpoint second itself, in case two activities
    // share it; upserts are idempotent so the overlap is free.
    const after = Math.max(0, getSyncState(this.db, athleteId).lastActivityStartEpoch - 1)
    const st = this.stateFor(athleteId)
    for (let page = 1; ; page++) {
      const batch = await this.client.listActivities(athleteId, after, page, this.perPage)
      for (const a of batch) {
        upsertActivitySummary(this.db, toRow(athleteId, a))
        st.fetched++
      }
      if (batch.length < this.perPage) return
    }
  }

  private async fetchPendingStreams(athleteId: number): Promise<void> {
    for (;;) {
      const pending = listPendingStreams(this.db, athleteId, 50)
      if (pending.length === 0) return
      for (const activity of pending) {
        await this.fetchStreamsFor(activity)
      }
    }
  }

  /** Persist streams and refresh the derived sort/badge metric together. */
  private storeStreams(activityId: number, streams: ActivityStreams): void {
    saveStreams(this.db, activityId, streams, new Date(this.nowMs()).toISOString())
    setAscentMeanVSpeed(this.db, activityId, this.ascentMetric(streams))
  }

  /**
   * The stored sort/badge metric, defensively. `0` means "computed, nothing
   * rankable" — NULL stays reserved for "not computed yet" (or the backfill
   * never terminates). A single malformed stream set must never abort a sync,
   * so any unexpected failure is logged and treated as unrankable.
   */
  private ascentMetric(streams: ActivityStreams): number {
    try {
      return activityAscentMean(streams) ?? 0
    } catch (err) {
      this.log(`ascent metric skipped: ${err instanceof Error ? err.message : String(err)}`)
      return 0
    }
  }

  /**
   * One-time local pass: compute the stored metric for activities whose
   * streams predate the ascent_mean_vspeed column. Pure CPU, no API calls.
   */
  private computeMissingMetrics(athleteId: number): void {
    for (;;) {
      const ids = listMissingMetrics(this.db, athleteId, 200)
      if (ids.length === 0) return
      this.log(`computing ascent metrics for ${ids.length} activities`)
      for (const id of ids) {
        const streams = getStreams(this.db, id)
        setAscentMeanVSpeed(this.db, id, streams ? this.ascentMetric(streams) : 0)
      }
    }
  }

  private async fetchStreamsFor(activity: ActivityRow): Promise<void> {
    try {
      const set = await this.client.getStreams(activity.athleteId, activity.id)
      this.storeStreams(activity.id, toStoredStreams(set))
      setStreamsStatus(this.db, activity.id, 'done')
    } catch (err) {
      // Manual/indoor activities have no streams; that is a terminal state, not an error.
      if (!(err instanceof NotFoundError)) throw err
      setStreamsStatus(this.db, activity.id, 'none')
    }
    const checkpoint = getSyncState(this.db, activity.athleteId).lastActivityStartEpoch
    if (activity.startDateEpoch > checkpoint) {
      saveSyncState(this.db, activity.athleteId, {
        lastActivityStartEpoch: activity.startDateEpoch,
      })
    }
  }

  private async backfillLatlng(athleteId: number): Promise<void> {
    for (;;) {
      const rows = listStreamsMissingLatlng(this.db, athleteId, 50)
      if (rows.length === 0) return
      this.log(
        `backfilling GPS tracks: ${countStreamsMissingLatlng(this.db, athleteId)} activities left`,
      )
      for (const activity of rows) {
        await this.refetchStreamsFor(activity)
      }
    }
  }

  /**
   * Re-fetch the full stream set of an already-synced activity to pick up its
   * GPS track. Always leaves a non-NULL latlng behind (the backfill's
   * termination guarantee), even when Strava no longer serves the streams.
   */
  private async refetchStreamsFor(activity: ActivityRow): Promise<void> {
    try {
      const set = await this.client.getStreams(activity.athleteId, activity.id)
      this.storeStreams(activity.id, toStoredStreams(set))
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err
      const existing = getStreams(this.db, activity.id)
      if (existing) {
        this.storeStreams(activity.id, { ...existing, latlng: [] })
      }
    }
  }
}

function toRow(athleteId: number, a: StravaSummaryActivity): ActivityRow {
  return {
    id: a.id,
    athleteId,
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

/** Map a Strava stream set to the stored shape; a missing latlng stream means "no GPS". */
function toStoredStreams(set: StravaStreamSet): ActivityStreams {
  return {
    time: set.time?.data ?? [],
    distance: set.distance?.data ?? [],
    altitude: set.altitude?.data ?? null,
    latlng: set.latlng?.data ?? [],
  }
}
