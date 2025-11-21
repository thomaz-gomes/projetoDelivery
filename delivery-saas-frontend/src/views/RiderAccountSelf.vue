<script setup>
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import api from '../api';

const router = useRouter();
const auth = useAuthStore();

onMounted(async () => {
  // Ensure auth.user is populated if token exists, then redirect rider-users to their rider view
  try {
    if (!auth.user && auth.token) {
      try {
        const { data } = await api.get('/auth/me');
        if (data && data.user) auth.user = data.user;
      } catch (e) {
        console.warn('RiderAccountSelf: failed to fetch /auth/me', e?.message || e);
      }
    }
    const riderId = auth.user?.riderId;
    if (!riderId) {
      router.replace('/');
    } else {
      // redirect riders to the rider-specific route
      router.replace('/rider/account');
    }
  } catch (err) {
    console.error('RiderAccountSelf redirect error', err);
    router.replace('/');
  }
});
</script>

<template>
  <div class="p-3 text-center">Redirecionando...</div>
</template>
