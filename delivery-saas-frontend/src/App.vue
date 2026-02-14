<script setup>
import { ref, computed } from 'vue';
import { useRoute } from 'vue-router';
import Sidebar from './components/Sidebar.vue';
import PrinterWatcher from "./components/PrinterWatcher.vue";
import MobileBottomNav from './components/MobileBottomNav.vue';
import MediaLibraryModal from './components/MediaLibrary/MediaLibraryModal.vue';

const mobileOpen = ref(false);

// show the dashboard layout (sidebar/topbar) for all routes except the login page and public menu
const route = useRoute();
const showLayout = computed(() => {
  // hide layout for login, register, verify, setup and for any public routes (start with /public)
  if(!route || !route.path) return true
  if(route.path === '/login') return false
  if(route.path === '/register') return false
  if(route.path === '/verify-email') return false
  if(route.path === '/setup') return false
  if(route.path.startsWith && route.path.startsWith('/public')) return false
  return true
});

// hide mobile header for rider app routes (they have their own nav)
const showMobileHeader = computed(() => {
  if(!route || !route.path) return false
  const p = route.path || ''
  return !(p === '/rider' || p.startsWith('/rider/'))
});
</script>

<template>
  <div class="bg-light text-dark">
    <template v-if="showLayout">
      <!-- Mobile top header with hamburger (visible < md) -->
      <header v-if="showMobileHeader" class="mobile-topbar d-md-none">
        <button
          type="button"
          class="btn btn-link text-white p-0"
          data-bs-toggle="offcanvas"
          data-bs-target="#appSidebar"
          aria-label="Abrir menu"
        >
          <i class="bi bi-list" style="font-size:1.5rem"></i>
        </button>
        <span class="mobile-topbar-title">Delivery SaaS</span>
        <div style="width:24px"></div>
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
          style="width:280px;background:#0B3D5E;"
        >
          <div class="offcanvas-header border-bottom border-secondary py-2">
            <h5 class="offcanvas-title text-white" id="appSidebarLabel">Menu</h5>
            <button
              type="button"
              class="btn-close btn-close-white"
              data-bs-dismiss="offcanvas"
              aria-label="Fechar"
            ></button>
          </div>
          <div class="offcanvas-body p-0">
            <!-- reaproveita o mesmo componente de sidebar em modo embedded -->
            <Sidebar embedded />
          </div>
        </div>

        <!-- Conteúdo -->
        <main class="flex-grow-1 min-vh-100 main-content" style="max-height: 100vh; overflow-y: auto;">
          <router-view />
        </main>
      </div>
    </template>

    <template v-else>
      <!-- Login (or other public/auth pages) — render full-screen without sidebar -->
      <router-view />
    </template>
    <MediaLibraryModal />
  </div>
</template>

<style scoped>
/* transições simples */
.fade-enter-active, .fade-leave-active { transition: opacity .15s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.slide-enter-active, .slide-leave-active { transition: transform .2s ease; }
.slide-enter-from, .slide-leave-to { transform: translateX(-100%); }

/* Mobile top bar */
.mobile-topbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1040;
  height: 52px;
  background: #105784;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.10);
}
.mobile-topbar-title {
  font-size: 1.05rem;
  font-weight: 600;
  color: #fff;
}

/* Main content responsive padding */
.main-content { padding: 1.5rem; }

@media (max-width: 767.98px) {
  .main-content {
    padding: 1rem 0.75rem;
    padding-top: calc(52px + 0.75rem); /* compensar header fixo */
  }
}
</style>
