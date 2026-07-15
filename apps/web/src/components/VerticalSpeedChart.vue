<script setup lang="ts">
import { computed } from 'vue'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components'
import VChart from 'vue-echarts'
import type { Settings } from '@stravaboard/shared'
import { buildChartOptions } from '../chart/buildChartOptions'
import type { VSpeedModel } from '../chart/computeVSpeed'
import { nearestIndexByKm } from '../chart/cursor'

use([
  CanvasRenderer,
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
])

const props = defineProps<{
  model: VSpeedModel
  settings: Settings
}>()

const emit = defineEmits<{
  /** Stream index under the chart cursor, null when the pointer leaves. */
  hoverIndex: [index: number | null]
}>()

const options = computed(() => buildChartOptions(props.model, props.settings))

interface AxisPointerEvent {
  axesInfo?: { axisDim: string; value: number }[]
}

function onAxisPointer(event: AxisPointerEvent): void {
  const km = event.axesInfo?.find((a) => a.axisDim === 'x')?.value
  if (km === undefined) return
  emit('hoverIndex', nearestIndexByKm(props.model.streams.distance, km))
}

function onGlobalOut(): void {
  emit('hoverIndex', null)
}
</script>

<template>
  <VChart
    class="chart"
    :option="options"
    autoresize
    @updateaxispointer="onAxisPointer"
    @globalout="onGlobalOut"
  />
</template>

<style scoped>
.chart {
  width: 100%;
  height: 100%;
  min-height: 320px;
}
</style>
