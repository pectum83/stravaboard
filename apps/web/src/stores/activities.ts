import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ActivityBadges, ActivitySummary } from '@stravaboard/shared'
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

const NO_BADGES: ActivityBadges = { ascentSpeed: [], elevation: [] }

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

  async function loadFirstPage(): Promise<void> {
    activities.value = []
    nextBefore.value = undefined
    hasMore.value = true
    await Promise.all([loadMore(), loadSportTypes(), loadBadges()])
  }

  /** Reset the list and reload the first page (shared by filter and sort changes). */
  async function reload(): Promise<void> {
    activities.value = []
    nextBefore.value = undefined
    hasMore.value = true
    await loadMore()
  }

  /** Merge a filter change and reload from the first page. */
  async function setFilters(patch: Partial<ActivityFilters>): Promise<void> {
    filters.value = { ...filters.value, ...patch }
    await reload()
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
    const f = filters.value
    try {
      const page = await api.activities({
        limit: PAGE_SIZE,
        before: nextBefore.value,
        sort: sort.value,
        ...(f.q.trim() !== '' ? { q: f.q.trim() } : {}),
        ...(f.from !== '' ? { from: f.from } : {}),
        ...(f.to !== '' ? { to: f.to } : {}),
        ...(f.sportType !== '' ? { sportType: f.sportType } : {}),
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
      badges.value = await api.badges()
    } catch {
      // Badges are decorative; degrade to none.
    }
  }

  function select(id: number): void {
    selectedId.value = id
  }

  /** Re-fetch one activity from Strava (after it was edited there). Throws on failure. */
  async function refreshActivity(id: number): Promise<void> {
    const updated = await api.refreshActivity(id)
    activities.value = activities.value.map((a) => (a.id === id ? updated : a))
    // Ranks may have shifted (name/crop/streams changed the metric).
    await loadBadges()
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
    loadFirstPage,
    loadMore,
    setFilters,
    setSort,
    select,
    refreshActivity,
  }
})
