<script setup>
import { computed } from 'vue';

const props = defineProps({
  variant: { type: String, default: 'primary' }, // primary, secondary, outline, danger, ghost
  size: { type: String, default: 'md' },         // sm, md, lg
  loading: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  block: { type: Boolean, default: false },
  icon: { type: String, default: '' },           // emoji/char opcional
});

// Mapeia variantes para classes do Bootstrap
const variantClass = (v) => {
  switch (v) {
    case 'primary':   return 'btn btn-primary';
    case 'secondary': return 'btn btn-secondary';
    case 'outline':   return 'btn btn-outline-secondary';
    case 'danger':    return 'btn btn-danger';
    case 'ghost':     return 'btn btn-link text-secondary';
    default:          return 'btn btn-primary';
  }
};

// Mapeia tamanhos
const sizeClass = (s) => {
  switch (s) {
    case 'sm': return 'btn-sm';
    case 'lg': return 'btn-lg';
    default:   return ''; // md = default
  }
};

const baseClass = computed(() => {
  return [
    variantClass(props.variant),
    sizeClass(props.size),
    props.block ? 'w-100' : '',
  ].filter(Boolean).join(' ');
});
</script>

<template>
  <button
    :class="baseClass"
    :disabled="disabled || loading"
    :aria-disabled="disabled || loading"
    :aria-busy="loading ? 'true' : 'false'"
    type="button"
  >
    <!-- Spinner Bootstrap -->
    <span
      v-if="loading"
      class="spinner-border spinner-border-sm me-2"
      role="status"
      aria-hidden="true"
    ></span>

    <!-- Ícone simples/emoji -->
    <span v-if="icon && !loading" class="me-1">{{ icon }}</span>

    <slot />
  </button>
</template>