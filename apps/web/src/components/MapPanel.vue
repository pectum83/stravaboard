<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  availableLayers,
  boundsOf,
  styleFor,
  terrainSource,
  toLngLat,
  traceGeoJSON,
  type MapLayerId,
} from '../map/mapStyles'

const props = defineProps<{
  /** GPS track ([lat, lng] pairs) of the selected activity, if any. */
  latlng: [number, number][] | null
  /** Stream index hovered on the chart; moves the map cursor. */
  hoverIndex: number | null
  maptilerKey: string | null
}>()

const container = ref<HTMLElement | null>(null)
/** WebGL init can fail (old GPU, headless CI); the panel degrades to text. */
const failed = ref(false)
// Open on the topo (contour) map when a key unlocks it; plain OSM otherwise.
const layer = ref<MapLayerId>(props.maptilerKey ? 'topo' : 'streets')
const layers = computed(() => availableLayers(props.maptilerKey))

let map: maplibregl.Map | null = null
let marker: maplibregl.Marker | null = null
let markerShown = false

const TRACE_SOURCE = 'trace'

onMounted(() => {
  if (!container.value) return
  try {
    map = new maplibregl.Map({
      container: container.value,
      style: styleFor(layer.value, props.maptilerKey),
      attributionControl: { compact: true },
    })
    map.on('error', () => {
      // Style/tile fetch errors are non-fatal (fallback tiles still render);
      // only a missing canvas means the map never came up.
      if (!map?.getCanvas()) failed.value = true
    })
    // Overlays live on top of the style, so every style switch re-adds them.
    map.on('style.load', applyOverlays)
    marker = new maplibregl.Marker({ color: '#2a78d6' })
    fitTrace()
  } catch {
    failed.value = true
  }
})

onBeforeUnmount(() => {
  map?.remove()
  map = null
})

function selectLayer(next: MapLayerId): void {
  if (!map || layer.value === next) return
  layer.value = next
  map.setStyle(styleFor(next, props.maptilerKey))
  // applyOverlays runs on the following style.load and restores terrain/trace.
}

function applyOverlays(): void {
  if (!map) return
  if (props.maptilerKey !== null && layer.value === 'terrain') {
    if (!map.getSource('terrain-dem'))
      map.addSource('terrain-dem', terrainSource(props.maptilerKey))
    map.setTerrain({ source: 'terrain-dem', exaggeration: 1.2 })
    map.setPitch(60)
  } else {
    map.setTerrain(null)
    map.setPitch(0)
  }
  if (props.latlng !== null && !map.getSource(TRACE_SOURCE)) {
    map.addSource(TRACE_SOURCE, { type: 'geojson', data: traceGeoJSON(props.latlng) })
    map.addLayer({
      id: TRACE_SOURCE,
      type: 'line',
      source: TRACE_SOURCE,
      paint: { 'line-color': '#fc5200', 'line-width': 3 },
    })
  }
}

function fitTrace(): void {
  if (!map || props.latlng === null || props.latlng.length === 0) return
  map.fitBounds(boundsOf(props.latlng), { padding: 24, animate: false })
}

watch(
  () => props.latlng,
  (latlng) => {
    if (!map) return
    const source = map.getSource(TRACE_SOURCE) as maplibregl.GeoJSONSource | undefined
    if (latlng !== null && source) source.setData(traceGeoJSON(latlng))
    else if (latlng !== null) applyOverlays()
    fitTrace()
  },
)

watch(
  () => props.hoverIndex,
  (index) => {
    if (!map || !marker) return
    const point = index !== null ? props.latlng?.[index] : undefined
    if (point === undefined) {
      if (markerShown) marker.remove()
      markerShown = false
      return
    }
    marker.setLngLat(toLngLat(point))
    if (!markerShown) marker.addTo(map)
    markerShown = true
  },
)
</script>

<template>
  <div class="map-panel">
    <p v-if="latlng === null" class="map-fallback">No GPS trace for this activity.</p>
    <p v-else-if="failed" class="map-fallback">Map unavailable (WebGL is required).</p>
    <template v-else>
      <div ref="container" class="map-container" data-testid="map-container" />
      <div
        v-if="layers.length > 1 && !failed"
        class="layer-switch"
        role="radiogroup"
        aria-label="map layer"
      >
        <button
          v-for="id in layers"
          :key="id"
          type="button"
          role="radio"
          :aria-checked="layer === id"
          :class="{ active: layer === id }"
          @click="selectLayer(id)"
        >
          {{ id }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.map-panel {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
}

.map-container {
  flex: 1;
  min-height: 320px;
  border-radius: 6px;
}

.map-fallback {
  margin: auto;
  color: #898781;
}

.layer-switch {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 1;
  display: flex;
  gap: 4px;
}

.layer-switch button {
  padding: 4px 10px;
  border: 1px solid #c3c2b7;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  font: inherit;
  font-size: 0.75rem;
  color: #52514e;
  cursor: pointer;
}

.layer-switch button.active {
  background: #2a78d6;
  border-color: #2a78d6;
  color: white;
}
</style>
