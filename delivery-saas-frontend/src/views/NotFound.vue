<template>
  <div class="not-found-page d-flex align-items-center justify-content-center">
    <div class="text-center">
      <div class="not-found-code">404</div>
      <h4 class="mb-2">Pagina nao encontrada</h4>
      <p class="text-secondary mb-4">
        A pagina que voce esta procurando nao existe ou foi movida.
      </p>
      <BaseButton variant="primary" @click="goBack">
        <i class="bi-arrow-left me-1"></i> Voltar
      </BaseButton>
    </div>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import BaseButton from '../components/BaseButton.vue'

const router = useRouter()

function goBack() {
  const token = localStorage.getItem('token')
  if (token) {
    router.push('/orders')
  } else {
    router.push('/login')
  }
}
</script>

<style scoped>
.not-found-page {
  min-height: 80vh;
}
.not-found-code {
  font-size: 6rem;
  font-weight: 700;
  color: var(--primary);
  line-height: 1;
  margin-bottom: 0.5rem;
}
</style>
