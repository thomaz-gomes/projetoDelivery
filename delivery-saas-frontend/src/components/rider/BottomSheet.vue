<script setup>
import { ref, watch } from 'vue';

const props = defineProps({
  visible: { type: Boolean, default: false },
  title: { type: String, default: '' },
});
const emit = defineEmits(['close']);

const sheetEl = ref(null);
let startY = 0;
let currentTranslate = 0;

function onDragStart(e) {
  startY = e.touches ? e.touches[0].clientY : e.clientY;
  currentTranslate = 0;
  if (sheetEl.value) sheetEl.value.style.transition = 'none';
}

function onDragMove(e) {
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  const diff = clientY - startY;
  if (diff < 0) return; // only allow dragging down
  currentTranslate = diff;
  if (sheetEl.value) sheetEl.value.style.transform = `translateY(${diff}px)`;
}

function onDragEnd() {
  if (sheetEl.value) sheetEl.value.style.transition = '';
  if (currentTranslate > 100) {
    emit('close');
  }
  if (sheetEl.value) sheetEl.value.style.transform = '';
  currentTranslate = 0;
}
</script>

<template>
  <Teleport to="body">
    <Transition name="bs">
      <div v-if="visible" class="bs-overlay" @click.self="emit('close')">
        <div
          ref="sheetEl"
          class="bs-sheet"
          @touchstart.passive="onDragStart"
          @touchmove.passive="onDragMove"
          @touchend.passive="onDragEnd"
        >
          <div class="bs-handle"></div>
          <div v-if="title" class="bs-title">
            <span>{{ title }}</span>
            <button class="btn btn-sm btn-link text-muted p-0" @click="emit('close')">
              <i class="bi bi-x-lg"></i>
            </button>
          </div>
          <div class="bs-content">
            <slot />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.bs-overlay {
  position: fixed;
  inset: 0;
  z-index: 1060;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.bs-sheet {
  background: var(--rider-card, #fff);
  border-radius: 20px 20px 0 0;
  width: 100%;
  max-width: 540px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  transform: translateY(0);
  transition: transform 0.3s ease;
}
.bs-handle {
  width: 40px;
  height: 5px;
  border-radius: 3px;
  background: #ddd;
  margin: 10px auto 6px;
  flex-shrink: 0;
}
.bs-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 20px 12px;
  font-weight: 700;
  font-size: 1.1rem;
  border-bottom: 1px solid var(--rider-card-border, rgba(0,0,0,0.06));
}
.bs-content {
  overflow-y: auto;
  padding: 16px 20px 24px;
  flex: 1;
}

/* Transitions */
.bs-enter-active, .bs-leave-active {
  transition: opacity 0.3s ease;
}
.bs-enter-active .bs-sheet, .bs-leave-active .bs-sheet {
  transition: transform 0.3s ease;
}
.bs-enter-from, .bs-leave-to { opacity: 0; }
.bs-enter-from .bs-sheet { transform: translateY(100%); }
.bs-leave-to .bs-sheet { transform: translateY(100%); }
</style>
