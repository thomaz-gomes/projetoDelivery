<script setup>
import { ref, computed } from 'vue';
import { useRoute } from 'vue-router';
import Sidebar from './components/Sidebar.vue';
import PrinterWatcher from "./components/PrinterWatcher.vue";

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
      <!-- Topbar -->
      <header class="navbar navbar-light bg-white border-bottom sticky-top d-sm-none">
        <div class="container-fluid d-flex align-items-center justify-content-between">
          <div class="d-flex align-items-center gap-2">
            <!-- Botão abre offcanvas apenas no mobile -->
            <button
              class="navbar-toggler d-md-none"
              type="button"
              data-bs-toggle="offcanvas"
              data-bs-target="#appSidebar"
              aria-controls="appSidebar"
              aria-label="Abrir menu"
            >
              <span class="navbar-toggler-icon"></span>
            </button>
            <h1 class="h5 d-none d-md-block mb-0">Painel</h1>
          </div>

          <div class="small text-muted">
            <!-- espaço para status global, empresa, etc -->
          </div>
        </div>
      </header>

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