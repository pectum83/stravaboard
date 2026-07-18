import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { ActivityBadges, ActivitySummary } from '@stravaboard/shared'
import ActivityList from '../components/ActivityList.vue'
import { useActivitiesStore } from '../stores/activities'

function activity(id: number, overrides: Partial<ActivitySummary> = {}): ActivitySummary {
  return {
    id,
    name: `Trail ${id}`,
    sportType: 'TrailRun',
    startDate: '2026-03-01T08:00:00Z',
    distanceM: 12_345,
    movingTimeS: 5400,
    elapsedTimeS: 5600,
    totalElevationGainM: 850,
    streamsStatus: 'done',
    ascentMeanVSpeed: 612,
    ...overrides,
  }
}

const NO_BADGES: ActivityBadges = { ascentSpeed: [], elevation: [] }

type ListProps = InstanceType<typeof ActivityList>['$props']

function mountList(props: Partial<ListProps> & { activities: ActivitySummary[] }) {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(ActivityList, {
    props: { selectedId: null, hasMore: false, loading: false, badges: NO_BADGES, ...props },
    global: { plugins: [pinia] },
  })
}

describe('ActivityList', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders name, distance, elevation gain and ascent mean speed', () => {
    const wrapper = mountList({ activities: [activity(1)] })
    expect(wrapper.text()).toContain('Trail 1')
    expect(wrapper.text()).toContain('12.3 km')
    expect(wrapper.text()).toContain('D+ 850 m')
    expect(wrapper.text()).toContain('↑ 612 m/h')
  })

  it('emits select with the activity id on click', async () => {
    const wrapper = mountList({ activities: [activity(7)] })
    await wrapper.find('button.item').trigger('click')
    expect(wrapper.emitted('select')).toEqual([[7]])
  })

  it('marks the selected activity and greys activities without streams', () => {
    const wrapper = mountList({
      activities: [activity(1), activity(2, { streamsStatus: 'none' })],
      selectedId: 1,
    })
    const items = wrapper.findAll('button.item')
    expect(items[0]!.classes()).toContain('selected')
    expect(items[1]!.classes()).toContain('no-streams')
    expect(items[1]!.text()).toContain('no elevation data')
  })

  it('decorates the top-3 activities with medals for both rankings', () => {
    const wrapper = mountList({
      activities: [activity(1), activity(2), activity(3)],
      badges: { ascentSpeed: [2, 1], elevation: [1] },
    })
    const items = wrapper.findAll('button.item')
    // Activity 1 is #2 ascent speed AND #1 elevation → two medals.
    expect(items[0]!.find('.medals').text()).toBe('🥈🥇')
    // Activity 2 is #1 ascent speed → one gold.
    expect(items[1]!.find('.medals').text()).toBe('🥇')
    // Activity 3 has no badge.
    expect(items[2]!.find('.medals').exists()).toBe(false)
  })

  it('shows a load-more button only when more pages exist', async () => {
    const withMore = mountList({ activities: [activity(1)], hasMore: true })
    await withMore.find('button.load-more').trigger('click')
    expect(withMore.emitted('loadMore')).toHaveLength(1)

    const lastPage = mountList({ activities: [activity(1)] })
    expect(lastPage.find('button.load-more').exists()).toBe(false)
  })

  it('shows an empty state without activities', () => {
    const wrapper = mountList({ activities: [] })
    expect(wrapper.text()).toContain('No activities yet.')
  })

  describe('inline editing', () => {
    it('opens an edit form pre-filled with the name and sport type', async () => {
      const wrapper = mountList({ activities: [activity(1, { name: 'Old', sportType: 'Run' })] })
      await wrapper.find('button.edit-toggle').trigger('click')

      const input = wrapper.find('input.edit-name').element as HTMLInputElement
      const select = wrapper.find('select.edit-sport').element as HTMLSelectElement
      expect(input.value).toBe('Old')
      expect(select.value).toBe('Run')
      // The clickable item is replaced by the form while editing.
      expect(wrapper.find('button.item').exists()).toBe(false)
    })

    it('saves only the changed fields through the store, then closes', async () => {
      const wrapper = mountList({ activities: [activity(1, { name: 'Old', sportType: 'Run' })] })
      const store = useActivitiesStore()
      const edit = vi.spyOn(store, 'editActivity').mockResolvedValue()

      await wrapper.find('button.edit-toggle').trigger('click')
      await wrapper.find('input.edit-name').setValue('New name')
      await wrapper.find('form.edit').trigger('submit')

      expect(edit).toHaveBeenCalledWith(1, { name: 'New name' })
      // Form closed on success.
      expect(wrapper.find('form.edit').exists()).toBe(false)
      expect(wrapper.find('button.item').exists()).toBe(true)
    })

    it('sends a sport-type change', async () => {
      const wrapper = mountList({ activities: [activity(1, { name: 'Old', sportType: 'Run' })] })
      const store = useActivitiesStore()
      const edit = vi.spyOn(store, 'editActivity').mockResolvedValue()

      await wrapper.find('button.edit-toggle').trigger('click')
      await wrapper.find('select.edit-sport').setValue('Hike')
      await wrapper.find('form.edit').trigger('submit')

      expect(edit).toHaveBeenCalledWith(1, { sportType: 'Hike' })
    })

    it('cancels without calling the store and restores the row', async () => {
      const wrapper = mountList({ activities: [activity(1, { name: 'Old' })] })
      const store = useActivitiesStore()
      const edit = vi.spyOn(store, 'editActivity').mockResolvedValue()

      await wrapper.find('button.edit-toggle').trigger('click')
      await wrapper.find('input.edit-name').setValue('Discarded')
      await wrapper.find('button.cancel').trigger('click')

      expect(edit).not.toHaveBeenCalled()
      expect(wrapper.find('button.item').exists()).toBe(true)
    })

    it('surfaces a save failure and keeps the form open', async () => {
      const wrapper = mountList({ activities: [activity(1, { name: 'Old' })] })
      const store = useActivitiesStore()
      vi.spyOn(store, 'editActivity').mockRejectedValue(new Error('reconnect your Strava account'))

      await wrapper.find('button.edit-toggle').trigger('click')
      await wrapper.find('input.edit-name').setValue('New name')
      await wrapper.find('form.edit').trigger('submit')
      await new Promise((r) => setTimeout(r)) // let the rejected promise settle

      expect(wrapper.find('.edit-error').text()).toContain('reconnect')
      expect(wrapper.find('form.edit').exists()).toBe(true)
    })
  })
})
