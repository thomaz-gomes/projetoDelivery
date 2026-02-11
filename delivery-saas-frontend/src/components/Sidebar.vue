<script setup>
import { computed, reactive, ref, onMounted, onUpdated, nextTick, onUnmounted, watch } from 'vue';
import { useModulesStore } from '../stores/modules'
import api from '../api'
import { useSaasStore } from '../stores/saas'
import { assetUrl } from '../utils/assetUrl.js'
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import * as bootstrap from 'bootstrap';

const props = defineProps({
  embedded: { type: Boolean, default: false }
});

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const saas = useSaasStore();
const modules = useModulesStore();

// Menu lateral (use Bootstrap Icons classes in `icon`)
const nav = [
  { name: 'Pedidos', to: '/orders', icon: 'bi bi-box-seam' },
  { name: 'Relatórios', to: '/reports', icon: 'bi bi-file-earmark-bar-graph', children: [
    { name: 'Histórico de vendas', to: '/sales', icon: 'bi bi-clock-history' },
    { name: 'Frentes de caixa', to: '/reports/cash-fronts', icon: 'bi bi-cash-stack' },
    { name: 'Movimentos de Estoque', to: '/stock-movements', icon: 'bi bi-arrow-repeat' }
  ] },
  { name: 'Clientes', to: '/customers', icon: 'bi bi-person', children: [
    { name: 'Listar clientes', to: '/customers', icon: 'bi bi-people' },
    { name: 'Grupos de clientes', to: '/customer-groups', icon: 'bi bi-people-fill' }
  ] },
  { name: 'Entregadores', to: '/riders', icon: 'bi bi-bicycle', children: [
    { name: 'Lista', to: '/riders', icon: 'bi bi-people' },
    { name: 'Créditos/Débitos', to: '/rider-adjustments', icon: 'bi bi-credit-card' },
  ] },
  { name: 'Marketing', to: '/marketing', icon: 'bi bi-megaphone', children: [
    { name: 'Afiliados', to: '/affiliates', icon: 'bi bi-people-fill' },
    { name: 'Cupons', to: '/coupons', icon: 'bi bi-ticket-perforated' },
    { name: 'Cashback', to: '/settings/cashback', icon: 'bi bi-cash-stack' }
  ] },
  { name: 'Ingredientes', to: '/ingredient-groups', icon: 'bi bi-box', children: [
    { name: 'Grupos de Ingredientes', to: '/ingredient-groups', icon: 'bi bi-list' },
    { name: 'Ingredientes', to: '/ingredients', icon: 'bi bi-basket' },
    { name: 'Fichas Técnicas', to: '/technical-sheets', icon: 'bi bi-file-earmark-text' }
  ] },
    { name: 'Lista de cardápios', to: '/menu/menus', icon: 'bi bi-list' },
 
  
  // Configurações has sub-items
    { name: 'Configurações', to: '/settings/neighborhoods', icon: 'bi bi-gear', children: [
    { name: 'Bairros', to: '/settings/neighborhoods', icon: 'bi bi-geo-alt' },
    { name: 'Integrações', to: '/integrations', icon: 'bi bi-plug' },
    { name: 'Lojas', to: '/settings/stores', icon: 'bi bi-shop-window' },
    { name: 'WhatsApp', to: '/settings/whatsapp', icon: 'bi bi-whatsapp' },
    { name: 'Dev Tools', to: '/settings/devtools', icon: 'bi bi-tools' },
    { name: 'Formas de pagamento', to: '/settings/payment-methods', icon: 'bi bi-credit-card-2-front' },
    { name: 'Usuários', to: '/settings/users', icon: 'bi bi-people' },
    { name: 'Gestão de Acessos', to: '/settings/access-control', icon: 'bi bi-shield-lock' },
  ] },
  // SaaS admin area (parent with CRUD children for SUPER_ADMIN)
  { name: 'SaaS', to: '/saas', icon: 'bi bi-grid-3x3-gap', role: 'SUPER_ADMIN', children: [
    { name: 'Planos', to: '/saas/plans', icon: 'bi bi-list-check' },
    { name: 'Módulos', to: '/saas/modules', icon: 'bi bi-box-seam' },
    { name: 'Empresas', to: '/saas/companies', icon: 'bi bi-building' },
    { name: 'Mensalidades', to: '/saas/billing', icon: 'bi bi-receipt' }
  ] }
];

// collapsed state for parent items with children (true = collapsed)
const parentsCollapsed = reactive({})

// initialize collapsed state for parents based on current route
function initParentsCollapsed(){
  try{
    const p = String(route.path || '');
    // load persisted collapsed state if present
    let stored = {};
    try{ const raw = localStorage.getItem('sidebar-parents-collapsed'); if (raw) stored = JSON.parse(raw); }catch(e){}
    visibleNav.value && visibleNav.value.forEach(item => {
      if (item && Array.isArray(item.children) && item.to) {
        if (Object.prototype.hasOwnProperty.call(stored, item.to)) {
          parentsCollapsed[item.to] = !!stored[item.to];
        } else {
          parentsCollapsed[item.to] = !p.startsWith(item.to);
        }
      }
    });
  }catch(e){}
}

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

onMounted(() => { nextTick(initLocalTooltips); document.addEventListener('click', onDocumentClick); document.addEventListener('keydown', onDocumentKeydown); window.addEventListener('resize', updateIsMobile); updateIsMobile(); nextTick(initParentsCollapsed); });
onMounted(()=>{ loadMenusWidget().catch(()=>{}) })
onMounted(()=>{ saas.fetchMySubscription().catch(()=>{}) })
onUpdated(() => { nextTick(initLocalTooltips); nextTick(initParentsCollapsed); });

// keep parent collapse state in sync when route changes
watch(() => route.path, () => { try{ initParentsCollapsed(); }catch(e){} });

// persist parentsCollapsed to localStorage whenever it changes
watch(parentsCollapsed, () => {
  try{
    const plain = {};
    for (const k in parentsCollapsed) { plain[k] = parentsCollapsed[k]; }
    localStorage.setItem('sidebar-parents-collapsed', JSON.stringify(plain));
  }catch(e){}
}, { deep: true });
onUnmounted(() => { try{ document.removeEventListener('click', onDocumentClick); document.removeEventListener('keydown', onDocumentKeydown); window.removeEventListener('resize', updateIsMobile); }catch(e){} });
 

const isActive = (to) => computed(() => route.path.startsWith(to));

const visibleNav = computed(() => {
  try{
    const role = auth.user && auth.user.role ? String(auth.user.role).toUpperCase() : null;
    // For SaaS Super Admin, show a flat list of admin links (no submenus)
    if (role === 'SUPER_ADMIN') {
      return [
        { name: 'SaaS Dashboard', to: '/saas', icon: 'bi bi-grid-3x3-gap' },
        { name: 'Planos', to: '/saas/plans', icon: 'bi bi-list-check' },
        { name: 'Módulos', to: '/saas/modules', icon: 'bi bi-box-seam' },
        { name: 'Empresas', to: '/saas/companies', icon: 'bi bi-building' },
        { name: 'Mensalidades', to: '/saas/billing', icon: 'bi bi-receipt' }
      ]
    }

    // Default: hide items that explicitly require a role the user doesn't have
    const enabled = (saas.enabledModules || []).map(k => String(k).toLowerCase())
    return nav.map((item) => {
      if(item.role && role !== String(item.role).toUpperCase()) return null;
      const copy = { ...item };
      if(Array.isArray(copy.children)){
        copy.children = copy.children.filter(c => !c.role || String(c.role).toUpperCase() === role);
      }
      // Module gating: hide Riders/nav when module not enabled for this company
      try{
        if (String(copy.to || '').startsWith('/riders') || (copy.children && copy.children.some(c=>String(c.to||'').startsWith('/riders')))){
          const ok = enabled.includes('riders') || enabled.includes('rider') || enabled.includes('motoboy') || enabled.includes('motoboys') || enabled.includes('entregadores')
          if(!ok) return null
        }
        // Hide Affiliates menu if affiliate module disabled
        if (String(copy.to || '').startsWith('/affiliates') || (copy.children && copy.children.some(c=>String(c.to||'').startsWith('/affiliates')))){
          const ok2 = enabled.includes('affiliates') || enabled.includes('affiliate') || enabled.includes('afiliados')
          if(!ok2) return null
        }
      }catch(e){}
      return copy;
    }).filter(Boolean);
  }catch(e){ return nav }
});


const planBadge = computed(() => {
  try {
    if (!saas.subscription || !saas.subscription.plan) return null
    const p = saas.subscription.plan
    const parts = []
    if (p.unlimitedStores) parts.push('Lojas: ilimitado')
    else if (p.storeLimit !== null && p.storeLimit !== undefined) parts.push(`Lojas: ${p.storeLimit}`)
    if (p.unlimitedMenus) parts.push('Cardápios: ilimitado')
    else if (p.menuLimit !== null && p.menuLimit !== undefined) parts.push(`Cardápios: ${p.menuLimit}`)
    return { name: p.name, parts }
  } catch (e) { return null }
})

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

function parseHM(str){
  if(!str) return null
  const m = String(str).match(/^(\d{1,2}):(\d{2})$/)
  if(!m) return null
  return { hh: Number(m[1]), mm: Number(m[2]) }
}

function getTZOffsetMinutes(utcMillis, tz){
  // returns offset in minutes: local = UTC + offsetMinutes
  try{
    const dt = new Date(utcMillis)
    const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    const parts = fmt.formatToParts(dt).reduce((acc, p) => { acc[p.type] = p.value; return acc }, {})
    const localYear = Number(parts.year), localMonth = Number(parts.month), localDay = Number(parts.day)
    const localHour = Number(parts.hour), localMinute = Number(parts.minute)
    // UTC components
    const utcYear = dt.getUTCFullYear(), utcMonth = dt.getUTCMonth()+1, utcDay = dt.getUTCDate()
    const utcHour = dt.getUTCHours(), utcMinute = dt.getUTCMinutes()
    const localTotal = localYear*400000 + localMonth*4000 + localDay // coarse date compare
    const utcTotal = utcYear*400000 + utcMonth*4000 + utcDay
    const dayDiff = (localYear - utcYear)*365 + (localMonth - utcMonth)*31 + (localDay - utcDay)
    // compute minutes difference
    const minutesDiff = dayDiff*24*60 + (localHour - utcHour)*60 + (localMinute - utcMinute)
    return minutesDiff
  }catch(e){ return 0 }
}

function zonedTimeToUtc(year, month, day, hour, minute, tz){
  // iterative solver: find UTC ms corresponding to the given local date/time in tz
  try{
    const localMillisBase = Date.UTC(year, month-1, day, hour, minute, 0)
    let candidate = localMillisBase
    for(let i=0;i<4;i++){
      const offset = getTZOffsetMinutes(candidate, tz)
      const newCandidate = Date.UTC(year, month-1, day, hour, minute, 0) - offset*60000
      if(Math.abs(newCandidate - candidate) < 1000) { candidate = newCandidate; break }
      candidate = newCandidate
    }
    return new Date(candidate)
  }catch(e){ return null }
}

function findNextSchedulePoint(weekly, mode='nextOpen', tz='America/Sao_Paulo'){
  // mode: 'nextOpen' or 'nextClose' - returns a Date in UTC for the instant of that boundary
  try{
    const nowUtc = Date.now()
    // iterate up to 14 days
    for(let add=0; add<14; add++){
      // compute candidate day in timezone by taking 'now' + add days and formatting in tz to extract YMD
      const candUtc = new Date(Date.now() + add*24*60*60*1000)
      const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      const parts = fmt.formatToParts(candUtc).reduce((acc,p)=>{ acc[p.type]=p.value; return acc },{})
      const y = Number(parts.year), mo = Number(parts.month), d = Number(parts.day)
      const entry = (Array.isArray(weekly) && weekly.length) ? weekly[(new Date(y, mo-1, d)).getDay()] : null
      // above lookup by weekday may be off because (new Date(y,mo-1,d)).getDay() uses local timezone, but weekly entries are by weekday numeric 0-6
      // safer: compute weekday from UTC representation in tz: use format with weekday
      const fmtW = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' })
      const partsW = fmtW.formatToParts(candUtc).reduce((acc,p)=>{ acc[p.type]=p.value; return acc },{})
      const weekday = new Date(partsW.year + '-' + partsW.month + '-' + partsW.day).getDay()
      const dayEntry = (Array.isArray(weekly) && weekly[weekday]) ? weekly[weekday] : null
      if(!dayEntry || !dayEntry.enabled) continue
      const from = parseHM(dayEntry.from)
      const to = parseHM(dayEntry.to)
      if(!from || !to) continue
      const startUtc = zonedTimeToUtc(y, mo, d, from.hh, from.mm, tz)
      const endUtc = zonedTimeToUtc(y, mo, d, to.hh, to.mm, tz)
      if(!startUtc || !endUtc) continue
      if(add === 0){
        if(nowUtc < startUtc.getTime()){
          return mode === 'nextOpen' ? startUtc : endUtc
        }
        if(nowUtc >= startUtc.getTime() && nowUtc <= endUtc.getTime()){
          return mode === 'nextOpen' ? startUtc : endUtc
        }
        // otherwise continue
      } else {
        return mode === 'nextOpen' ? startUtc : endUtc
      }
    }
  }catch(e){ console.warn('findNextSchedulePoint error', e) }
  return null
}

function computeOpenStatus(s){
  try{
    // respect forced override while valid
    const forced = s.forceOpen
    try{
      if(forced !== undefined && forced !== null){
        const expires = s.forceOpenExpiresAt ? Date.parse(String(s.forceOpenExpiresAt)) : null
        if(!expires || Date.now() < expires){
          return { isOpen: !!forced, forced: !!forced, source: 'forced', forceOpenExpiresAt: s.forceOpenExpiresAt }
        }
      }
    }catch(e){ }

    // Treat several possible 'always-open' flags for compatibility
    if(s.open24Hours || s.alwaysOpen || s.open24 || s.always_open) return { isOpen: true, forced: undefined, source: 'schedule' }

    const parseHM = (str) => {
      if(!str) return null
      const m = String(str).match(/^(\d{1,2}):(\d{2})$/)
      if(!m) return null
      const hh = Number(m[1]), mm = Number(m[2])
      if(Number.isNaN(hh) || Number.isNaN(mm)) return null
      return { hh, mm }
    }

    const getNowInTz = (tz) => {
      try{
        const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour12: false, hour: '2-digit', minute: '2-digit' })
        if(fmt.formatToParts){
          const parts = fmt.formatToParts(new Date()).reduce((acc,p)=>{ acc[p.type]=p.value; return acc },{})
          const hh = Number(parts.hour || parts.hour12 || 0)
          const mm = Number(parts.minute || 0)
          // weekday fallback: use local Date if not provided in parts
          const weekday = (new Date()).getDay()
          return { hh, mm, weekday }
        }
        const s = fmt.format(new Date()) // fallback
        const [hh, mm] = s.split(':').map(x=>Number(x))
        const wd = new Date().getDay()
        return { hh, mm, weekday: wd }
      }catch(e){ const d = new Date(); return { hh: d.getHours(), mm: d.getMinutes(), weekday: d.getDay() } }
    }

    if(Array.isArray(s.weeklySchedule) && s.weeklySchedule.length){
      const tz = s.timezone || 'America/Sao_Paulo'
      try{
        const now = getNowInTz(tz)
        const today = s.weeklySchedule.find(d => Number(d?.day) === Number(now.weekday))
        if(!today || !today.enabled) return { isOpen: false, forced: undefined, source: 'schedule' }
        const from = parseHM(today.from)
        const to = parseHM(today.to)
        if(!from || !to) return { isOpen: false, forced: undefined, source: 'schedule' }
        const toMinutes = p => p.hh*60 + p.mm
        const nowM = toMinutes(now)
        const fromM = toMinutes(from)
        const toMVal = toMinutes(to)
        if(fromM <= toMVal) return { isOpen: nowM >= fromM && nowM <= toMVal, forced: undefined, source: 'schedule' }
        return { isOpen: (nowM >= fromM) || (nowM <= toMVal), forced: undefined, source: 'schedule' }
      }catch(e){ console.warn('computeOpenStatus weeklySchedule error', e) }
    }

    // fallback to openFrom/openTo single range
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
    // prevent unauthenticated users from attempting to persist forceOpen
    if (!auth.user) {
      try { if (ev && ev.target) ev.target.checked = !ev.target.checked; } catch(e){}
      alert('Faça login para alterar o status do cardápio.');
      return;
    }
    // debug: log auth state and token used for requests
    try { console.debug('[sidebar] onToggleForce auth.user=', auth.user, 'local token=', localStorage.getItem('token')); } catch(e){}
    const newVal = !!ev.target.checked
    const storeId = item.storeId || item._meta?.id || item._meta?.storeId || null
    if(!storeId) throw new Error('Store id not found for this menu')
    // compute an expiration for the forced override so it only lasts until the next scheduled period change
    const meta = item._meta || {}
    let forceOpenExpiresAt = null
    try{
      if(Array.isArray(meta.weeklySchedule) && meta.weeklySchedule.length){
        const tz = meta.timezone || meta.tz || 'America/Sao_Paulo'
        if(newVal){
          // forced open: persist until next scheduled close
          const nextClose = findNextSchedulePoint(meta.weeklySchedule, 'nextClose', tz)
          if(nextClose) forceOpenExpiresAt = nextClose.toISOString()
        } else {
          // forced close: persist until next scheduled open
          const nextOpen = findNextSchedulePoint(meta.weeklySchedule, 'nextOpen', tz)
          if(nextOpen) forceOpenExpiresAt = nextOpen.toISOString()
        }
      }
    }catch(e){ /* ignore calculation errors */ }
    const payload = { menuId: item.id, forceOpen: newVal }
    if(forceOpenExpiresAt) payload.forceOpenExpiresAt = forceOpenExpiresAt
    try {
      console.debug('[sidebar] persisting forceOpen payload=', payload)
      await api.post(`/stores/${storeId}/settings/upload`, payload)
      try { window.dispatchEvent(new CustomEvent('store:settings-updated', { detail: { storeId } })); } catch(e){}
      // also write a localStorage key so other browser tabs/windows detect the update via the storage event
      try { localStorage.setItem(`store_settings_updated_${storeId}`, String(Date.now())); } catch(e){}
    } catch (err) {
      // rethrow to be caught by outer catch
      throw err
    }
    item._meta = item._meta || {}
    item._meta.forceOpen = newVal
    if(forceOpenExpiresAt) item._meta.forceOpenExpiresAt = forceOpenExpiresAt
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
  <aside ref="asideEl" v-if="showSidebar" :class="[embedded ? 'd-flex flex-column' : 'd-none d-md-flex flex-column border-end', { 'sidebar-mini': mini && !embedded }]" :style="embedded ? {} : (mini ? { width: '72px', minHeight: '100vh' } : { width: '240px', minHeight: '100vh' })">
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
        <div class="ms-2 text-end">
          <div v-if="planBadge && planBadge.name && !mini" class="small text-white">
            <div>{{ planBadge.name }}</div>
            <div class="small text-light-50" v-if="planBadge.parts && planBadge.parts.length">
              <span v-for="(p,i) in planBadge.parts" :key="i" class="badge bg-white bg-opacity-10 text-white me-1">{{ p }}</span>
            </div>
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
            <button ref="menuToggleBtn" type="button" class="btn btn-sm btn-light d-flex  justify-content-between align-items-center text-dark w-100 p-2" @click="toggleMenusDropdown" :aria-expanded="dropdownOpen">
              <span class="small d-flex">
          <div class="me-2 small text-muted" v-show="!mini">Cardápios</div>
          
              (
                <template v-if="openCount > 0">{{ openCount }} {{ openCount === 1 ? 'aberta' : 'abertas' }}</template>
                <template v-else>{{ closedCount }} {{ closedCount === 1 ? 'fechada' : 'fechadas' }}</template>)
              </span>
              <i  class="bi bi-chevron-down ms-2 chevron" aria-hidden="true" style=""></i>
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
                  <input class="form-check-input" type="checkbox" role="switch"
                    :checked="m._status && m._status.forced !== undefined ? m._status.forced : false"
                    @change="onToggleForce(m, $event)"
                    :disabled="!auth.user"
                    :title="auth.user ? '' : 'Faça login para alterar'" />
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
                  <input class="form-check-input" type="checkbox" role="switch"
                    :checked="m._status && m._status.forced !== undefined ? m._status.forced : false"
                    @change="onToggleForce(m, $event)"
                    :disabled="!auth.user"
                    :title="auth.user ? '' : 'Faça login para alterar'" />
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
        <li v-for="item in visibleNav" :key="item.to" class="nav-item mb-1">
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
      <div style="background:#1e293b; border:1px solid rgba(255,255,255,0.08); padding:8px; border-radius:6px; min-width:180px; box-shadow:0 6px 18px rgba(0,0,0,0.18)">
        <ul class="nav flex-column">
          <li v-for="p in visibleNav.filter(n=>n.to===openSub)" :key="p.to">
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
  background-color: rgba(255,255,255,0.06);
  color: #fff;
}
.parent-link { cursor: pointer; }
.child-link { font-size: .95rem; }
.child-link i { font-size: 1rem }

/* diagonal gradient background: dark slate that harmonises with the green brand */
aside { background-color: #1e293b; background-image: linear-gradient(180deg, #1e293b 0%, #0f172a 100%); }

/* active state: green brand accent */
.nav-link.active { background-color: rgba(139,191,98,0.18); font-weight:600; border-left: 3px solid #8bbf62; }

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
  background: linear-gradient(180deg, #334155 0%, #1e293b 100%);
  color: #fff;
  border-radius: 10px;
  min-width: 170px;
  max-width: 260px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.22);
  border: 1px solid rgba(255,255,255,0.08);
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
.btn-toggle-mini { border-color: rgba(255,255,255,0.15); color: #fff;  margin-right: -35px;
  background-color: #334155;}
.btn-toggle-mini:hover { background-color: #475569; border-color: #475569; color: #fff; }
.btn-toggle-mini i { font-size: 0.92rem }

/* Stores widget styles */
.stores-widget { background: rgba(255,255,255,0.03); }
.store-thumb { width:28px; height:28px; object-fit:cover; border-radius:6px }
.store-item { border-radius:6px; padding-left:6px; padding-right:6px }
.store-name { font-weight:600; font-size:0.92rem }
.store-sub { margin-top:-2px }
.toggle-open { width:36px; height:22px }

.nav-link{font-size:0.8rem}
/* Smooth labels opacity transition when expanding/collapsing */
.nav-link span { transition: opacity 180ms ease; }
.header-wrap { transition: padding 220ms ease; }
/* Ensure sidebar never exceeds viewport height and make nav scrollable with themed scrollbar */
aside { max-height: 100vh; height: 100vh; display: flex; flex-direction: column; }
/* make the main nav area scrollable */
aside nav { overflow-y: auto; -webkit-overflow-scrolling: touch; }

/* Themed custom scrollbar for WebKit browsers */
aside nav::-webkit-scrollbar { width: 10px; }
aside nav::-webkit-scrollbar-track { background: transparent; }
aside nav::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 10px; border: 2px solid transparent; background-clip: padding-box; }
aside nav::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.16); }

/* Firefox scrollbar styling */
aside nav { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent; }
</style>