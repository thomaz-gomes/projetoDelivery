<script setup>
import { computed } from 'vue';

const props = defineProps({
  color: { type: String, default: 'secondary' }, // primary, secondary, success, danger, warning, info, light, dark
  size: { type: String, default: 'md' },         // sm, md
  title: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
});

const classes = computed(() => {
  const colors = {
    primary: 'btn btn-primary',
    secondary: 'btn btn-secondary',
    success: 'btn btn-success',
    danger: 'btn btn-danger',
    warning: 'btn btn-warning',
    info: 'btn btn-info',
    light: 'btn btn-light',
    dark: 'btn btn-dark',
  };

  const sizes = {
    sm: 'btn-sm',
    md: '',
  };

  return [
    colors[props.color] || colors.secondary,
    sizes[props.size] || '',
    'd-inline-flex align-items-center justify-content-center rounded',
  ]
    .filter(Boolean)
    .join(' ');
});
</script>

<template>
  <button
    type="button"
    :title="title"
    :disabled="disabled"
    :class="classes"
  >
    <slot />
  </button>
</template>