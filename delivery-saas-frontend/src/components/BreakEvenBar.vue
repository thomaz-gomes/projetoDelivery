<template>
  <div class="break-even-bar">
    <template v-if="breakEvenRevenue == null">
      <div class="alert alert-warning small mb-0">
        <i class="bi bi-exclamation-triangle me-1"></i>
        Não foi possível calcular o ponto de equilíbrio (sem dados suficientes).
      </div>
    </template>
    <template v-else>
      <div class="d-flex justify-content-between small mb-1">
        <span class="fw-semibold">Faturamento: {{ formatCurrency(currentRevenue) }}</span>
        <span class="text-muted">Break-even: {{ formatCurrency(breakEvenRevenue) }}</span>
      </div>
      <div class="progress position-relative" style="height: 22px;">
        <div
          class="progress-bar"
          :class="isAbove ? 'bg-success' : 'bg-danger'"
          role="progressbar"
          :style="{ width: fillPct + '%' }"
          :aria-valuenow="fillPct"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <span v-if="fillPct > 15" class="small">{{ fillPct.toFixed(0) }}%</span>
        </div>
        <div
          v-if="showMarker"
          class="break-even-marker"
          :style="{ left: markerLeftPct + '%' }"
          :title="`Break-even: ${formatCurrency(breakEvenRevenue)}`"
        ></div>
      </div>
      <div class="small mt-2">
        <span v-if="safetyMarginPct != null" :class="isAbove ? 'text-success' : 'text-danger'">
          <i :class="['bi', isAbove ? 'bi-check-circle' : 'bi-exclamation-circle', 'me-1']"></i>
          Margem de segurança: {{ formatDelta(safetyMarginPct) }}
        </span>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  currentRevenue: { type: Number, default: 0 },
  breakEvenRevenue: { type: Number, default: null },
  safetyMarginPct: { type: Number, default: null },
});

const isAbove = computed(() => {
  if (props.safetyMarginPct == null) return props.currentRevenue >= (props.breakEvenRevenue || 0);
  return props.safetyMarginPct >= 0;
});

// Fill % is relative to max(currentRevenue, breakEvenRevenue) — shows progress toward / past break-even.
const fillPct = computed(() => {
  const be = Number(props.breakEvenRevenue) || 0;
  const cur = Number(props.currentRevenue) || 0;
  if (be <= 0) return 0;
  const max = Math.max(cur, be);
  return Math.min(100, (cur / max) * 100);
});

// Marker position: where break-even sits on the scale (max(current, be)).
const showMarker = computed(() => {
  const be = Number(props.breakEvenRevenue) || 0;
  const cur = Number(props.currentRevenue) || 0;
  return be > 0 && cur > 0;
});

const markerLeftPct = computed(() => {
  const be = Number(props.breakEvenRevenue) || 0;
  const cur = Number(props.currentRevenue) || 0;
  const max = Math.max(cur, be);
  if (max <= 0) return 0;
  return Math.min(100, (be / max) * 100);
});

function formatCurrency(v) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);
}

function formatDelta(v) {
  const n = Number(v) || 0;
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}
</script>

<style scoped>
.break-even-marker {
  position: absolute;
  top: -4px;
  bottom: -4px;
  width: 2px;
  background-color: var(--text-primary, #212529);
  pointer-events: none;
}
.break-even-marker::after {
  content: '';
  position: absolute;
  top: -4px;
  left: -4px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: var(--text-primary, #212529);
}
</style>
