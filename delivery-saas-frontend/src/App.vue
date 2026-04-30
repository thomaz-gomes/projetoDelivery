<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from './api'
import './assets/rider-theme.css'
import { assetUrl } from './utils/assetUrl.js'
import { useAuthStore } from './stores/auth';
import { useSaasStore } from './stores/saas';
import { useInboxStore } from './stores/inbox';
import { useModulesStore } from './stores/modules';
import { useAddOnStoreStore } from './stores/addOnStore';
import { buildVisibleNav } from './utils/navVisibility.js'
import Sidebar from './components/Sidebar.vue';
import { nav } from './config/nav.js'
import PrinterWatcher from "./components/PrinterWatcher.vue";
import MobileBottomNav from './components/MobileBottomNav.vue';
import MediaLibraryModal from './components/MediaLibrary/MediaLibraryModal.vue';
import ImportProgressBar from './components/ImportProgressBar.vue';
import AiStudioModal from './components/AiStudio/AiStudioModal.vue';
import OnboardingWizard from './components/OnboardingWizard.vue';
import PurchaseImportModal from './components/PurchaseImportModal.vue';
import LuccaChat from './components/LuccaChat.vue';
import { useBarcodeScanner } from './composables/useBarcodeScanner.js';

const mobileOpen = ref(false);
const auth = useAuthStore();
const inboxStore = useInboxStore();

// ── Barcode Scanner → Purchase Import ──────────────────────────────────────
const scannerImportOpen = ref(false)
const scannerAccessKey = ref(null)
const scannerKeyCounter = ref(0)

const scanner = useBarcodeScanner()
scanner.onScan((digits) => {
  scannerAccessKey.value = digits
  scannerKeyCounter.value++
  scannerImportOpen.value = true
})

function onScannerModalClose() {
  scannerImportOpen.value = false
  scannerAccessKey.value = null
}
const saas = useSaasStore();
const modules = useModulesStore();
const router = useRouter();
const route = useRoute();

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

// ── Onboarding: show wizard on first access until user has at least one product ──
const showOnboarding = ref(false)
const onboardingInitialStep = ref(0)
const onboardingStoreId = ref(null)
const onboardingMenuId = ref(null)
let _onboardingChecked = false

async function checkOnboarding(user) {
  if (_onboardingChecked) return
  if (!user || String(user.role).toUpperCase() !== 'ADMIN' || !user.companyId) return
  try { if (sessionStorage.getItem('onboarding_skipped') === '1') return } catch {}
  _onboardingChecked = true
  try {
    // Garante que o saas store está populado antes de mostrar o wizard
    // (necessário para isCardapioSimplesOnly funcionar corretamente no wizard)
    if (!saas.subscription) await saas.fetchMySubscription().catch(() => {})

    const [storesRes, menusRes] = await Promise.all([
      api.get('/stores'),
      api.get('/menu/menus'),
    ])
    const stores = Array.isArray(storesRes.data) ? storesRes.data : []
    const menus  = Array.isArray(menusRes.data)  ? menusRes.data  : []

    if (stores.length === 0 || menus.length === 0) {
      onboardingInitialStep.value = 0
      showOnboarding.value = true
    }
  } catch {}
}

async function onOnboardingDone() {
  showOnboarding.value = false
  await loadMenusWidget().catch(() => {})
}

const addOnStore = useAddOnStoreStore()

watch(() => auth.user, (user) => {
  checkOnboarding(user)
  if (user?.role === 'ADMIN') {
    addOnStore.fetchPendingInvoiceCount()
  }
}, { immediate: true })
function injectRiderPwaMeta() {
  document.querySelectorAll('link[rel="manifest"]').forEach(el => el.remove())
  const manifest = document.createElement('link')
  manifest.rel = 'manifest'
  manifest.href = '/rider-manifest.webmanifest'
  document.head.appendChild(manifest)

  document.querySelectorAll('link[rel="apple-touch-icon"]').forEach(el => el.remove())
  const icon = document.createElement('link')
  icon.rel = 'apple-touch-icon'
  icon.href = '/icons/rider-192.svg'
  document.head.appendChild(icon)

  let titleMeta = document.querySelector('meta[name="apple-mobile-web-app-title"]')
  if (!titleMeta) {
    titleMeta = document.createElement('meta')
    titleMeta.name = 'apple-mobile-web-app-title'
    document.head.appendChild(titleMeta)
  }
  titleMeta.content = 'Entregador'
}

function removeRiderPwaMeta() {
  document.querySelectorAll('link[rel="manifest"]').forEach(el => el.remove())
  document.querySelectorAll('link[rel="apple-touch-icon"]').forEach(el => el.remove())
  const titleMeta = document.querySelector('meta[name="apple-mobile-web-app-title"]')
  if (titleMeta) titleMeta.remove()
}

watch(() => route.path, (newPath, oldPath) => {
  const isRider = newPath === '/rider' || newPath.startsWith('/rider/')
  const wasRider = !oldPath || oldPath === '/rider' || oldPath.startsWith('/rider/')
  if (isRider && !wasRider) {
    document.title = 'Core Delivery — Entregador'
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.content = '#198754'
    injectRiderPwaMeta()
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw-rider.js').catch(() => {})
    }
  } else if (!isRider && wasRider) {
    removeRiderPwaMeta()
  }
})

onMounted(() => {
  // Start barcode scanner listener
  scanner.start()

  // Only load admin widgets when NOT on a public route (avoids stale-token 401 → /login redirect)
  if (!route.path.startsWith('/public')) {
    loadMenusWidget().catch(()=>{});
  }
  // Inject rider PWA meta on initial load if already on a rider route
  if (route.path === '/rider' || route.path.startsWith('/rider/')) {
    document.title = 'Core Delivery — Entregador';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = '#198754';
    injectRiderPwaMeta()
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw-rider.js').catch(() => {});
    }
  }
});
onUnmounted(() => { scanner.stop() })

// ── Inbox unread: browser tab title + favicon badge ─────────────────────────
const BASE_TITLE = 'Core Delivery';
let _originalFaviconHref = null;

function applyFaviconBadge(show) {
  try {
    let link = document.querySelector("link[rel~='icon']");
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    if (!_originalFaviconHref) _originalFaviconHref = link.href || '/favicon.ico';
    if (!show) { link.href = _originalFaviconHref; return; }
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, 32, 32);
      ctx.beginPath();
      ctx.arc(26, 6, 7, 0, 2 * Math.PI);
      ctx.fillStyle = '#dc3545';
      ctx.fill();
      link.href = canvas.toDataURL('image/png');
    };
    img.onerror = () => {
      ctx.beginPath();
      ctx.arc(26, 6, 7, 0, 2 * Math.PI);
      ctx.fillStyle = '#dc3545';
      ctx.fill();
      link.href = canvas.toDataURL('image/png');
    };
    img.crossOrigin = 'anonymous';
    img.src = _originalFaviconHref;
  } catch (e) { /* favicon manipulation not critical */ }
}

watch(() => inboxStore.unreadTotal, (total) => {
  if (total > 0) {
    document.title = `(${total}) ${BASE_TITLE}`;
    applyFaviconBadge(true);
  } else {
    document.title = BASE_TITLE;
    applyFaviconBadge(false);
  }
}, { immediate: true });

// compute visible nav applying same filters as Sidebar.vue (role + enabled modules)
const visibleNav = computed(() => buildVisibleNav(auth.user, saas.enabledModules, nav));

// show the dashboard layout (sidebar/topbar) for all routes except the login page and public menu
const isInboxRoute = computed(() => {
  const p = route?.path || '';
  return p.startsWith('/inbox') && p !== '/inbox/automation' && p !== '/inbox/quick-replies';
});
const isRiderRoute = computed(() => route?.path?.startsWith('/rider') === true);
const showLayout = computed(() => {
  // hide layout for login, register, verify, setup and for any public routes (start with /public)
  if(!route || !route.path) return true
  if(route.path === '/') return false
  if(route.path.startsWith('/login')) return false
  if(route.path === '/register') return false
  if(route.path === '/verify-email') return false
  if(route.path === '/setup') return false
  if(route.path.startsWith && route.path.startsWith('/public')) return false
  if(route.path.startsWith('/trial')) return false
  if(route.path === '/termos-de-servico') return false
  if(route.path === '/politica-de-privacidade') return false
  return true
});

// hide mobile header for rider app routes (they have their own nav)
const showMobileHeader = computed(() => {
  if(!route || !route.path) return false
  const p = route.path || ''
  return !(p === '/rider' || p.startsWith('/rider/'))
});

// Floating QR shortcut: visible on all rider screens except the QR reader itself and claim/login flows
const showRiderQrFab = computed(() => {
  const p = route?.path || ''
  if (!(p === '/rider' || p.startsWith('/rider/'))) return false
  if (p === '/rider/home') return false // QR reader page
  if (p.startsWith('/rider/claim')) return false
  return true
});
function goToRiderQr(){
  try {
    // If already on rider orders, dispatch event to open scanner directly
    if (route.path === '/rider' || route.path === '/rider/orders') {
      window.dispatchEvent(new CustomEvent('open-rider-scanner'));
    } else {
      // Navigate to orders first, then open scanner
      router.push('/rider/orders').then(() => {
        setTimeout(() => window.dispatchEvent(new CustomEvent('open-rider-scanner')), 300);
      });
    }
  } catch(e){}
}
</script>

<template>
  <div :class="isRiderRoute ? 'rider-app' : 'bg-light text-dark'">
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
        <span class="mobile-topbar-title"><img src="/core.png" alt="" class="log" style="max-width:125px"></span>

        <router-link v-if="inboxStore.unreadTotal > 0" to="/inbox" class="btn btn-link text-dark p-1 position-relative ms-auto me-1" title="Mensagens não lidas" aria-label="Mensagens não lidas">
          <i class="bi bi-chat-dots" style="font-size:1.3rem"></i>
          <span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger" style="font-size:0.6rem;min-width:18px">
            {{ inboxStore.unreadTotal > 99 ? '99+' : inboxStore.unreadTotal }}
          </span>
        </router-link>

          <div v-if="!saas.isCardapioSimplesOnly" class="d-block d-sm-none dropdown ms-3">
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
            
        <img src="/core-neg.png" alt="" class="logo-neg" style="max-width: 125px; margin:8px;">
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
                          <router-link :to="item.to" class="d-block py-1 text-dark d-flex align-items-center"><i :class="item.icon + ' me-2'"></i>{{ item.name }}<span v-if="item.to === '/billing' && addOnStore.pendingInvoiceCount" class="badge bg-danger ms-auto">{{ addOnStore.pendingInvoiceCount }}</span></router-link>
                        </template>
                  </li>
                </ul>
              </nav>
            </div>
            <Sidebar embedded />
          </div>
        </div>

        <!-- Conteúdo -->
        <main class="flex-grow-1 min-vh-100 main-content" :class="{ 'main-content--flush': isInboxRoute }" :style="{ maxHeight: 'calc(100vh - 64px)', overflowY: isInboxRoute ? 'hidden' : 'auto' }">
          <router-view />
        </main>
      </div>
      <OnboardingWizard
        :visible="showOnboarding"
        :initial-step="onboardingInitialStep"
        :initial-store-id="onboardingStoreId"
        :initial-menu-id="onboardingMenuId"
        @done="onOnboardingDone"
        @skip="showOnboarding = false"
      />
    </template>

    <template v-else>
      <!-- Login (or other public/auth pages) — render full-screen without sidebar -->
      <router-view />
    </template>
    <MediaLibraryModal />
    <AiStudioModal />
    <ImportProgressBar />
    <!-- Barcode scanner → Purchase Import modal -->
    <PurchaseImportModal
      v-if="scannerImportOpen"
      :initial-access-key="scannerAccessKey"
      :key="scannerKeyCounter"
      @close="onScannerModalClose"
      @imported="onScannerModalClose"
    />
    <!-- Atalho global do leitor QR para entregadores -->
    <button
      v-if="showRiderQrFab"
      type="button"
      class="rider-qr-fab"
      title="Ler QR Code"
      aria-label="Ler QR Code"
      @click="goToRiderQr"
    >
      <i class="bi bi-qr-code-scan"></i>
    </button>
    <LuccaChat />
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

/* Main content responsive padding 
.main-content { padding:1.5rem; }*/

@media (max-width: 767.98px) {
  .main-content {
   /*  padding: 1rem 0.75rem; */
    padding-top: calc(52px + 0.75rem); /* compensar header fixo */
  }
}

/* Inbox route: zero padding so the inbox can use full available area */
.main-content--flush { padding: 0 !important; }
@media (max-width: 767.98px) {
  .main-content--flush { padding-top: 52px !important; } /* keep mobile header offset */
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
button#quickMenuDropdown[aria-expanded="true"],
button#quickMenuDropdown:active {
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

/* Floating QR shortcut for rider area */
.rider-qr-fab {
  position: fixed;
  right: 18px;
  bottom: 84px;
  z-index: 1050;
  width: 58px;
  height: 58px;
  border-radius: 50%;
  border: none;
  background: #198754;
  color: #fff;
  font-size: 1.6rem;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 18px rgba(0,0,0,0.25);
  cursor: pointer;
  transition: transform .15s ease, background .15s ease;
}
.rider-qr-fab:hover { background: #157347; transform: scale(1.05); }
.rider-qr-fab:active { transform: scale(0.96); }
</style>
