import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { ActivitySummary } from '@stravaboard/shared'
import { useActivitiesStore } from '../stores/activities'
import { api } from '../api/client'

vi.mock('../api/client', () => ({
  api: {
    activities: vi.fn(),
    sportTypes: vi.fn(),
    badges: vi.fn(),
    stats: vi.fn(),
    refreshActivity: vi.fn(),
    updateActivity: vi.fn(),
  },
}))

function summary(id: number, overrides: Partial<ActivitySummary> = {}): ActivitySummary {
  return {
    id,
    name: `Activity ${id}`,
    sportType: 'Run',
    startDate: '2026-06-20T07:30:00Z',
    distanceM: 10_000,
    movingTimeS: 3600,
    elapsedTimeS: 3700,
    totalElevationGainM: 500,
    streamsStatus: 'done',
    ascentMeanVSpeed: 600,
    ascentGainM: 480,
    descentLossM: 520,
    ...overrides,
  }
}

describe('activities store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(api.sportTypes).mockResolvedValue(['Run'])
    vi.mocked(api.badges).mockResolvedValue({ ascentSpeed: [], elevation: [] })
    vi.mocked(api.stats).mockResolvedValue({ count: 0, totalAscentGainM: 0 })
  })

  it('replaces the refreshed activity in place', async () => {
    vi.mocked(api.activities).mockResolvedValue({ activities: [summary(1), summary(2)] })
    const store = useActivitiesStore()
    await store.loadFirstPage()

    vi.mocked(api.refreshActivity).mockResolvedValue(
      summary(2, { name: 'Cropped', distanceM: 9000 }),
    )
    await store.refreshActivity(2)

    expect(store.activities.map((a) => a.name)).toEqual(['Activity 1', 'Cropped'])
    expect(store.activities[1]!.distanceM).toBe(9000)
  })

  it('propagates refresh failures without touching the list', async () => {
    vi.mocked(api.activities).mockResolvedValue({ activities: [summary(1)] })
    const store = useActivitiesStore()
    await store.loadFirstPage()

    vi.mocked(api.refreshActivity).mockRejectedValue(new Error('rate limit'))
    await expect(store.refreshActivity(1)).rejects.toThrow('rate limit')
    expect(store.activities[0]!.name).toBe('Activity 1')
  })

  it('replaces the edited activity in place and refreshes sport types on retype', async () => {
    vi.mocked(api.activities).mockResolvedValue({ activities: [summary(1), summary(2)] })
    const store = useActivitiesStore()
    await store.loadFirstPage()

    vi.mocked(api.sportTypes).mockClear()
    vi.mocked(api.updateActivity).mockResolvedValue(
      summary(2, { name: 'Renamed', sportType: 'Hike' }),
    )
    await store.editActivity(2, { name: 'Renamed', sportType: 'Hike' })

    expect(api.updateActivity).toHaveBeenCalledWith(2, { name: 'Renamed', sportType: 'Hike' })
    expect(store.activities.map((a) => a.name)).toEqual(['Activity 1', 'Renamed'])
    // A sport-type change can alter the filter set, so it reloads sport types.
    expect(api.sportTypes).toHaveBeenCalledOnce()
  })

  it('does not reload sport types for a rename-only edit', async () => {
    vi.mocked(api.activities).mockResolvedValue({ activities: [summary(1)] })
    const store = useActivitiesStore()
    await store.loadFirstPage()

    vi.mocked(api.sportTypes).mockClear()
    vi.mocked(api.updateActivity).mockResolvedValue(summary(1, { name: 'Renamed' }))
    await store.editActivity(1, { name: 'Renamed' })

    expect(store.activities[0]!.name).toBe('Renamed')
    expect(api.sportTypes).not.toHaveBeenCalled()
  })

  it('propagates edit failures without touching the list', async () => {
    vi.mocked(api.activities).mockResolvedValue({ activities: [summary(1)] })
    const store = useActivitiesStore()
    await store.loadFirstPage()

    vi.mocked(api.updateActivity).mockRejectedValue(new Error('reconnect'))
    await expect(store.editActivity(1, { name: 'x' })).rejects.toThrow('reconnect')
    expect(store.activities[0]!.name).toBe('Activity 1')
  })

  it('resets the list and pagination when filters change', async () => {
    vi.mocked(api.activities).mockResolvedValue({
      activities: [summary(1)],
      nextBefore: '1000',
    })
    const store = useActivitiesStore()
    await store.loadFirstPage()

    vi.mocked(api.activities).mockResolvedValue({ activities: [summary(2)] })
    await store.setFilters({ q: 'mountain' })

    expect(vi.mocked(api.activities)).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'mountain', before: undefined }),
    )
    expect(store.activities.map((a) => a.id)).toEqual([2])
    expect(store.hasMore).toBe(false)
  })

  it('reloads with the chosen sort and exposes badges', async () => {
    vi.mocked(api.activities).mockResolvedValue({ activities: [summary(1)] })
    vi.mocked(api.badges).mockResolvedValue({ ascentSpeed: [3, 1], elevation: [1] })
    const store = useActivitiesStore()
    await store.loadFirstPage()
    expect(store.badges.ascentSpeed).toEqual([3, 1])

    vi.mocked(api.activities).mockResolvedValue({ activities: [summary(2)] })
    await store.setSort('ascentSpeed')
    expect(vi.mocked(api.activities)).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: 'ascentSpeed', before: undefined }),
    )
    expect(store.sort).toBe('ascentSpeed')
    expect(store.activities.map((a) => a.id)).toEqual([2])
  })

  it('loads whole-filter totals on first load and re-loads them when filters change', async () => {
    vi.mocked(api.activities).mockResolvedValue({ activities: [summary(1)] })
    vi.mocked(api.stats).mockResolvedValue({ count: 42, totalAscentGainM: 12_345 })
    const store = useActivitiesStore()
    await store.loadFirstPage()
    expect(store.aggregate).toEqual({ count: 42, totalAscentGainM: 12_345 })

    vi.mocked(api.stats).mockResolvedValue({ count: 3, totalAscentGainM: 900 })
    await store.setFilters({ q: 'col' })
    expect(vi.mocked(api.stats)).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'col' }))
    expect(store.aggregate).toEqual({ count: 3, totalAscentGainM: 900 })
  })

  it('opens on Hike when the athlete has hikes, and filters list + badges by it', async () => {
    vi.mocked(api.sportTypes).mockResolvedValue(['Hike', 'Run'])
    vi.mocked(api.activities).mockResolvedValue({ activities: [summary(1)] })
    const store = useActivitiesStore()
    await store.loadFirstPage()

    expect(store.filters.sportType).toBe('Hike')
    expect(vi.mocked(api.activities)).toHaveBeenLastCalledWith(
      expect.objectContaining({ sportType: 'Hike' }),
    )
    expect(vi.mocked(api.badges)).toHaveBeenLastCalledWith({ sportType: 'Hike' })
  })

  it('leaves the filter unset when the athlete has no hikes', async () => {
    vi.mocked(api.sportTypes).mockResolvedValue(['Run', 'Ride'])
    vi.mocked(api.activities).mockResolvedValue({ activities: [summary(1)] })
    const store = useActivitiesStore()
    await store.loadFirstPage()

    expect(store.filters.sportType).toBe('')
    expect(vi.mocked(api.badges)).toHaveBeenLastCalledWith({})
  })

  it('stops forcing the Hike default once the user clears the sport filter', async () => {
    vi.mocked(api.sportTypes).mockResolvedValue(['Hike', 'Run'])
    vi.mocked(api.activities).mockResolvedValue({ activities: [summary(1)] })
    const store = useActivitiesStore()
    await store.loadFirstPage()
    expect(store.filters.sportType).toBe('Hike')

    await store.setFilters({ sportType: '' }) // user chose "All sports"
    expect(store.filters.sportType).toBe('')

    // A later re-sync must not snap back to Hike.
    await store.loadFirstPage()
    expect(store.filters.sportType).toBe('')
  })
})
