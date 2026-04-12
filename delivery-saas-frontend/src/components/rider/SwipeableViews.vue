<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';

const router = useRouter();
const route = useRoute();
const container = ref(null);

// Ordered rider screens for swipe navigation
const screens = ['/rider/orders', '/rider/checkin', '/rider/ranking', '/rider/account'];

let startX = 0;
let startY = 0;
let swiping = false;

function currentIndex() {
  return screens.findIndex(s => route.path === s || route.path.startsWith(s + '/'));
}

function onTouchStart(e) {
  startX = e.touches[0].clientX;
  startY = e.touches[0].clientY;
  swiping = false;
}

function onTouchMove(e) {
  if (swiping) return;
  const dx = e.touches[0].clientX - startX;
  const dy = e.touches[0].clientY - startY;
  // Only trigger on dominant horizontal movement (>30px horizontal, ratio >2:1)
  if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy) * 2) {
    swiping = true;
    const idx = currentIndex();
    if (idx < 0) return;
    if (dx < -30 && idx < screens.length - 1) {
      router.push(screens[idx + 1]);
    } else if (dx > 30 && idx > 0) {
      router.push(screens[idx - 1]);
    }
  }
}

function onTouchEnd() {
  swiping = false;
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
  <div ref="container" class="swipeable-views">
    <!-- Dot indicators -->
    <div class="swipe-dots">
      <span
        v-for="(s, i) in screens"
        :key="s"
        class="swipe-dot"
        :class="{ active: currentIndex() === i }"
      ></span>
    </div>
    <slot />
  </div>
</template>

<style scoped>
.swipeable-views {
  position: relative;
  min-height: 100%;
}
.swipe-dots {
  display: flex;
  justify-content: center;
  gap: 6px;
  padding: 8px 0 4px;
  position: sticky;
  top: var(--rider-header-height, 56px);
  z-index: 10;
}
.swipe-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--rider-text-muted, #adb5bd);
  transition: all 0.2s ease;
}
.swipe-dot.active {
  width: 20px;
  border-radius: 3px;
  background: var(--rider-primary, #198754);
}
</style>
