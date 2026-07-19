import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ActivityAggregate, ActivityBadges, ActivitySummary } from '@stravaboard/shared'
import { api, type ActivitySort } from '../api/client'

const PAGE_SIZE = 50

export interface ActivityFilters {
  /** Name substring. */
  q: string
  /** Inclusive date range, YYYY-MM-DD ('' = unbounded). */
  from: string
  to: string
  /** Sport type ('' = all). */
  sportType: string
}

export const EMPTY_FILTERS: ActivityFilters = { q: '', from: '', to: '', sportType: '' }

const NO_BADGES: ActivityBadges = { ascentSpeed: [], elevation: [], effort: [] }

const NO_AGGREGATE: ActivityAggregate = { count: 0, totalAscentGainM: 0 }

/** Sport the list opens on, when the athlete has any such activities. */
const DEFAULT_SPORT_TYPE = 'Hike'

export const useActivitiesStore = defineStore('activities', () => {
  const activities = ref<ActivitySummary[]>([])
  const selectedId = ref<number | null>(null)
  const nextBefore = ref<string | undefined>(undefined)
  const hasMore = ref(true)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const filters = ref<ActivityFilters>({ ...EMPTY_FILTERS })
  const sort = ref<ActivitySort>('date')
  const sportTypes = ref<string[]>([])
  const badges = ref<ActivityBadges>(NO_BADGES)
  /** Whole-filter totals (count + cumulated D+) for the list header. */
  const aggregate = ref<ActivityAggregate>(NO_AGGREGATE)
  // Once the user picks a sport type (or clears filters) we stop forcing the
  // Hike default, so their choice survives re-syncs.
  const sportTypeTouched = ref(false)

  /** Non-empty filter fields, as API query params. */
  function activeFilterParams() {
    const f = filters.value
    return {
      ...(f.q.trim() !== '' ? { q: f.q.trim() } : {}),
      ...(f.from !== '' ? { from: f.from } : {}),
      ...(f.to !== '' ? { to: f.to } : {}),
      ...(f.sportType !== '' ? { sportType: f.sportType } : {}),
    }
  }

  async function loadFirstPage(): Promise<void> {
    activities.value = []
    nextBefore.value = undefined
    hasMore.value = true
    // Sport types first: the Hike default only applies when it's available.
    await loadSportTypes()
    if (
      !sportTypeTouched.value &&
      filters.value.sportType === '' &&
      sportTypes.value.includes(DEFAULT_SPORT_TYPE)
    ) {
      filters.value.sportType = DEFAULT_SPORT_TYPE
    }
    await Promise.all([loadMore(), loadBadges(), loadAggregate()])
  }

  /** Reset the list and reload the first page (shared by filter and sort changes). */
  async function reload(): Promise<void> {
    activities.value = []
    nextBefore.value = undefined
    hasMore.value = true
    await loadMore()
  }

  /**
   * Reload the list, badges and header totals together — after a change that can
   * re-rank activities (e.g. a metric-affecting settings change the server has
   * just recomputed). The current sort/filter and selection are preserved.
   */
  async function reloadRankings(): Promise<void> {
    await Promise.all([reload(), loadBadges(), loadAggregate()])
  }

  /** Merge a filter change and reload the list and badges from the first page. */
  async function setFilters(patch: Partial<ActivityFilters>): Promise<void> {
    // A sport-type change (including Clear) is a deliberate choice — respect it.
    if (patch.sportType !== undefined) sportTypeTouched.value = true
    filters.value = { ...filters.value, ...patch }
    await Promise.all([reload(), loadBadges(), loadAggregate()])
  }

  async function setSort(next: ActivitySort): Promise<void> {
    if (sort.value === next) return
    sort.value = next
    await reload()
  }

  async function loadMore(): Promise<void> {
    if (loading.value || !hasMore.value) return
    loading.value = true
    error.value = null
    try {
      const page = await api.activities({
        limit: PAGE_SIZE,
        before: nextBefore.value,
        sort: sort.value,
        ...activeFilterParams(),
      })
      activities.value = [...activities.value, ...page.activities]
      nextBefore.value = page.nextBefore
      hasMore.value = page.nextBefore !== undefined
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  async function loadSportTypes(): Promise<void> {
    try {
      sportTypes.value = await api.sportTypes()
    } catch {
      // Filter dropdown degrades to "all sports"; not worth surfacing.
    }
  }

  async function loadBadges(): Promise<void> {
    try {
      badges.value = await api.badges(activeFilterParams())
    } catch {
      // Badges are decorative; degrade to none.
    }
  }

  async function loadAggregate(): Promise<void> {
    try {
      aggregate.value = await api.stats(activeFilterParams())
    } catch {
      // The header totals are informational; degrade to zeros.
    }
  }

  function select(id: number): void {
    selectedId.value = id
  }

  /** Re-fetch one activity from Strava (after it was edited there). Throws on failure. */
  async function refreshActivity(id: number): Promise<void> {
    const updated = await api.refreshActivity(id)
    activities.value = activities.value.map((a) => (a.id === id ? updated : a))
    // Ranks and totals may have shifted (name/crop/streams changed the metric).
    await Promise.all([loadBadges(), loadAggregate()])
  }

  /**
   * Rename / re-type one activity (written through to Strava) and reflect it in
   * the list. A sport-type change can alter the sport-type filter set, so
   * refresh that too. Throws on failure so the caller can surface the error.
   */
  async function editActivity(
    id: number,
    patch: { name?: string; sportType?: string },
  ): Promise<void> {
    const updated = await api.updateActivity(id, patch)
    activities.value = activities.value.map((a) => (a.id === id ? updated : a))
    if (patch.sportType !== undefined) await loadSportTypes()
  }

  return {
    activities,
    selectedId,
    hasMore,
    loading,
    error,
    filters,
    sort,
    sportTypes,
    badges,
    aggregate,
    loadFirstPage,
    loadMore,
    reloadRankings,
    setFilters,
    setSort,
    select,
    refreshActivity,
    editActivity,
  }
})
