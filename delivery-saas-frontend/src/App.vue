<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from './api'
import { assetUrl } from './utils/assetUrl.js'
import { useAuthStore } from './stores/auth';
import { useSaasStore } from './stores/saas';
import { useModulesStore } from './stores/modules';
import { buildVisibleNav } from './utils/navVisibility.js'
import Sidebar from './components/Sidebar.vue';
import { nav } from './config/nav.js'
import PrinterWatcher from "./components/PrinterWatcher.vue";
import MobileBottomNav from './components/MobileBottomNav.vue';
import MediaLibraryModal from './components/MediaLibrary/MediaLibraryModal.vue';

const mobileOpen = ref(false);
const auth = useAuthStore();
const saas = useSaasStore();
const modules = useModulesStore();
const router = useRouter();

// quick menu (mobile header) state copied minimal version from Sidebar
const quickMenuOpen = ref(false);
const quickMenuBtn = ref(null);
const quickMenuMenu = ref(null);
const menusList = ref([]);

const userName = computed(() => {
  try{ return auth.user && (auth.user.name || auth.user.fullName || auth.user.email) ? String(auth.user.name || auth.user.fullName || auth.user.email) : '' }catch(e){ return '' }
});
const userInitials = computed(() => {
  try{
    const n = userName.value || (auth.user && auth.user.email) || '';
    const parts = String(n).trim().split(/\s+/).filter(Boolean);
    if(parts.length === 0) return '';
    if(parts.length === 1) return parts[0].slice(0,2).toUpperCase();
    return (String(parts[0][0] || '') + String(parts[1][0] || '')).toUpperCase();
  }catch(e){ return '' }
});
const userRoleLabel = computed(() => { try{ return auth.user && auth.user.role ? String(auth.user.role).toUpperCase() : '' }catch(e){ return '' } });

function logout() {
  auth.logout();
  router.replace('/login');
}

async function loadMenusWidget(){
  try{
    const res = await api.get('/menu/menus');
    const rows = res.data || [];
    for(const m of rows){
      try{
        let thumb = m.logoUrl || (m.logo && m.logoUrl) || null;
        if(thumb && !String(thumb).startsWith('http')) thumb = assetUrl(thumb);
        m._thumb = thumb;
        m._meta = m._meta || {};
        m._status = m._status || { isOpen: true };
      }catch(e){ m._meta = m; m._status = { isOpen: true } }
    }
    menusList.value = rows;
  }catch(e){ console.warn('Failed to load menus for app quickMenu', e) }
}

async function onToggleForce(item, ev){
  try{
    if (!auth.user) { try { if (ev && ev.target) ev.target.checked = !ev.target.checked; } catch(e){}; alert('Faça login para alterar o status do cardápio.'); return; }
    const newVal = !!ev.target.checked;
    const storeId = item.storeId || item._meta?.id || item._meta?.storeId || null;
    if(!storeId) { alert('Loja não identificada'); return }
    const payload = { menuId: item.id, forceOpen: newVal };
    try{ await api.post(`/stores/${storeId}/settings/upload`, payload); try { window.dispatchEvent(new CustomEvent('store:settings-updated', { detail: { storeId } })); }catch(e){}; try { localStorage.setItem(`store_settings_updated_${storeId}`, String(Date.now())); }catch(e){} }catch(err){ console.error('Failed to persist forceOpen', err); alert('Falha ao mudar status'); }
    item._meta = item._meta || {}; item._meta.forceOpen = newVal; item._status = item._status || {}; item._status.isOpen = newVal;
  }catch(e){ console.error('onToggleForce', e); alert('Falha ao mudar status') }
}

onMounted(() => { loadMenusWidget().catch(()=>{}); });

// compute visible nav applying same filters as Sidebar.vue (role + enabled modules)
const visibleNav = computed(() => buildVisibleNav(auth.user, saas.enabledModules, nav));

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
          class="btn btn-link text-dark p-0"
          data-bs-toggle="offcanvas"
          data-bs-target="#appSidebar"
          aria-label="Abrir menu"
        >
          <i class="bi bi-list" style="font-size:1.5rem"></i>
        </button>
        <span class="mobile-topbar-title"><img src="../../public/core.png" alt="" class="log" style="max-width:125px"></span>
      
          <div class="d-block d-sm-none dropdown ms-3">
          <button ref="quickMenuBtn" class="btn btn-light dropdown-toggle" type="button" id="quickMenuDropdown" @click.prevent="quickMenuOpen = !quickMenuOpen" :aria-expanded="quickMenuOpen">
            <template v-if="auth.user">
              <span class="d-flex align-items-center user-info" style="gap: 16px; padding: 1px 4px;">
                <span class="d-flex">
                  <span class="user-initials rounded-circle d-flex align-items-center justify-content-center me-2">{{ userInitials }}</span>
                  <span class="user-text mr-3">
                    <span class="user-name">{{ userName }}</span>
                    <span class="user-role small text-muted">{{ userRoleLabel }}</span>
                  </span>
                </span>
                <i class="bi bi-chevron-down"></i>
              </span>
            </template>
          </button>
          <ul ref="quickMenuMenu" :class="['dropdown-menu','dropdown-menu-end',{ show: quickMenuOpen }]" aria-labelledby="quickMenuDropdown" v-show="quickMenuOpen">
            
            <li v-if="(menusList || []).length === 0" class="dropdown-item text-muted">Nenhum cardápio disponível</li>
            <li v-for="m in menusList" :key="m.id" class="dropdown-item d-flex align-items-center justify-content-between py-2">
              <div class="d-flex align-items-center">
                <img v-if="m._thumb" :src="m._thumb" alt="" style="width:28px;height:28px;object-fit:cover;border-radius:6px;margin-right:8px" />
                <div style="min-width:120px">
                  <div style="font-weight:600">{{ m.name }}</div>
                  <small class="text-muted">{{ (m._status && m._status.isOpen) ? 'Aberto' : 'Fechado' }}</small>
                </div>
              </div>
              <div>
                <div class="form-check form-switch m-0">
                  <input class="form-check-input" type="checkbox" :checked="(m._meta && (m._meta.forceOpen !== undefined)) ? m._meta.forceOpen : (m._status && m._status.isOpen)" @change.prevent="onToggleForce(m, $event)" />
                </div>
              </div>
            </li>
            <li><hr class="dropdown-divider"></li>
            <li>
              <button class="dropdown-item" @click.prevent="logout()">Sair</button>
            </li>
          </ul>
        </div>
      </header>
      <!-- Layout principal -->
      <div class="container-fluid d-flex p-0 flex-column">
        <!-- Sidebar desktop -->
        <Sidebar />

        <!-- Offcanvas (menu lateral no mobile) -->
        <div
          class="offcanvas offcanvas-start d-md-none"
          tabindex="-1"
          id="appSidebar"
          aria-labelledby="appSidebarLabel"
          style="width:280px;background:#89d136;"
        >
          <div class="offcanvas-header border-bottom border-secondary py-2">
            
        <img src="../../public/core-neg.png" alt="" class="logo-neg" style="max-width: 125px; margin:8px;">
            <button
              type="button"
              class="btn-close btn-close-white"
              data-bs-dismiss="offcanvas"
              aria-label="Fechar"
            ></button>
          </div>
            <div class="offcanvas-body p-0">
            <!-- Lista rápida de links (todas as áreas do app) -->
            <div class="p-3 d-md-none">
              <nav class="mobile-links-list">
                <ul class="list-unstyled mb-2">
                  <li v-for="item in visibleNav" :key="item.to || item.name" class="mb-2">
                        <template v-if="item.children && item.children.length">
                          <div class="fw-bold text-dark"><i :class="item.icon + ' me-2'"></i>{{ item.name }}</div>
                          <ul class="list-unstyled ms-3">
                            <li v-for="child in item.children" :key="child.to">
                              <router-link :to="child.to" class=" d-flex align-items-center"><i :class="child.icon + ' me-2'"></i>{{ child.name }}</router-link>
                            </li>
                          </ul>
                        </template>
                        <template v-else>
                          <router-link :to="item.to" class="d-block py-1 text-dark"><i :class="item.icon + ' me-2'"></i>{{ item.name }}</router-link>
                        </template>
                  </li>
                </ul>
              </nav>
            </div>
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
  background: #FFF;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.10);
}
.mobile-topbar-title {
  font-size: 1.05rem;
  font-weight: 600;
  color: #000;
}

/* Main content responsive padding */
.main-content { padding: 1.5rem; }

@media (max-width: 767.98px) {
  .main-content {
    padding: 1rem 0.75rem;
    padding-top: calc(52px + 0.75rem); /* compensar header fixo */
  }
}
/* Apply Sidebar color scheme and typography to mobile offcanvas list */
.mobile-links-list { background: #89d136; padding: 8px 10px; border-radius: 8px; }
.mobile-links-list a { color: #000435; text-decoration: none; display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: 0.92rem; }
.mobile-links-list .fw-bold { color: #000435; font-weight: 600; font-size: 1rem; margin-top: 6px; margin-bottom: 4px; }
.mobile-links-list i { color: #000435; font-size: 1rem; width: 20px; text-align: center; }
.mobile-links-list ul.list-unstyled { margin: 0; padding: 0; }
.mobile-links-list li { line-height: 1.4; }
/* Quick menu styling (copied from Sidebar.vue for consistent header mobile look) */
button#quickMenuDropdown {
    background: #f8f9fa;
    padding: 2px 4px;
    border:none;
}
button#quickMenuDropdown[aria-expanded="true"], .btn:first-child:active {
  background: #89d136 !important;
  border-color: #89d136 !important;
  border-radius: 16px 16px 0px 0px;
}

/* animated open/close for quick menu dropdown */
.dropdown .dropdown-menu {
  transform-origin: top right;
  transform: translateY(-6px) scale(0.98);
  opacity: 0;
  transition: transform 180ms cubic-bezier(.2,.9,.2,1), opacity 320ms ease;
  will-change: transform, opacity;
}
.dropdown .dropdown-menu.show {
  transform: translateY(0) scale(1);
  opacity: 1;
  right: 0px;
  position: absolute;
  background: #89d136;
  border-color: #89d136;
  border-radius: 16px 0px 16px 16px;
  box-shadow: none;
}
#quickMenuDropdown::after { display:none; }
.form-switch .form-check-input:checked {
    background-color: #000000;
    border-color: var(--success);
}

.user-info .user-initials {
    width: 36px;
    height: 36px;
    background: #FFF;
    color: #263238;
    font-weight: 700;
    border-radius: 50%;
    font-size: 0.75rem;
}
.user-info .user-name { font-weight:600; font-size:0.75rem }
.user-info .user-role { font-size:0.65rem; font-style: italic;}
/* Truncate long user names with ellipsis */
.user-info { max-width: 220px; }
.user-info .user-text { max-width: 160px; overflow: hidden; text-align: left;}
.user-info .user-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.user-info .user-role { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
