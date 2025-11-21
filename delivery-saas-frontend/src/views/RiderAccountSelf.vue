<script setup>
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const auth = useAuthStore();

onMounted(() => {
  const riderId = auth.user?.riderId;
  if (!riderId) {
    router.replace('/');
  } else {
    router.replace(`/riders/${riderId}/account`);
  }
});
</script>

<template>
  <div class="p-3 text-center">Redirecionando...</div>
</template>
