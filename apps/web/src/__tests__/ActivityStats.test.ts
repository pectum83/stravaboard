import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ActivityStats from '../components/ActivityStats.vue'

describe('ActivityStats', () => {
  it('shows rounded whole-activity ascent and descent means', () => {
    const wrapper = mount(ActivityStats, {
      props: {
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
        ascent: { totalGainM: 0, totalTimeS: 0, meanVSpeed: null },
        descent: { totalGainM: 0, totalTimeS: 0, meanVSpeed: null },
      },
    })
    expect(wrapper.find('.ascent').text()).toBe('↑ —')
    expect(wrapper.find('.descent').text()).toBe('↓ —')
  })
})
