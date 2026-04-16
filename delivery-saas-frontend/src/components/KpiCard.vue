<template>
  <div class="card h-100 kpi-card">
    <div class="card-body d-flex flex-column">
      <div class="d-flex align-items-center gap-2 kpi-label mb-2">
        <i v-if="icon" :class="['bi', icon]"></i>
        <span>{{ label }}</span>
      </div>
      <div class="kpi-value mb-2">{{ formattedValue }}</div>
      <div class="d-flex align-items-center gap-2 flex-wrap mt-auto">
        <span v-if="delta !== null && delta !== undefined" class="small fw-semibold" :class="deltaClass">
          <i :class="['bi', deltaIcon, 'me-1']"></i>{{ formatDelta(delta) }}
        </span>
        <span v-if="statusBadge" class="badge" :class="statusBadge.cls">{{ statusBadge.label }}</span>
      </div>
      <div v-if="band && band.length === 2" class="text-muted small mt-1">
        Faixa ideal: {{ band[0] }}–{{ band[1] }}%
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  label: { type: String, required: true },
  value: { type: [Number, String], default: 0 },
  formatter: { type: String, default: 'integer' }, // 'currency' | 'percent' | 'integer'
  delta: { type: Number, default: null },
  status: { type: String, default: null }, // 'healthy' | 'warning' | 'critical'
  band: { type: Array, default: null },
  icon: { type: String, default: null },
});

const formattedValue = computed(() => {
  const v = Number(props.value) || 0;
  if (props.formatter === 'currency') {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
  }
  if (props.formatter === 'percent') {
    return `${v.toFixed(1)}%`;
  }
  return new Intl.NumberFormat('pt-BR').format(Math.round(v));
});

const deltaClass = computed(() => {
  if (props.delta == null) return '';
  return props.delta >= 0 ? 'text-success' : 'text-danger';
});

const deltaIcon = computed(() => {
  if (props.delta == null) return '';
  return props.delta >= 0 ? 'bi-arrow-up-short' : 'bi-arrow-down-short';
});

function formatDelta(d) {
  const sign = d >= 0 ? '+' : '';
  return `${sign}${d.toFixed(1)}%`;
}

const statusBadge = computed(() => {
  switch (props.status) {
    case 'healthy':
      return { cls: 'bg-success', label: 'Saudável' };
    case 'warning':
      return { cls: 'bg-warning text-dark', label: 'Atenção' };
    case 'critical':
      return { cls: 'bg-danger', label: 'Crítico' };
    default:
      return null;
  }
});
</script>

<style scoped>
.kpi-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  font-weight: 500;
  color: var(--text-muted, #6c757d);
  letter-spacing: 0.02em;
}
.kpi-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary, #212529);
  line-height: 1.2;
}
</style>
