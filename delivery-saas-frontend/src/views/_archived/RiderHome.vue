<script setup>
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();

// Archived copy of RiderHome.vue — moved here for cleanup. Original logic was migrated to RiderQrCode.vue
onMounted(()=>{
  try{ router.replace('/rider/home') }catch(e){ console.warn('redirect to /rider/home failed', e) }
});
</script>

<template>
  <div style="display:flex;align-items:center;justify-content:center;padding:48px">Arquivo arquivado: RiderHome.vue</div>
</template>

<style scoped>
div { color: #333 }
</style>
