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
import type { ActivityStreams, Settings } from '@stravaboard/shared'
import { buildChartOptions } from '../chart/buildChartOptions'

use([
  CanvasRenderer,
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
])

const props = defineProps<{
  streams: ActivityStreams
  settings: Settings
}>()

const options = computed(() => buildChartOptions(props.streams, props.settings))
</script>

<template>
  <VChart class="chart" :option="options" autoresize />
</template>

<style scoped>
.chart {
  width: 100%;
  height: 100%;
  min-height: 320px;
}
</style>
