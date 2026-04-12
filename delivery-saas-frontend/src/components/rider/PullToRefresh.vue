<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

const emit = defineEmits(['refresh']);
const props = defineProps({
  loading: { type: Boolean, default: false },
  threshold: { type: Number, default: 80 },
});

const pullDistance = ref(0);
const pulling = ref(false);
const container = ref(null);
let startY = 0;
let isDragging = false;

function onTouchStart(e) {
  // Only enable pull if scrolled to top
  const el = container.value;
  if (!el || el.scrollTop > 5) return;
  startY = e.touches[0].clientY;
  isDragging = true;
}

function onTouchMove(e) {
  if (!isDragging || props.loading) return;
  const diff = e.touches[0].clientY - startY;
  if (diff < 0) { pullDistance.value = 0; return; }
  // Resist pull (diminishing returns)
  pullDistance.value = Math.min(diff * 0.4, 120);
  if (pullDistance.value > 10) pulling.value = true;
}

function onTouchEnd() {
  if (!isDragging) return;
  isDragging = false;
  if (pullDistance.value >= props.threshold * 0.4) {
    emit('refresh');
  }
  pullDistance.value = 0;
  pulling.value = false;
}

onMounted(() => {
  const el = container.value;
  if (el) {
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
  }
});
onUnmounted(() => {
  const el = container.value;
  if (el) {
    el.removeEventListener('touchstart', onTouchStart);
    el.removeEventListener('touchmove', onTouchMove);
    el.removeEventListener('touchend', onTouchEnd);
  }
});
</script>

<template>
  <div ref="container" class="ptr-container">
    <div class="ptr-indicator" :style="{ height: (pulling || loading) ? Math.max(pullDistance, loading ? 48 : 0) + 'px' : '0px' }">
      <div v-if="loading" class="ptr-spinner">
        <div class="spinner-border spinner-border-sm text-success" role="status"></div>
      </div>
      <div v-else-if="pulling" class="ptr-arrow" :style="{ transform: pullDistance > 40 ? 'rotate(180deg)' : '' }">
        <i class="bi bi-arrow-down"></i>
      </div>
    </div>
    <slot />
  </div>
</template>

<style scoped>
.ptr-container { position: relative; overflow-y: auto; }
.ptr-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  transition: height 0.2s ease;
}
.ptr-spinner { padding: 12px 0; }
.ptr-arrow {
  font-size: 1.2rem;
  color: var(--rider-primary, #198754);
  transition: transform 0.2s ease;
}
</style>
