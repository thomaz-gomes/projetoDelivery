<template>
  <span :class="indicatorClass" :title="title">
    <i :class="iconClass"></i>
    {{ label }}
  </span>
</template>

<script setup>
import { computed } from 'vue';
import { formatCurrency } from '../utils/formatters.js';

const props = defineProps({
  declared: { type: Number, default: 0 },
  expected: { type: Number, default: 0 },
});

const diff = computed(() => {
  const d = Number(props.declared || 0) - Number(props.expected || 0);
  return Math.round(d * 100) / 100;
});

const indicatorClass = computed(() => {
  if (Math.abs(diff.value) < 0.01) return 'text-success fw-semibold';
  if (diff.value > 0) return 'text-primary fw-semibold';
  return 'text-danger fw-semibold';
});

const iconClass = computed(() => {
  if (Math.abs(diff.value) < 0.01) return 'bi bi-check-circle-fill';
  if (diff.value > 0) return 'bi bi-arrow-up-circle-fill';
  return 'bi bi-arrow-down-circle-fill';
});

const label = computed(() => {
  if (Math.abs(diff.value) < 0.01) return 'Correto';
  if (diff.value > 0) return `Sobra ${formatCurrency(diff.value)}`;
  return `Quebra ${formatCurrency(Math.abs(diff.value))}`;
});

const title = computed(() => {
  return `Esperado: ${formatCurrency(props.expected)} | Declarado: ${formatCurrency(props.declared)}`;
});
</script>
