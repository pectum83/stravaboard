/**
 * Index of the stream sample nearest to `km` along the distance stream
 * (meters, non-decreasing), or null for an empty stream. Binary search.
 */
export function nearestIndexByKm(distance: readonly number[], km: number): number | null {
  const n = distance.length
  if (n === 0) return null
  const target = km * 1000
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (distance[mid]! < target) lo = mid + 1
    else hi = mid
  }
  // lo is the first index >= target; its predecessor may be closer.
  if (lo > 0 && target - distance[lo - 1]! < distance[lo]! - target) return lo - 1
  return lo
}
