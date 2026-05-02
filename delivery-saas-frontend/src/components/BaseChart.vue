<template>
  <div :style="{ position: 'relative', height: height }">
    <canvas ref="canvasRef"></canvas>
  </div>
</template>

<script setup>
import { ref, watch, onUnmounted, nextTick } from 'vue'
import Chart from 'chart.js/auto'

const props = defineProps({
  type: { type: String, required: true },
  data: { type: Object, required: true },
  options: { type: Object, default: () => ({}) },
  height: { type: String, default: '280px' },
})

const canvasRef = ref(null)
let chart = null
let destroyed = false

function mergeOptions(base, override) {
  const result = { ...base }
  for (const key of Object.keys(override)) {
    if (override[key] && typeof override[key] === 'object' && !Array.isArray(override[key])) {
      result[key] = mergeOptions(base[key] || {}, override[key])
    } else {
      result[key] = override[key]
    }
  }
  return result
}

async function renderChart() {
  await nextTick()
  if (destroyed || !canvasRef.value) return
  if (chart) { chart.destroy(); chart = null }
  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom' } },
  }
  chart = new Chart(canvasRef.value, {
    type: props.type,
    data: {
      ...props.data,
      datasets: props.data.datasets.map(d => ({
        ...d,
        data: d.data ? [...d.data] : [],
        backgroundColor: Array.isArray(d.backgroundColor) ? [...d.backgroundColor] : d.backgroundColor,
        borderColor: Array.isArray(d.borderColor) ? [...d.borderColor] : d.borderColor,
      })),
    },
    options: mergeOptions(baseOptions, props.options),
  })
}

watch(() => [props.data, props.type, props.options], renderChart, { deep: true, immediate: true })

onUnmounted(() => {
  destroyed = true
  if (chart) chart.destroy()
})
</script>
