<script setup>
import { computed } from 'vue';
import { useAuthStore } from '../stores/auth';
import RiderAccountRider from './RiderAccountRider.vue';
import RiderAccountAdmin from './RiderAccountAdmin.vue';

const auth = useAuthStore();

const isRider = computed(() => {
  const role = auth.user?.role;
  if (!role && auth.user?.riderId) return true;
  return String(role || '').toUpperCase() === 'RIDER';
});
</script>

<template>
  <component :is="isRider ? RiderAccountRider : RiderAccountAdmin" />
</template>

<style scoped>
/* wrapper has no styles; children provide their own */
</style>
