import { describe, expect, it } from 'vitest'
import { nearestIndexByKm } from '../chart/cursor'

describe('nearestIndexByKm', () => {
  const distance = [0, 100, 200, 300, 400] // meters

  it('finds the exact sample', () => {
    expect(nearestIndexByKm(distance, 0.2)).toBe(2)
  })

  it('rounds to the nearest sample on either side', () => {
    expect(nearestIndexByKm(distance, 0.14)).toBe(1)
    expect(nearestIndexByKm(distance, 0.16)).toBe(2)
  })

  it('clamps beyond both ends', () => {
    expect(nearestIndexByKm(distance, -1)).toBe(0)
    expect(nearestIndexByKm(distance, 99)).toBe(4)
  })

  it('returns null for an empty stream', () => {
    expect(nearestIndexByKm([], 1)).toBeNull()
  })
})
