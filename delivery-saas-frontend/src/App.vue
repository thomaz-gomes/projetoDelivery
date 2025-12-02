<script setup>
import { ref, computed } from 'vue';
import { useRoute } from 'vue-router';
import Sidebar from './components/Sidebar.vue';
import PrinterWatcher from "./components/PrinterWatcher.vue";
import MobileBottomNav from './components/MobileBottomNav.vue';

const mobileOpen = ref(false);

// show the dashboard layout (sidebar/topbar) for all routes except the login page and public menu
const route = useRoute();
const showLayout = computed(() => {
  // hide layout for login and for any public routes (start with /public)
  if(!route || !route.path) return true
  if(route.path === '/login') return false
  if(route.path.startsWith && route.path.startsWith('/public')) return false
  return true
});
</script>

<template>
  <div class="bg-light text-dark">
    <template v-if="showLayout">
      <!-- Mobile bottom nav: replaces the top .navbar on small screens 
      <MobileBottomNav />
-->
      <!-- Layout principal -->
      <div class="container-fluid d-flex p-0">
        <!-- Sidebar desktop -->
        <Sidebar />

        <!-- Offcanvas (menu lateral no mobile) -->
        <div
          class="offcanvas offcanvas-start d-md-none"
          tabindex="-1"
          id="appSidebar"
          aria-labelledby="appSidebarLabel"
        >
          <div class="offcanvas-header border-bottom">
            <h5 class="offcanvas-title" id="appSidebarLabel">Menu</h5>
            <button
              type="button"
              class="btn-close"
              data-bs-dismiss="offcanvas"
              aria-label="Fechar"
            ></button>
          </div>
          <div class="offcanvas-body p-0">
            <!-- reaproveita o mesmo componente de sidebar -->
            <Sidebar />
          </div>
        </div>

        <!-- Conteúdo -->
        <main class="flex-grow-1 min-vh-100 p-4">
          <router-view />
        </main>
      </div>
    </template>

    <template v-else>
      <!-- Login (or other public/auth pages) — render full-screen without sidebar -->
      <router-view />
    </template>
  </div>
</template>

<style scoped>
/* transições simples */
.fade-enter-active, .fade-leave-active { transition: opacity .15s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.slide-enter-active, .slide-leave-active { transition: transform .2s ease; }
.slide-enter-from, .slide-leave-to { transform: translateX(-100%); }
</style>