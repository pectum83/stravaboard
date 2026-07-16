import type {
  LngLatBoundsLike,
  RasterDEMSourceSpecification,
  StyleSpecification,
} from 'maplibre-gl'
import type { Feature } from 'geojson'

export type MapLayerId = 'streets' | 'satellite' | 'terrain'

const MAPTILER_BASE = 'https://api.maptiler.com'

/** Layers offered for the current key; without one only plain OSM works. */
export function availableLayers(key: string | null): MapLayerId[] {
  return key === null ? ['streets'] : ['streets', 'satellite', 'terrain']
}

/**
 * MapLibre style for a layer. With a MapTiler key, hosted styles; without,
 * an inline raster style over the public OSM tile server. The terrain layer
 * reuses the streets style — the 3D relief comes from `terrainSource`.
 */
export function styleFor(layer: MapLayerId, key: string | null): string | StyleSpecification {
  if (key === null) return osmRasterStyle()
  const styleId = layer === 'satellite' ? 'hybrid' : 'streets-v2'
  return `${MAPTILER_BASE}/maps/${styleId}/style.json?key=${key}`
}

/** Raster-DEM source powering the 3D terrain layer. */
export function terrainSource(key: string): RasterDEMSourceSpecification {
  return {
    type: 'raster-dem',
    url: `${MAPTILER_BASE}/tiles/terrain-rgb-v2/tiles.json?key=${key}`,
    tileSize: 256,
  }
}

function osmRasterStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  }
}

/** Strava streams are [lat, lng]; MapLibre wants [lng, lat]. */
export function toLngLat(point: readonly [number, number]): [number, number] {
  return [point[1], point[0]]
}

export function boundsOf(latlng: readonly (readonly [number, number])[]): LngLatBoundsLike {
  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  for (const [lat, lng] of latlng) {
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ]
}

export function traceGeoJSON(latlng: readonly (readonly [number, number])[]): Feature {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: latlng.map(toLngLat),
    },
  }
}
