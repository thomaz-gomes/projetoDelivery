<script setup>
import { computed, reactive, ref, onMounted, onUpdated, nextTick, onUnmounted } from 'vue';
import api from '../api'
import { assetUrl } from '../utils/assetUrl.js'
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
    // handle mini submenu
    const popup = document.getElementById('sidebar-mini-popup');
    if (openSub.value) {
      if (popup && (popup.contains(ev.target) || (aside && aside.contains(ev.target)))) return;
      openSub.value = null;
      try{ if (lastFocusedEl.value && lastFocusedEl.value.focus) lastFocusedEl.value.focus(); }catch(e){}
    }
    // handle menus dropdown: close when clicking outside dropdown & toggle button
    try{
      if (dropdownOpen.value) {
        const btn = menuToggleBtn.value
        const dd = menusDropdownEl.value
        if (dd && (dd === ev.target || dd.contains && dd.contains(ev.target))) {
          // clicked inside dropdown — keep open
        } else if (btn && (btn === ev.target || btn.contains && btn.contains(ev.target))) {
          // clicked the toggle — let its handler manage
        } else {
          dropdownOpen.value = false
        }
      }
    }catch(e){}
  }catch(e){}
}

function onDocumentKeydown(ev){
  try{
    if (ev.key === 'Escape' || ev.key === 'Esc') {
      if (openSub.value) {
        openSub.value = null;
        try{ if (lastFocusedEl.value && lastFocusedEl.value.focus) lastFocusedEl.value.focus(); }catch(e){}
      }
      if (dropdownOpen.value) dropdownOpen.value = false
    }
  }catch(e){}
}

function toggleMenusDropdown(ev){
  try{
    const opening = !dropdownOpen.value
    // compute popup position near the toggle button when opening in mini/mobile
    if(opening && menuToggleBtn && (mini.value)){
      try{
        const el = menuToggleBtn.value && (menuToggleBtn.value.$el ? menuToggleBtn.value.$el : menuToggleBtn.value)
        const rect = el && el.getBoundingClientRect ? el.getBoundingClientRect() : { top: 80, right: 80 }
        subMenuPos.top = rect.top + window.scrollY
        subMenuPos.left = rect.right + 6 + window.scrollX
      }catch(e){}
    }
    dropdownOpen.value = !dropdownOpen.value
  }catch(e){ dropdownOpen.value = false }
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

onMounted(() => { nextTick(initLocalTooltips); document.addEventListener('click', onDocumentClick); document.addEventListener('keydown', onDocumentKeydown); window.addEventListener('resize', updateIsMobile); updateIsMobile(); });
onMounted(()=>{ loadMenusWidget().catch(()=>{}) })
onUpdated(() => { nextTick(initLocalTooltips); });
onUnmounted(() => { try{ document.removeEventListener('click', onDocumentClick); document.removeEventListener('keydown', onDocumentKeydown); window.removeEventListener('resize', updateIsMobile); }catch(e){} });
 

const isActive = (to) => computed(() => route.path.startsWith(to));

// menus widget state (cardápios are the storefronts)
const menusList = ref([])
// dropdown state for menus control
const dropdownOpen = ref(false)
const menuToggleBtn = ref(null)
const menusDropdownEl = ref(null)

// detect small screens (mobile) to change dropdown behavior/style
const isMobile = ref(typeof window !== 'undefined' ? (window.innerWidth <= 576) : false)
function updateIsMobile(){ try{ isMobile.value = window.innerWidth <= 576 }catch(e){} }

const closedCount = computed(() => (menusList.value || []).filter(m => m._status && !m._status.isOpen).length)
const totalCount = computed(() => (menusList.value || []).length)
const openCount = computed(() => Math.max(0, (totalCount.value || 0) - (closedCount.value || 0)))

async function loadMenusWidget(){
  try{
    const res = await api.get('/menu/menus')
    const rows = res.data || []
    // For each menu, fetch its parent store merged settings to compute status and read menu-specific metadata
    for(const m of rows){
      try{
        const storeId = m.storeId || m.store?.id || null
        let merged = {}
        if(storeId){
          const mr = await api.get(`/stores/${storeId}`)
          merged = mr.data || {}
          if(merged.logoUrl && !merged.logoUrl.startsWith('http')) merged.logoUrl = assetUrl(merged.logoUrl)
        }
        const menuMeta = (merged && merged.menus && merged.menus[String(m.id)]) ? merged.menus[String(m.id)] : {}
        const combined = { ...(merged || {}), ...(menuMeta || {}) }
        let thumb = m.logoUrl || combined.logo || combined.logoUrl || null
        if(thumb && !String(thumb).startsWith('http')) thumb = assetUrl(thumb)
        m._thumb = thumb
        m._meta = combined
        m._status = computeOpenStatus(combined)
      }catch(e){
        m._meta = m
        m._status = computeOpenStatus(m)
      }
    }
    menusList.value = rows
  }catch(e){ console.warn('Failed to load menus for sidebar widget', e) }
}

function computeOpenStatus(s){
  try{
    // If settings file includes a forced flag, respect it
    const forced = s.forceOpen
    if(forced !== undefined && forced !== null){
      return { isOpen: !!forced, forced: !!forced, source: 'forced' }
    }
    // follow schedule: reuse PublicMenu logic (simplified)
    if(s.open24Hours || s.alwaysOpen) return { isOpen: true, forced: undefined, source: 'schedule' }

    const parseHM = (str) => {
      if(!str) return null
      const parts = String(str).split(':').map(x=>Number(x))
      if(parts.length<2) return null
      const [hh, mm] = parts
      if(Number.isNaN(hh) || Number.isNaN(mm)) return null
      return { hh, mm }
    }

    if(Array.isArray(s.weeklySchedule) && s.weeklySchedule.length){
      const tz = s.timezone || 'America/Sao_Paulo'
      try{
        const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
        const parts = fmt.format(new Date()).split('/')
        const [dd, mm, yyyy] = parts
        const tzDate = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`)
        const weekDay = tzDate.getUTCDay()
        const today = s.weeklySchedule.find(d => Number(d?.day) === Number(weekDay))
        if(!today || !today.enabled) return { isOpen: false, forced: undefined, source: 'schedule' }
        const from = parseHM(today.from)
        const to = parseHM(today.to)
        if(!from || !to) return { isOpen: false, forced: undefined, source: 'schedule' }
        // compute now in tz
        let nowParts
        try{
          const fmt2 = new Intl.DateTimeFormat(undefined, { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' })
          if(fmt2.formatToParts){
            const p = fmt2.formatToParts(new Date())
            nowParts = { hh: Number(p.find(x=>x.type==='hour')?.value), mm: Number(p.find(x=>x.type==='minute')?.value) }
          } else {
            const s2 = fmt2.format(new Date())
            const [hh, mm] = s2.split(':').map(x=>Number(x))
            nowParts = { hh, mm }
          }
        }catch(e){ const d = new Date(); nowParts = { hh: d.getHours(), mm: d.getMinutes() } }
        const toM = p => p.hh*60 + p.mm
        const nowM = toM(nowParts)
        const fromM = toM(from)
        const toMval = toM(to)
        if(fromM <= toMval) return { isOpen: nowM >= fromM && nowM <= toMval, forced: undefined, source: 'schedule' }
        return { isOpen: (nowM >= fromM) || (nowM <= toMval), forced: undefined, source: 'schedule' }
      }catch(e){ console.warn('computeOpenStatus weeklySchedule error', e) }
    }

    // fallback to openFrom/openTo
    const from = parseHM(s.openFrom)
    const to = parseHM(s.openTo)
    if(!from || !to) return { isOpen: false, forced: undefined, source: 'schedule' }
    let nowParts
    try{
      if(s.timezone){
        const fmt = new Intl.DateTimeFormat(undefined, { timeZone: s.timezone, hour12: false, hour: '2-digit', minute: '2-digit' })
        if(fmt.formatToParts){
          const parts = fmt.formatToParts(new Date())
          nowParts = { hh: Number(parts.find(p=>p.type==='hour')?.value), mm: Number(parts.find(p=>p.type==='minute')?.value) }
        } else { const str = fmt.format(new Date()); const [hh, mm] = str.split(':').map(x=>Number(x)); nowParts = { hh, mm } }
      } else { const d = new Date(); nowParts = { hh: d.getHours(), mm: d.getMinutes() } }
    }catch(e){ const d = new Date(); nowParts = { hh: d.getHours(), mm: d.getMinutes() } }
    const toMinutes = p => p.hh*60 + p.mm
    const nowM = toMinutes(nowParts)
    const fromM = toMinutes(from)
    const toM2 = toMinutes(to)
    if(fromM <= toM2) return { isOpen: nowM >= fromM && nowM <= toM2, forced: undefined, source: 'schedule' }
    return { isOpen: (nowM >= fromM) || (nowM <= toM2), forced: undefined, source: 'schedule' }
  }catch(e){ console.warn('computeOpenStatus failed', e); return { isOpen: false, forced: undefined, source: 'schedule' } }
}

async function onToggleForce(item, ev){
  try{
    const newVal = !!ev.target.checked
    const storeId = item.storeId || item._meta?.id || item._meta?.storeId || null
    if(!storeId) throw new Error('Store id not found for this menu')
    await api.post(`/stores/${storeId}/settings/upload`, { menuId: item.id, forceOpen: newVal })
    item._meta = item._meta || {}
    item._meta.forceOpen = newVal
    item._status = computeOpenStatus(item._meta)
  }catch(e){ console.error('Failed to persist forceOpen', e); alert('Falha ao mudar status') }
}

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

    <!-- Menus dropdown: shows closed count and expands to list cardápios -->
    <div class="border-bottom p-2 stores-widget w-100" v-if="menusList.length" style="position:relative">
      <div class="d-flex align-items-center justify-content-between w-100">
        <div class="d-flex align-items-center position-relative w-100">
          <div class=" w-100" v-if="!mini">
            <button ref="menuToggleBtn" type="button" class="btn btn-sm btn-light d-flex align-items-center text-dark w-100" @click="toggleMenusDropdown" :aria-expanded="dropdownOpen">
          <div class="me-2 small text-muted" v-show="!mini">Cardápios</div>
          
              <span class="small">(
                <template v-if="openCount > 0">{{ openCount }} {{ openCount === 1 ? 'aberta' : 'abertas' }}</template>
                <template v-else>{{ closedCount }} {{ closedCount === 1 ? 'fechada' : 'fechadas' }}</template>)
              </span>
              <i class="bi bi-caret-down-fill ms-2"></i>
            </button>
          </div>
          <div v-else class="d-flex align-items-center  w-100" role="button" ref="menuToggleBtn" @click="toggleMenusDropdown">
            <div class="thumb-wrap">
              <img v-if="menusList[0] && menusList[0]._thumb" :src="menusList[0]._thumb" class="store-thumb" />
              <div :class="['status-dot', closedCount > 0 ? 'closed' : 'open', 'thumb-badge']"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Inline dropdown for expanded sidebar (pushes content down) -->
      <transition name="slide">
        <div v-if="!mini && dropdownOpen" class="menus-dropdown-inline mt-2 p-2">
          <div class="small text-muted mb-2">status</div>
          <ul class="list-unstyled m-0">
            <li v-for="m in menusList" :key="m.id" class="d-flex align-items-center justify-content-between py-1">
              <div class="d-flex align-items-center gap-2">
                <div class="thumb-wrap">
                  <img v-if="m._thumb" :src="m._thumb" class="store-thumb" />
                  <div :class="['status-dot', m._status && m._status.isOpen ? 'open' : 'closed', 'thumb-badge']"></div>
                </div>
                <div>
                  <div class="store-name">{{ m.name }}</div>
                  <div class="small text-muted store-sub">{{ m._meta && (m._meta.name || m._meta.city) ? (m._meta.name || m._meta.city) : '' }}</div>
                </div>
              </div>
              <div class="d-flex align-items-center gap-2">
                <div class="form-check form-switch m-0">
                  <input class="form-check-input" type="checkbox" role="switch" :checked="m._status && m._status.forced !== undefined ? m._status.forced : false" @change="onToggleForce(m, $event)" />
                </div>
              </div>
            </li>
          </ul>
        </div>
      </transition>

      <!-- Floating dropdown for mini sidebar (to the side) -->
      <div v-if="mini">
        <div v-show="dropdownOpen" ref="menusDropdownEl" :class="['menus-dropdown', { 'menus-dropdown-mobile': isMobile }, 'mt-2', 'p-2']" :style="isMobile ? { position: 'absolute', top: subMenuPos.top + 'px', left: subMenuPos.left + 'px', zIndex: 1050 } : {}">
          <div class="small text-muted mb-2">status</div>
          <ul class="list-unstyled m-0">
            <li v-for="m in menusList" :key="m.id" class="d-flex align-items-center justify-content-between py-1">
              <div class="d-flex align-items-center gap-2">
                <div class="thumb-wrap">
                  <img v-if="m._thumb" :src="m._thumb" class="store-thumb" />
                  <div :class="['status-dot', m._status && m._status.isOpen ? 'open' : 'closed', 'thumb-badge']"></div>
                </div>
                <div>
                  <div class="store-name">{{ m.name }}</div>
                  <div class="small text-muted store-sub">{{ m._meta && (m._meta.name || m._meta.city) ? (m._meta.name || m._meta.city) : '' }}</div>
                </div>
              </div>
              <div class="d-flex align-items-center gap-2">
                <div class="form-check form-switch m-0">
                  <input class="form-check-input" type="checkbox" role="switch" :checked="m._status && m._status.forced !== undefined ? m._status.forced : false" @change="onToggleForce(m, $event)" />
                </div>
              </div>
            </li>
          </ul>
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

/* menus dropdown styling */
.menus-dropdown {
  background: #fff;
  color: #222;
  border-radius: 8px;
  box-shadow: 0 8px 20px rgba(0,0,0,0.12);
  width: 320px;
  max-height: 360px;
  overflow: auto;
  position: absolute;
  top: calc(100% + 8px);
  right: 8px;
  left: auto;
  z-index: 1400;
}
.menus-dropdown-mobile {
  background: linear-gradient(180deg, #2f7ff8 0%, #0d6efd 100%);
  color: #fff;
  border-radius: 10px;
  min-width: 170px;
  max-width: 260px;
  box-shadow: 0 10px 30px rgba(13,110,253,0.18);
  border: 1px solid rgba(255,255,255,0.06);
}
.menus-dropdown-mobile .nav-link { color: #fff; padding: 10px 12px; border-radius:6px }
.menus-dropdown-mobile .nav-link:hover, .menus-dropdown-mobile .nav-link:focus { background: rgba(255,255,255,0.06); color: #fff }
.menus-dropdown-mobile .thumb-wrap { margin-right:6px }
.menus-dropdown-inline {
  background: #fff;
  color: #222;
  border-radius: 8px;
  box-shadow: 0 8px 20px rgba(0,0,0,0.12);
  width: 100%;
  max-height: 360px;
  overflow: auto;
  position: relative;
}
.stores-widget .store-thumb { width:36px; height:36px; object-fit:cover; border-radius:6px }
.thumb-wrap { position: relative; display: inline-block }
.thumb-badge { position: absolute; right: -3px; bottom: -3px; width:10px; height:10px; border-radius:50%; border:2px solid #fff; box-shadow:0 1px 3px rgba(0,0,0,0.15) }
.status-dot { width:10px; height:10px; border-radius:50%; }
.status-dot.open { background: #0ac36b }
.status-dot.closed { background: #ff4d4f }
.menus-dropdown .store-name { font-weight:600 }
.menus-dropdown .store-sub { opacity:0.8 }

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

/* Stores widget styles */
.stores-widget { background: rgba(255,255,255,0.03); }
.store-thumb { width:28px; height:28px; object-fit:cover; border-radius:6px }
.store-item { border-radius:6px; padding-left:6px; padding-right:6px }
.store-name { font-weight:600; font-size:0.92rem }
.store-sub { margin-top:-2px }
.toggle-open { width:36px; height:22px }

/* Smooth labels opacity transition when expanding/collapsing */
.nav-link span { transition: opacity 180ms ease; }
.header-wrap { transition: padding 220ms ease; }
</style>