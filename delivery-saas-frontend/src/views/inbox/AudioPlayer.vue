<template>
  <div style="min-width: 200px;">
    <!-- Controls row -->
    <div class="d-flex align-items-center gap-2">
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

    <!-- Transcription row (operator-only UI — not sent to customer) -->
    <div v-if="messageId" class="mt-1 ps-1">
      <div v-if="transcribing" class="small text-muted">
        <span class="spinner-border spinner-border-sm me-1" style="width: 0.6rem; height: 0.6rem; border-width: 0.1em;"></span>Transcrevendo...
      </div>
      <div v-else-if="localTranscription" class="d-flex align-items-start gap-1">
        <small class="text-muted fst-italic" style="white-space: pre-wrap; font-size: 0.75rem; flex: 1;">{{ localTranscription }}</small>
        <button class="btn btn-sm btn-link p-0 text-muted" style="line-height: 1;" @click="copyTranscription" title="Copiar transcrição">
          <i class="bi bi-clipboard" style="font-size: 0.65rem;"></i>
        </button>
      </div>
      <button
        v-else
        class="btn btn-link p-0 text-muted"
        style="font-size: 0.7rem; text-decoration: none;"
        @click="transcribe"
      >
        <i class="bi bi-mic me-1" style="font-size: 0.7rem;"></i>Transcrever
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onUnmounted } from 'vue';
import api from '@/api';

const props = defineProps({
  src: { type: String, required: true },
  messageId: { type: String, default: null },
  transcription: { type: String, default: null },
});

const playing = ref(false);
const currentTime = ref(0);
const duration = ref(0);
const playbackRate = ref(1);
const transcribing = ref(false);
const localTranscription = ref(props.transcription || null);

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

async function transcribe() {
  if (!props.messageId || transcribing.value) return;
  transcribing.value = true;
  try {
    const { data } = await api.post(`/inbox/messages/${props.messageId}/transcribe`);
    localTranscription.value = data.transcription || '';
  } catch (e) {
    console.warn('[transcribe] failed:', e);
  } finally {
    transcribing.value = false;
  }
}

async function copyTranscription() {
  try { await navigator.clipboard.writeText(localTranscription.value || ''); } catch {}
}

onUnmounted(() => {
  if (audio) {
    audio.pause();
    audio.src = '';
    audio = null;
  }
});
</script>
