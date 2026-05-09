<template>
  <div class="d-flex align-items-center justify-content-center" style="min-height: 70vh;">
    <div class="text-center">
      <div v-if="!error" class="spinner-border text-primary mb-3" role="status">
        <span class="visually-hidden">Carregando...</span>
      </div>
      <p v-if="!error" class="text-muted">Abrindo seu pedido...</p>
      <div v-else>
        <i class="bi bi-exclamation-triangle text-warning" style="font-size: 2.5rem;"></i>
        <p class="mt-2 mb-1 fw-semibold">{{ error }}</p>
        <p class="text-muted small">Peça um novo link pelo WhatsApp.</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from '@/api';

const route = useRoute();
const router = useRouter();
const error = ref('');

onMounted(async () => {
  const code = String(route.params.code || '').trim();
  if (!code) { error.value = 'Link inválido.'; return; }
  try {
    const { data } = await api.get(`/public/short/${encodeURIComponent(code)}`);
    if (!data?.redirectPath) {
      error.value = 'Link inválido.';
      return;
    }
    // Replace history so the back button doesn't trap the customer on this
    // intermediary page — they go from PublicMenu straight to where they came
    // from on a back press.
    router.replace(data.redirectPath);
  } catch (e) {
    const status = e?.response?.status;
    if (status === 410) error.value = 'Link expirado.';
    else if (status === 404) error.value = 'Link não encontrado.';
    else error.value = e?.response?.data?.message || 'Não foi possível abrir o link.';
  }
});
</script>
