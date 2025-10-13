<script setup>
import QRCode from 'qrcode';
import { ref, watch } from 'vue';

const props = defineProps({ url: String, open: Boolean });
const emit = defineEmits(['close']);
const dataUrl = ref('');

watch(() => props.url, async (u) => {
  dataUrl.value = u ? await QRCode.toDataURL(u, { width: 260, margin: 2 }) : '';
});
</script>

<template>
  <div v-if="open" class="overlay">
    <div class="modal">
      <h3>Comanda (QR Code)</h3>
      <img v-if="dataUrl" :src="dataUrl" alt="QR" />
      <p class="small">{{ url }}</p>
      <button @click="$emit('close')">Fechar</button>
    </div>
  </div>
</template>

<style scoped>
.overlay { position:fixed; inset:0; background:rgba(0,0,0,.4); display:flex; align-items:center; justify-content:center; }
.modal { background:#fff; padding:16px; border-radius:8px; width:320px; text-align:center; }
.small { font-size:11px; word-break:break-all; color:#666; }
button { margin-top:10px; }
</style>