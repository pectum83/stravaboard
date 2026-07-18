import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ActivityStats from '../components/ActivityStats.vue'

/** Whole-activity summary props (distance/duration/pauses) with sensible defaults. */
const summary = { distanceM: 12_340, elapsedS: 3945, movingTimeS: 3600, pausedS: 345 }

describe('ActivityStats', () => {
  it('shows rounded whole-activity ascent and descent means', () => {
    const wrapper = mount(ActivityStats, {
      props: {
        ...summary,
        ascent: { totalGainM: 650.4, totalTimeS: 3825, meanVSpeed: 612.1 },
        descent: { totalGainM: -640.2, totalTimeS: 2590, meanVSpeed: -889.8 },
      },
    })
    expect(wrapper.find('.ascent').text()).toBe('↑ 650 m · 612 m/h')
    expect(wrapper.find('.descent').text()).toBe('↓ -640 m · -890 m/h')
  })

  it('shows an em dash when there is no segment', () => {
    const wrapper = mount(ActivityStats, {
      props: {
        ...summary,
        ascent: { totalGainM: 0, totalTimeS: 0, meanVSpeed: null },
        descent: { totalGainM: 0, totalTimeS: 0, meanVSpeed: null },
      },
    })
    expect(wrapper.find('.ascent').text()).toBe('↑ —')
    expect(wrapper.find('.descent').text()).toBe('↓ —')
  })

  it('shows length, elapsed + moving duration and total (excluded) pause time', () => {
    const wrapper = mount(ActivityStats, {
      props: {
        distanceM: 12_340,
        elapsedS: 3945, // 1:05:45
        movingTimeS: 3600, // 1:00:00
        pausedS: 345, // 5:45
        ascent: { totalGainM: 0, totalTimeS: 0, meanVSpeed: null },
        descent: { totalGainM: 0, totalTimeS: 0, meanVSpeed: null },
      },
    })
    expect(wrapper.find('.distance').text()).toBe('12.3 km')
    expect(wrapper.find('.duration').text()).toBe('1:05:45 (1:00:00 moving)')
    expect(wrapper.find('.pauses').text()).toBe('⏸ 5:45')
  })
})
