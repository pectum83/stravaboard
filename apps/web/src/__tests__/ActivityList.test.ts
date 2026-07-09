import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { ActivitySummary } from '@stravaboard/shared'
import ActivityList from '../components/ActivityList.vue'

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
    ...overrides,
  }
}

describe('ActivityList', () => {
  it('renders name, distance and elevation gain', () => {
    const wrapper = mount(ActivityList, {
      props: { activities: [activity(1)], selectedId: null, hasMore: false, loading: false },
    })
    expect(wrapper.text()).toContain('Trail 1')
    expect(wrapper.text()).toContain('12.3 km')
    expect(wrapper.text()).toContain('D+ 850 m')
  })

  it('emits select with the activity id on click', async () => {
    const wrapper = mount(ActivityList, {
      props: { activities: [activity(7)], selectedId: null, hasMore: false, loading: false },
    })
    await wrapper.find('button.item').trigger('click')
    expect(wrapper.emitted('select')).toEqual([[7]])
  })

  it('marks the selected activity and greys activities without streams', () => {
    const wrapper = mount(ActivityList, {
      props: {
        activities: [activity(1), activity(2, { streamsStatus: 'none' })],
        selectedId: 1,
        hasMore: false,
        loading: false,
      },
    })
    const items = wrapper.findAll('button.item')
    expect(items[0]!.classes()).toContain('selected')
    expect(items[1]!.classes()).toContain('no-streams')
    expect(items[1]!.text()).toContain('no elevation data')
  })

  it('shows a load-more button only when more pages exist', async () => {
    const withMore = mount(ActivityList, {
      props: { activities: [activity(1)], selectedId: null, hasMore: true, loading: false },
    })
    await withMore.find('button.load-more').trigger('click')
    expect(withMore.emitted('loadMore')).toHaveLength(1)

    const lastPage = mount(ActivityList, {
      props: { activities: [activity(1)], selectedId: null, hasMore: false, loading: false },
    })
    expect(lastPage.find('button.load-more').exists()).toBe(false)
  })

  it('shows an empty state without activities', () => {
    const wrapper = mount(ActivityList, {
      props: { activities: [], selectedId: null, hasMore: false, loading: false },
    })
    expect(wrapper.text()).toContain('No activities yet.')
  })
})
