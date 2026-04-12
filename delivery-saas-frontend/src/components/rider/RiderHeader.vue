<script setup>
import { computed } from 'vue';
import { useAuthStore } from '../../stores/auth';

const props = defineProps({
  gpsStatus: { type: String, default: '' },
});

const auth = useAuthStore();

const initials = computed(() => {
  const name = auth.user?.name || auth.user?.fullName || auth.user?.email || '';
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
});

const gpsLabel = computed(() => {
  const map = { ok: 'GPS OK', sending: 'Enviando...', stale: 'Reconectando', error: 'Erro GPS' };
  return map[props.gpsStatus] || '';
});

const gpsDotClass = computed(() => {
  if (!props.gpsStatus) return '';
  const map = { ok: 'ok', sending: 'ok pulse', stale: 'warning pulse', error: 'error' };
  return map[props.gpsStatus] || '';
});
</script>

<template>
  <header class="rider-header">
    <div class="rider-header__left">
      <span v-if="gpsStatus" class="status-dot" :class="gpsDotClass"></span>
      <span v-if="gpsLabel" class="rider-header__gps-text">{{ gpsLabel }}</span>
    </div>
    <div class="rider-header__center">
      Core Delivery
    </div>
    <div class="rider-header__right">
      <div class="rider-header__avatar">{{ initials }}</div>
    </div>
  </header>
</template>

<style scoped>
.rider-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: var(--rider-header-height, 56px);
  background: var(--rider-primary, #198754);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  z-index: 1040;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
}
.rider-header__left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 80px;
}
.rider-header__gps-text {
  font-size: 0.7rem;
  font-weight: 500;
  opacity: 0.9;
}
.rider-header__center {
  font-weight: 700;
  font-size: 1rem;
  letter-spacing: 0.02em;
}
.rider-header__right {
  display: flex;
  align-items: center;
  min-width: 80px;
  justify-content: flex-end;
}
.rider-header__avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: rgba(255,255,255,0.95);
  color: #198754;
  font-weight: 700;
  font-size: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Status dot styles (mirrors rider-theme.css) */
.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}
.status-dot.ok { background: #4caf50; }
.status-dot.warning { background: #ff9800; }
.status-dot.error { background: #f44336; }
.status-dot.pulse {
  animation: pulse-dot 1.5s ease-in-out infinite;
}
@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.3); }
}
</style>
