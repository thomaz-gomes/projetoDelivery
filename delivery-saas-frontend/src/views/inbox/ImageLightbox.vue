<template>
  <div v-if="src" class="lightbox-overlay" @click.self="$emit('close')">
    <button class="btn-close-lightbox" @click="$emit('close')">
      <i class="bi bi-x-lg"></i>
    </button>
    <img :src="src" class="lightbox-image" />
  </div>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue';

const props = defineProps({ src: String });
const emit = defineEmits(['close']);

function onKey(e) {
  if (e.key === 'Escape') emit('close');
}

onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<style scoped>
.lightbox-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}
.lightbox-image {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
}
.btn-close-lightbox {
  position: absolute;
  top: 20px;
  right: 20px;
  background: white;
  border: none;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  cursor: pointer;
}
</style>
