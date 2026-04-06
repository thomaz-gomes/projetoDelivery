<template>
  <div class="d-flex align-items-center gap-2" style="min-width: 200px;">
    <!-- Play / Pause -->
    <button class="btn btn-sm p-0 border-0" @click="togglePlay">
      <i
        class="bi"
        :class="playing ? 'bi-pause-circle-fill' : 'bi-play-circle-fill'"
        style="font-size: 1.6rem; color: var(--bs-success);"
      ></i>
    </button>

    <!-- Progress slider -->
    <input
      type="range"
      class="form-range flex-grow-1"
      min="0"
      :max="duration || 0"
      step="0.1"
      :value="currentTime"
      @input="seek"
      style="height: 4px;"
    />

    <!-- Time display -->
    <small class="text-muted" style="font-size: 0.75rem; white-space: nowrap;">
      {{ formatTime(currentTime) }} / {{ formatTime(duration) }}
    </small>

    <!-- Speed button -->
    <button
      class="btn btn-sm btn-outline-secondary py-0 px-1"
      style="font-size: 0.7rem; line-height: 1.2;"
      @click="cycleSpeed"
    >
      {{ playbackRate }}x
    </button>
  </div>
</template>

<script setup>
import { ref, onUnmounted } from 'vue';

const props = defineProps({
  src: { type: String, required: true },
});

const playing = ref(false);
const currentTime = ref(0);
const duration = ref(0);
const playbackRate = ref(1);

let audio = null;

function getAudio() {
  if (!audio) {
    audio = new Audio(props.src);
    audio.addEventListener('loadedmetadata', () => {
      duration.value = audio.duration || 0;
    });
    audio.addEventListener('timeupdate', () => {
      currentTime.value = audio.currentTime || 0;
    });
    audio.addEventListener('ended', () => {
      playing.value = false;
      currentTime.value = 0;
    });
  }
  return audio;
}

function togglePlay() {
  const a = getAudio();
  if (playing.value) {
    a.pause();
    playing.value = false;
  } else {
    a.playbackRate = playbackRate.value;
    a.play().catch(() => {});
    playing.value = true;
  }
}

function seek(e) {
  const a = getAudio();
  a.currentTime = parseFloat(e.target.value);
  currentTime.value = a.currentTime;
}

function cycleSpeed() {
  const speeds = [1, 1.5, 2];
  const idx = speeds.indexOf(playbackRate.value);
  playbackRate.value = speeds[(idx + 1) % speeds.length];
  if (audio) audio.playbackRate = playbackRate.value;
}

function formatTime(secs) {
  if (!secs || isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return m + ':' + String(s).padStart(2, '0');
}

onUnmounted(() => {
  if (audio) {
    audio.pause();
    audio.src = '';
    audio = null;
  }
});
</script>
