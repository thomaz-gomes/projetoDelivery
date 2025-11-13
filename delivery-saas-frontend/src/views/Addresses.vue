<script setup>
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
onMounted(() => {
  // redirect to neighborhoods settings
  router.replace('/settings/neighborhoods');
});
</script>

<template>
  <div class="p-4">
    <h2 class="h5">Endereços</h2>
    <p class="text-muted">Redirecionando para <strong>Bairros</strong>…</p>
  </div>
</template>
