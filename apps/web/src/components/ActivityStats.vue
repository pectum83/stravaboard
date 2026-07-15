<script setup lang="ts">
import type { SegmentAggregate } from '@stravaboard/shared'

defineProps<{
  ascent: SegmentAggregate
  descent: SegmentAggregate
}>()

function format(agg: SegmentAggregate): string {
  if (agg.meanVSpeed === null) return '—'
  return `${Math.round(agg.totalGainM)} m · ${Math.round(agg.meanVSpeed)} m/h`
}
</script>

<template>
  <div class="stats" aria-label="whole-activity ascent and descent means">
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
  gap: 16px;
  font-size: 0.85rem;
  color: #52514e;
  white-space: nowrap;
}

.stat {
  font-variant-numeric: tabular-nums;
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
