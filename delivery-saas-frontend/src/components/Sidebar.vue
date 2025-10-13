<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

// Menu lateral
const nav = [
  { name: 'Pedidos', to: '/orders', icon: '📦' },
  { name: 'Clientes', to: '/customers', icon: '👤' },
  { name: 'Entregadores', to: '/riders', icon: '🛵' },
  { name: 'WhatsApp', to: '/settings/whatsapp', icon: '💬' },
  { name: 'Configurações', to: '/settings', icon: '⚙️' },
  { name: 'Ifood', to: '/settings/ifood', icon: '⚙️' },
];

const isActive = (to) => computed(() => route.path.startsWith(to));

function logout() {
  auth.logout();
  router.replace('/login');
}
</script>
<template>
  <aside class="d-none d-md-flex flex-column border-end bg-white" style="width: 240px; min-height: 100vh;">
    <!-- Header -->
    <div class="border-bottom p-3">
      <h5 class="mb-0">Delivery SaaS</h5>
      <small class="text-muted">Painel Administrativo</small>
    </div>

    <!-- Navegação -->
    <nav class="flex-grow-1 p-2">
      <ul class="nav flex-column">
        <li v-for="item in nav" :key="item.to" class="nav-item mb-1">
          <router-link
            :to="item.to"
            class="nav-link d-flex align-items-center px-3 py-2 rounded"
            :class="{
              active: isActive(item.to).value,
              'text-dark fw-semibold bg-light': isActive(item.to).value,
              'text-secondary': !isActive(item.to).value
            }"
          >
            <span class="me-2">{{ item.icon }}</span>
            <span>{{ item.name }}</span>
          </router-link>
        </li>
      </ul>
    </nav>

    <!-- Logout -->
    <div class="border-top p-3">
      <button type="button" class="btn btn-danger w-100 btn-sm" @click="logout">
        Sair
      </button>
    </div>
  </aside>
</template>

<style scoped>
.nav-link {
  transition: background-color 0.2s, color 0.2s;
}
.nav-link:hover {
  background-color: #f8f9fa;
}
</style>