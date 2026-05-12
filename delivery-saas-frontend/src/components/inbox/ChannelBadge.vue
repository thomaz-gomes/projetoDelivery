<template>
  <span
    :class="['channel-badge', `channel-badge--${variant}`]"
    :title="tooltip"
    :aria-label="tooltip"
  >
    <i :class="iconClass" aria-hidden="true"></i>
    <span class="visually-hidden">{{ tooltip }}</span>
  </span>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  channel: { type: String, required: true },   // WHATSAPP | FACEBOOK | INSTAGRAM
  provider: { type: String, default: null },   // EVOLUTION_WA | META_WA | META_FB | META_IG
});

const variant = computed(() => (props.channel || '').toLowerCase() || 'unknown');

const iconClass = computed(() => {
  switch (props.channel) {
    case 'WHATSAPP':  return 'bi bi-whatsapp';
    case 'FACEBOOK':  return 'bi bi-messenger';
    case 'INSTAGRAM': return 'bi bi-instagram';
    default:          return 'bi bi-chat-dots';
  }
});

const tooltip = computed(() => {
  switch (props.channel) {
    case 'WHATSAPP':
      if (props.provider === 'META_WA') return 'WhatsApp (Meta Cloud)';
      if (props.provider === 'EVOLUTION_WA') return 'WhatsApp (Evolution)';
      return 'WhatsApp';
    case 'FACEBOOK':  return 'Messenger';
    case 'INSTAGRAM': return 'Instagram Direct';
    default:          return props.channel || 'Canal';
  }
});
</script>

<style scoped>
.channel-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  color: #fff;
  font-size: 0.65rem;
  line-height: 1;
  flex-shrink: 0;
  vertical-align: middle;
}

.channel-badge i {
  font-size: 0.65rem;
  line-height: 1;
}

.channel-badge--whatsapp  { background-color: #25D366; }
.channel-badge--facebook  { background-color: #0084FF; }
.channel-badge--instagram {
  background: linear-gradient(135deg, #833AB4 0%, #FD1D1D 50%, #FCB045 100%);
}
.channel-badge--unknown   { background-color: var(--text-muted, #ADB5BD); }
</style>
