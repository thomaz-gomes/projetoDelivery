<script setup>
import { computed, reactive, ref, onMounted, onUpdated, nextTick, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import * as bootstrap from 'bootstrap';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

// Menu lateral (use Bootstrap Icons classes in `icon`)
const nav = [
  { name: 'Pedidos', to: '/orders', icon: 'bi bi-box-seam' },
  { name: 'Relatórios', to: '/reports', icon: 'bi bi-file-earmark-bar-graph', children: [
    { name: 'Histórico de vendas', to: '/sales', icon: 'bi bi-clock-history' },
    { name: 'Frentes de caixa', to: '/reports/cash-fronts', icon: 'bi bi-cash-stack' }
  ] },
  { name: 'Clientes', to: '/customers', icon: 'bi bi-person' },
  { name: 'Entregadores', to: '/riders', icon: 'bi bi-bicycle', children: [
    { name: 'Lista', to: '/riders', icon: 'bi bi-people' },
    { name: 'Créditos/Débitos', to: '/rider-adjustments', icon: 'bi bi-credit-card' },
  ] },
  { name: 'Afiliados', to: '/affiliates', icon: 'bi bi-people-fill' },
  { name: 'Cupons', to: '/coupons', icon: 'bi bi-ticket-perforated' },
    { name: 'Lista de cardápios', to: '/menu/menus', icon: 'bi bi-list' },
 
  
  // Configurações has sub-items
    { name: 'Configurações', to: '/settings/company', icon: 'bi bi-gear', children: [
    { name: 'Bairros', to: '/settings/neighborhoods', icon: 'bi bi-geo-alt' },
    { name: 'iFood', to: '/settings/ifood', icon: 'bi bi-shop' },
    { name: 'Integrações', to: '/integrations', icon: 'bi bi-plug' },
    { name: 'Lojas', to: '/settings/stores', icon: 'bi bi-shop-window' },
    { name: 'Pasta (import)', to: '/settings/file-source', icon: 'bi bi-folder' },
    { name: 'Preview (pasta)', to: '/settings/file-source/preview', icon: 'bi bi-eye' },
    { name: 'WhatsApp', to: '/settings/whatsapp', icon: 'bi bi-whatsapp' },
    { name: 'Geral', to: '/settings/company', icon: 'bi bi-sliders' },
    { name: 'Dev Tools', to: '/settings/devtools', icon: 'bi bi-tools' },
    { name: 'Formas de pagamento', to: '/settings/payment-methods', icon: 'bi bi-credit-card-2-front' },
    { name: 'Gestão de Acessos', to: '/settings/access-control', icon: 'bi bi-shield-lock' },
  ] },
];

// collapsed state for parent items with children (true = collapsed)
const parentsCollapsed = reactive({})

// when sidebar is mini, allow opening a floating submenu on parent click
const openSub = ref(null);
const subMenuPos = reactive({ top: 0, left: 0 });
const lastFocusedEl = ref(null);

function showMiniSubMenu(item, ev) {
  ev && ev.preventDefault();
  if (!mini.value) return toggleParent(item.to);
  // toggle
  if (openSub.value === item.to) { openSub.value = null; return; }
  openSub.value = item.to;
  lastFocusedEl.value = ev && ev.currentTarget ? ev.currentTarget : null;
  // compute position near the clicked element
  try{
    const el = ev && ev.currentTarget ? ev.currentTarget : null;
    const rect = el ? el.getBoundingClientRect() : { top: 80, left: 80, height: 32 };
    // place popup to the right of the sidebar
    subMenuPos.top = rect.top + window.scrollY;
    subMenuPos.left = rect.right + 6 + window.scrollX;
  }catch(e){ subMenuPos.top = 80; subMenuPos.left = 80 }
  nextTick(() => {
    try{
      const popup = document.getElementById('sidebar-mini-popup');
      if (popup) {
        const focusable = popup.querySelector('a,button, [tabindex]');
        if (focusable) focusable.focus();
      }
    }catch(e){}
  });
}

function closeMiniSub(){ openSub.value = null }

function onDocumentClick(ev){
  try{
    const aside = asideEl.value;
    if (!openSub.value) return;
    const popup = document.getElementById('sidebar-mini-popup');
    if (popup && (popup.contains(ev.target) || (aside && aside.contains(ev.target)))) return;
    openSub.value = null;
    // return focus to previous element
    try{ if (lastFocusedEl.value && lastFocusedEl.value.focus) lastFocusedEl.value.focus(); }catch(e){}
  }catch(e){}
}

function onDocumentKeydown(ev){
  try{
    if (!openSub.value) return;
    if (ev.key === 'Escape' || ev.key === 'Esc') {
      openSub.value = null;
      try{ if (lastFocusedEl.value && lastFocusedEl.value.focus) lastFocusedEl.value.focus(); }catch(e){}
    }
  }catch(e){}
}

function toggleParent(to){
  if(!to) return
  parentsCollapsed[to] = !parentsCollapsed[to]
}

// mini sidebar (icons-only) state — persisted in localStorage
const mini = ref(localStorage.getItem('sidebar-mini') === '1');
const asideEl = ref(null);

function initLocalTooltips(){
  try{
    const root = asideEl.value || document;
    const nodes = root.querySelectorAll('[data-bs-toggle="tooltip"]');
    nodes.forEach((el) => {
      if (!el._tooltip) {
        el._tooltip = new bootstrap.Tooltip(el);
      }
    });
  } catch(e){}
}

function toggleMini(){
  mini.value = !mini.value;
  try { localStorage.setItem('sidebar-mini', mini.value ? '1' : '0'); } catch(e){}
  nextTick(() => { try{ initLocalTooltips(); } catch(e){} });
}

onMounted(() => { nextTick(initLocalTooltips); document.addEventListener('click', onDocumentClick); document.addEventListener('keydown', onDocumentKeydown); });
onUpdated(() => { nextTick(initLocalTooltips); });
onUnmounted(() => { try{ document.removeEventListener('click', onDocumentClick); document.removeEventListener('keydown', onDocumentKeydown); }catch(e){} });
 

const isActive = (to) => computed(() => route.path.startsWith(to));

const showSidebar = computed(() => {
  try {
    if (route.meta && route.meta.noSidebar) return false;
  } catch (e) {}
  // Hide sidebar only for singular '/rider' app routes (e.g. '/rider', '/rider/orders', '/rider/home', '/rider/account').
  // Do NOT hide sidebar for '/riders' (admin list of riders).
  const p = route.path || '';
  return !(p === '/rider' || p.startsWith('/rider/'));
});

function logout() {
  auth.logout();
  router.replace('/login');
}
</script>
<template>
  <aside ref="asideEl" v-if="showSidebar" :class="['d-none d-md-flex flex-column border-end', { 'sidebar-mini': mini }]" :style="mini ? { width: '72px', minHeight: '100vh' } : { width: '240px', minHeight: '100vh' }">
    <!-- Header -->
    <div class="border-bottom p-3 header-wrap">
      <div class="d-flex align-items-center">
        <div class="me-auto d-flex align-items-center header-content">
          <i v-if="mini" class="bi bi-shop logo-compact-icon" aria-hidden="true" :title="'Delivery SaaS'" aria-label="Delivery SaaS"></i>
          <div v-else>
            <h5 class="mb-0">Delivery SaaS</h5>
            <small class="text-muted">Painel Administrativo</small>
          </div>
        </div>
        <div class="d-none d-md-block">
          <button type="button" class="btn btn-sm  btn-toggle-mini" @click="toggleMini" :aria-pressed="mini">
            <i :class="mini ? 'bi bi-chevron-right' : 'bi bi-chevron-left'"></i>
          </button>
        </div>
      </div>
    </div>

    <!-- Navegação -->
    <nav class="flex-grow-1 p-2">
        <ul class="nav flex-column">
        <li v-for="item in nav" :key="item.to" class="nav-item mb-1">
          <div class="d-flex flex-column">
            <template v-if="!item.children">
              <router-link
                :to="item.to"
                class="nav-link d-flex align-items-center px-3 py-2 rounded text-white"
                :class="{ active: isActive(item.to).value }"
              >
                <i
                  :class="item.icon + ' me-2'"
                  aria-hidden="true"
                  :title="mini ? item.name : null"
                  :aria-label="item.name"
                  v-bind:data-bs-toggle="mini ? 'tooltip' : null"
                  v-bind:data-bs-placement="mini ? 'right' : null"
                ></i>
                <span v-show="!mini">{{ item.name }}</span>
              </router-link>
            </template>

            <template v-else>
              <div class="nav-link d-flex align-items-center px-3 py-2 rounded parent-link" role="button" tabindex="0" @click="mini ? showMiniSubMenu(item, $event) : toggleParent(item.to)" @keydown.enter.prevent="mini ? showMiniSubMenu(item, $event) : toggleParent(item.to)" :aria-expanded="!parentsCollapsed[item.to]">
                <i :class="item.icon + ' me-2'" aria-hidden="true"></i>
                <span class="flex-grow-1" v-show="!mini">{{ item.name }}</span>
                <i v-show="!mini" :class="['bi bi-chevron-down ms-2 chevron', { rotated: parentsCollapsed[item.to] }]" aria-hidden="true"></i>
              </div>

              <transition name="slide">
                <ul class="nav flex-column ms-3 mt-1" v-show="!mini && !parentsCollapsed[item.to]">
                <li v-for="child in item.children" :key="child.to" class="nav-item mb-1">
                  <router-link
                    :to="child.to"
                    class="nav-link px-3 py-1 rounded text-white child-link"
                    :class="{ active: isActive(child.to).value }"
                  >
                      <i
                        :class="child.icon + ' me-2'"
                        aria-hidden="true"
                        :title="mini ? child.name : null"
                        :aria-label="child.name"
                        v-bind:data-bs-toggle="mini ? 'tooltip' : null"
                        v-bind:data-bs-placement="mini ? 'right' : null"
                      ></i>
                      <span v-show="!mini">{{ child.name }}</span>
                  </router-link>
                </li>
                </ul>
              </transition>
            </template>
          </div>
        </li>
      </ul>
    </nav>

    <!-- Floating submenu for mini mode -->
    <div v-if="mini && openSub" id="sidebar-mini-popup" :style="{ position: 'absolute', top: subMenuPos.top + 'px', left: subMenuPos.left + 'px', zIndex: 1050 }">
      <div style="background:#0d6efd; border:1px solid rgba(255,255,255,0.06); padding:8px; border-radius:6px; min-width:180px; box-shadow:0 6px 18px rgba(0,0,0,0.12)">
        <ul class="nav flex-column">
          <li v-for="p in nav.filter(n=>n.to===openSub)" :key="p.to">
            <template v-for="child in (p.children||[])">
              <li class="nav-item"><router-link :to="child.to" class="nav-link px-2 py-1 text-white" @click.native="closeMiniSub"> <i :class="child.icon + ' me-2'"></i> <span>{{ child.name }}</span></router-link></li>
            </template>
          </li>
        </ul>
      </div>
    </div>

    <!-- Logout -->
    <div class="border-top p-3">
      <button type="button" class="btn btn-sm btn-outline-secondary w-100 text-white border-white" @click="logout">
        Sair
      </button>
    </div>
  </aside>
</template>

<style scoped>
.nav-link {
  transition: background-color 0.12s, color 0.12s;
  color: #fff;
}
.nav-link i { color: #fff; }
.nav-link:hover, .nav-link:focus {
  background-color: rgba(255,255,255,0.08);
  color: #fff;
}
.parent-link { cursor: pointer; }
.child-link { font-size: .95rem; }
.child-link i { font-size: 1rem }

/* diagonal gradient background: primary -> slightly darker blue; fallback color included */
aside { background-color: #0d6efd; background-image: linear-gradient(135deg, #0d6efd 0%, #0a58ca 100%); }

/* active state: subtly highlighted */
.nav-link.active { background-color: rgba(255,255,255,0.14); font-weight:600 }

/* chevron rotate on toggle */
.chevron { transition: transform 180ms ease; transform-origin: 50% 50%; }
.chevron.rotated { transform: rotate(-90deg); }

/* slide transition for child lists */
.slide-enter-active, .slide-leave-active {
  transition: max-height 220ms ease, opacity 160ms ease;
  overflow: hidden;
}
.slide-enter-from, .slide-leave-to {
  max-height: 0;
  opacity: 0;
}
.slide-enter-to, .slide-leave-from {
  max-height: 400px; /* large enough for lists */
  opacity: 1;
}

/* Mini (icons-only) sidebar styles */
.sidebar-mini { transition: width 220ms ease; }
.sidebar-mini .nav-link { justify-content: center; padding-left: 0.4rem; padding-right: 0.4rem; }
.sidebar-mini .nav-link i { margin-right: 0; font-size: 1.15rem }
.sidebar-mini nav .nav-link span { display: none !important; opacity: 0 }
.sidebar-mini .child-link { padding-left: 0.5rem }
.sidebar-mini .parent-link { justify-content: center }
.sidebar-mini h5, .sidebar-mini small { display: none }
.sidebar-mini .logo-compact { width: 28px; height: 28px; object-fit: contain }
.logo-compact-icon { font-size: 20px; color: #fff; }
aside { transition: width 220ms ease; }
.btn-toggle-mini { border-color: rgba(255,255,255,0.2); color: #fff;  margin-right: -35px;
  background-color: #0d4cab;}
.btn-toggle-mini:hover { background-color: #2f7ff8; border-color: #2f7ff8; color: #fff; }
.btn-toggle-mini i { font-size: 0.92rem }

/* Smooth labels opacity transition when expanding/collapsing */
.nav-link span { transition: opacity 180ms ease; }
.header-wrap { transition: padding 220ms ease; }
</style>