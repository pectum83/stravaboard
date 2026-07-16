import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import MapPanel from '../components/MapPanel.vue'

const mocks = vi.hoisted(() => {
  const state = {
    maps: [] as MockMap[],
    markers: [] as MockMarker[],
    throwOnConstruct: false,
  }

  class MockMap {
    handlers: Record<string, (() => void)[]> = {}
    setStyle = vi.fn()
    addSource = vi.fn()
    getSource = vi.fn(() => undefined)
    addLayer = vi.fn()
    setTerrain = vi.fn()
    setPitch = vi.fn()
    fitBounds = vi.fn()
    getCanvas = vi.fn(() => ({}))
    remove = vi.fn()

    constructor(readonly options: unknown) {
      if (state.throwOnConstruct) throw new Error('no WebGL')
      state.maps.push(this)
    }

    on(event: string, handler: () => void): void {
      ;(this.handlers[event] ??= []).push(handler)
    }

    fire(event: string): void {
      for (const handler of this.handlers[event] ?? []) handler()
    }
  }

  class MockMarker {
    setLngLat = vi.fn().mockReturnThis()
    addTo = vi.fn().mockReturnThis()
    remove = vi.fn()

    constructor() {
      state.markers.push(this)
    }
  }

  return { state, MockMap, MockMarker }
})

vi.mock('maplibre-gl', () => ({
  default: { Map: mocks.MockMap, Marker: mocks.MockMarker },
}))

const TRACK: [number, number][] = [
  [45.1, 6.05],
  [45.2, 6.06],
  [45.3, 6.07],
]

function mountPanel(props = {}) {
  return mount(MapPanel, {
    props: { latlng: TRACK, hoverIndex: null, maptilerKey: 'k-1', ...props },
  })
}

describe('MapPanel', () => {
  beforeEach(() => {
    mocks.state.maps = []
    mocks.state.markers = []
    mocks.state.throwOnConstruct = false
  })

  it('shows a placeholder instead of a map when the activity has no GPS', () => {
    const wrapper = mountPanel({ latlng: null })
    expect(wrapper.text()).toContain('No GPS trace')
    expect(mocks.state.maps).toHaveLength(0)
  })

  it('degrades to a fallback message when map creation fails', async () => {
    mocks.state.throwOnConstruct = true
    const wrapper = mountPanel()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Map unavailable')
  })

  it('fits the trace bounds on mount and draws the trace on style load', () => {
    mountPanel()
    const map = mocks.state.maps[0]!
    expect(map.fitBounds).toHaveBeenCalledWith(
      [
        [6.05, 45.1],
        [6.07, 45.3],
      ],
      { padding: 24, animate: false },
    )
    map.fire('style.load')
    expect(map.addSource).toHaveBeenCalledWith(
      'trace',
      expect.objectContaining({ type: 'geojson' }),
    )
    expect(map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'trace', type: 'line' }),
    )
  })

  it('moves the marker to the hovered point with swapped coordinates', async () => {
    const wrapper = mountPanel()
    const marker = mocks.state.markers[0]!

    await wrapper.setProps({ hoverIndex: 1 })
    expect(marker.setLngLat).toHaveBeenCalledWith([6.06, 45.2])
    expect(marker.addTo).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ hoverIndex: null })
    expect(marker.remove).toHaveBeenCalledTimes(1)
  })

  it('offers layer pills with a key and switches styles', async () => {
    const wrapper = mountPanel()
    const pills = wrapper.findAll('.layer-switch button')
    expect(pills.map((p) => p.text())).toEqual(['streets', 'satellite', 'terrain'])

    await pills[1]!.trigger('click')
    const map = mocks.state.maps[0]!
    expect(map.setStyle).toHaveBeenCalledWith(
      'https://api.maptiler.com/maps/hybrid/style.json?key=k-1',
    )
  })

  it('enables 3D terrain when the terrain layer loads', async () => {
    const wrapper = mountPanel()
    const map = mocks.state.maps[0]!
    await wrapper.findAll('.layer-switch button')[2]!.trigger('click')
    map.fire('style.load')
    expect(map.addSource).toHaveBeenCalledWith(
      'terrain-dem',
      expect.objectContaining({ type: 'raster-dem' }),
    )
    expect(map.setTerrain).toHaveBeenCalledWith({ source: 'terrain-dem', exaggeration: 1.2 })
    expect(map.setPitch).toHaveBeenCalledWith(60)
  })

  it('hides the layer switch without a key', () => {
    const wrapper = mountPanel({ maptilerKey: null })
    expect(wrapper.find('.layer-switch').exists()).toBe(false)
  })
})
