import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ActivityFilters from '../components/ActivityFilters.vue'
import { EMPTY_FILTERS } from '../stores/activities'

function mountFilters(overrides = {}) {
  return mount(ActivityFilters, {
    props: {
      filters: { ...EMPTY_FILTERS, ...overrides },
      sportTypes: ['Run', 'TrailRun'],
    },
  })
}

describe('ActivityFilters', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces search text before emitting one update', async () => {
    const wrapper = mountFilters()
    const search = wrapper.find('input[type="search"]')
    await search.setValue('moun')
    await search.setValue('mountain')
    expect(wrapper.emitted('update')).toBeUndefined()

    vi.advanceTimersByTime(400)
    expect(wrapper.emitted('update')).toEqual([[{ q: 'mountain' }]])
  })

  it('emits date changes immediately', async () => {
    const wrapper = mountFilters()
    await wrapper.find('input[aria-label="from date"]').setValue('2026-06-12')
    expect(wrapper.emitted('update')).toEqual([[{ from: '2026-06-12' }]])
  })

  it('emits sport type changes immediately and lists the options', async () => {
    const wrapper = mountFilters()
    const options = wrapper.findAll('option').map((o) => o.text())
    expect(options).toEqual(['All sports', 'Run', 'TrailRun'])
    await wrapper.find('select').setValue('Run')
    expect(wrapper.emitted('update')).toEqual([[{ sportType: 'Run' }]])
  })

  it('shows Clear only when a filter is active, and resets everything', async () => {
    expect(mountFilters().find('button.clear').exists()).toBe(false)

    const wrapper = mountFilters({ q: 'mountain', sportType: 'Run' })
    await wrapper.find('button.clear').trigger('click')
    expect(wrapper.emitted('update')).toEqual([[{ q: '', from: '', to: '', sportType: '' }]])
  })
})
