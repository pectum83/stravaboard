<script setup lang="ts">
import type { SegmentAggregate } from '@stravaboard/shared'

defineProps<{
  /** Activity length, meters. */
  distanceM: number
  /** Whole-activity elapsed time (first→last sample), seconds. */
  elapsedS: number
  /** Strava moving time (elapsed minus stopped time), seconds. */
  movingTimeS: number
  /** Total excluded-pause time across the activity, seconds. */
  pausedS: number
  ascent: SegmentAggregate
  descent: SegmentAggregate
}>()

function km(m: number): string {
  return `${(m / 1000).toFixed(1)} km`
}

/** H:MM:SS once past an hour, else M:SS. */
function duration(totalS: number): string {
  const s = Math.max(0, Math.round(totalS))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

function format(agg: SegmentAggregate): string {
  if (agg.meanVSpeed === null) return '—'
  return `${Math.round(agg.totalGainM)} m · ${Math.round(agg.meanVSpeed)} m/h`
}
</script>

<template>
  <div class="stats" aria-label="whole-activity summary and ascent/descent means">
    <span class="stat distance" title="Activity length">{{ km(distanceM) }}</span>
    <span class="stat duration" title="Total duration — elapsed (moving)">
      {{ duration(elapsedS) }} <span class="muted">({{ duration(movingTimeS) }} moving)</span>
    </span>
    <span class="stat pauses" title="Total excluded pause time">⏸ {{ duration(pausedS) }}</span>
    <span class="divider" aria-hidden="true"></span>
    <span class="stat ascent" title="Total ascent · mean vertical speed (pauses excluded)">
      <span class="arrow">↑</span> {{ format(ascent) }}
    </span>
    <span class="stat descent" title="Total descent · mean vertical speed (pauses excluded)">
      <span class="arrow">↓</span> {{ format(descent) }}
    </span>
  </div>
</template>

<style scoped>
.stats {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 16px;
  font-size: 0.85rem;
  color: #52514e;
}

.stat {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.muted {
  color: #898781;
}

.divider {
  align-self: stretch;
  width: 1px;
  background: #e1e0d9;
}

.arrow {
  font-weight: 700;
}

.ascent .arrow {
  color: #008300;
}

.descent .arrow {
  color: #e87ba4;
}
</style>
