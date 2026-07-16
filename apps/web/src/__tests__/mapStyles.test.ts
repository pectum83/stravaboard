import { describe, expect, it } from 'vitest'
import {
  availableLayers,
  boundsOf,
  styleFor,
  terrainSource,
  toLngLat,
  traceGeoJSON,
} from '../map/mapStyles'

describe('availableLayers', () => {
  it('offers satellite and 3D terrain only with a MapTiler key', () => {
    expect(availableLayers('k')).toEqual(['streets', 'satellite', 'terrain'])
    expect(availableLayers(null)).toEqual(['streets'])
  })
})

describe('styleFor', () => {
  it('builds MapTiler style URLs with the key', () => {
    expect(styleFor('streets', 'k-1')).toBe(
      'https://api.maptiler.com/maps/streets-v2/style.json?key=k-1',
    )
    expect(styleFor('satellite', 'k-1')).toBe(
      'https://api.maptiler.com/maps/hybrid/style.json?key=k-1',
    )
    // Terrain reuses the streets style; relief comes from the DEM source.
    expect(styleFor('terrain', 'k-1')).toBe(styleFor('streets', 'k-1'))
  })

  it('falls back to an inline OSM raster style without a key', () => {
    const style = styleFor('streets', null)
    expect(style).toMatchObject({ version: 8 })
    expect(JSON.stringify(style)).toContain('tile.openstreetmap.org')
  })
})

describe('terrainSource', () => {
  it('is a raster-dem source keyed for MapTiler', () => {
    expect(terrainSource('k-1')).toEqual({
      type: 'raster-dem',
      url: 'https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=k-1',
      tileSize: 256,
    })
  })
})

describe('coordinate helpers', () => {
  it('swaps Strava [lat, lng] to MapLibre [lng, lat]', () => {
    expect(toLngLat([45.1, 6.05])).toEqual([6.05, 45.1])
  })

  it('computes the bounding box of a track', () => {
    expect(
      boundsOf([
        [45.1, 6.05],
        [45.3, 6.01],
        [45.2, 6.2],
      ]),
    ).toEqual([
      [6.01, 45.1],
      [6.2, 45.3],
    ])
  })

  it('builds a LineString with swapped coordinates', () => {
    const feature = traceGeoJSON([
      [45.1, 6.05],
      [45.2, 6.06],
    ])
    expect(feature.geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [6.05, 45.1],
        [6.06, 45.2],
      ],
    })
  })
})
