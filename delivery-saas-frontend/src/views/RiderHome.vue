<script setup>
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();

// Minimal shim: redirect to the new Rider QR view so this file is harmless if still referenced.
onMounted(()=>{
  try{ router.replace('/rider/orders') }catch(e){ console.warn('redirect to /rider/orders failed', e) }
});
</script>

<template>
  <div style="display:flex;align-items:center;justify-content:center;padding:48px">Redirecionando para o leitor de QR...</div>
</template>

<style scoped>
div { color: #333 }
</style>
