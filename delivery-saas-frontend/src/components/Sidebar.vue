<script setup>
import { computed, reactive, ref, onMounted, onUpdated, nextTick, onUnmounted, watch } from 'vue';
import { useModulesStore } from '../stores/modules'
import api from '../api'
import { useSaasStore } from '../stores/saas'
import { buildVisibleNav } from '../utils/navVisibility.js'
import { assetUrl } from '../utils/assetUrl.js'
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import * as bootstrap from 'bootstrap';
import { useAiCreditsStore } from '../stores/aiCredits.js';
import { useAddOnStoreStore } from '../stores/addOnStore';
import { useInboxStore } from '@/stores/inbox';

const props = defineProps({
  embedded: { type: Boolean, default: false }
});

      const route = useRoute();
      const router = useRouter();
    const auth = useAuthStore();
const saas = useSaasStore();
const modules = useModulesStore();
const addOnStore = useAddOnStoreStore();
const inboxStore = useInboxStore();

// user helpers
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

// Menu lateral (shared nav structure)
import { nav } from '../config/nav.js'

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
    // handle quickMenu (three-dots) dropdown similarly
    try{
      if (quickMenuOpen.value) {
        const btn = quickMenuBtn.value
        const dd = quickMenuMenu.value
        if (dd && (dd === ev.target || dd.contains && dd.contains(ev.target))) {
          // clicked inside quick menu — keep open
        } else if (btn && (btn === ev.target || btn.contains && btn.contains(ev.target))) {
          // clicked the quick toggle — let its handler manage
        } else {
          quickMenuOpen.value = false
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
  const newState = !parentsCollapsed[to]
  // when opening a parent (newState === false), collapse all other parents
  if (newState === false) {
    for (const k in parentsCollapsed) {
      if (k !== to) parentsCollapsed[k] = true
    }
  }
  parentsCollapsed[to] = newState
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

const visibleNav = computed(() => buildVisibleNav(auth.user, saas.enabledModules, nav));

// Offcanvas mega-menu (template "Menu lateral"): split direct items vs. groups
const primaryItems = computed(() => (visibleNav.value || []).filter(i => !(i.children && i.children.length)));
const groupItems = computed(() => (visibleNav.value || []).filter(i => i.children && i.children.length));

// Distribute the primary block + groups across exactly 3 columns, in source
// order, balanced by approximate height — so the menu fills the columns and
// runs up to the third without leaving large gaps (no balanced multicol orphans).
const navColumns = computed(() => {
  const blocks = [];
  if (primaryItems.value.length) {
    blocks.push({ type: 'primary', items: primaryItems.value, w: primaryItems.value.length + 1 });
  }
  for (const g of groupItems.value) {
    blocks.push({ type: 'group', group: g, w: 1 + (g.children?.length || 0) });
  }
  const cols = [[], [], []];
  const colW = [0, 0, 0];
  const total = blocks.reduce((s, b) => s + b.w, 0);
  const target = total / 3 || 1;
  let ci = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const colsLeft = 2 - ci;
    const remaining = blocks.length - i;
    // advance to next column when the current one is "full enough" and there
    // are still enough blocks left to fill the remaining columns
    if (ci < 2 && colW[ci] > 0 && colW[ci] + b.w > target * 1.15 && remaining > colsLeft) ci++;
    cols[ci].push(b);
    colW[ci] += b.w;
  }
  return cols;
});

function isLinkActive(to) {
  if (!to) return false;
  const p = route.path || '';
  return p === to || p.startsWith(to + '/');
}

// Material Symbols (Rounded) icon per route — keeps the offcanvas faithful to
// the template while the rest of the app continues to use Bootstrap Icons.
const MS_ICONS = {
  // primary
  '/orders': 'receipt_long', '/menu/menus': 'restaurant_menu', '/customers': 'groups',
  // Atendimento
  '/inbox': 'support_agent', '/inbox/quick-replies': 'quickreply', '/inbox/automation': 'smart_toy',
  // Entregadores
  '/riders': 'sports_motorsports', '/rider-adjustments': 'account_balance_wallet',
  '/reports/riders-dashboard': 'dashboard', '/reports/rider-ranking': 'emoji_events',
  '/settings/rider-goals': 'flag', '/reports/rider-checkins': 'where_to_vote',
  '/riders/map': 'map', '/settings/rider-shifts': 'schedule',
  '/settings/rider-bonus-rules': 'redeem', '/settings/rider-tracking': 'settings',
  // Relatórios
  '/reports': 'bar_chart', '/sales': 'history', '/reports/revenue': 'payments',
  '/reports/cash-fronts': 'point_of_sale', '/reports/products': 'trending_up',
  '/reports/menu-performance': 'insights', '/relatorios/nfe-emissoes': 'description',
  '/stock-movements': 'sync_alt',
  // Marketing
  '/marketing': 'campaign', '/marketing/campaigns': 'ads_click',
  '/marketing/menu-notifications': 'notifications_active', '/marketing/studio-ia': 'auto_awesome',
  '/affiliates': 'handshake', '/coupons': 'confirmation_number', '/settings/cashback': 'savings',
  // Ingredientes e Estoque
  '/ingredient-groups': 'category', '/ingredients': 'nutrition', '/technical-sheets': 'menu_book',
  '/stock/purchase-imports': 'shopping_cart_checkout', '/stock/suppliers': 'local_shipping',
  // Financeiro
  '/financial/health': 'monitor_heart', '/financial/dashboard': 'dashboard',
  '/financial/transactions': 'request_quote', '/financial/cash-flow': 'show_chart',
  '/financial/dre': 'summarize', '/financial/accounts': 'account_balance',
  '/financial/ofx': 'done_all', '/financial/cost-centers': 'pie_chart',
  '/financial/recurring': 'event_repeat', '/financial/payment-methods': 'credit_card',
  '/financial/gateways': 'percent', '/financial/settlements': 'storefront',
  // Configurações
  '/settings/general': 'tune', '/settings/neighborhoods': 'location_on',
  '/settings/dados-fiscais': 'gavel', '/integrations': 'extension',
  '/settings/payment-methods': 'credit_card', '/settings/stores': 'storefront',
  '/settings/users': 'manage_accounts',
  // SaaS
  '/saas/plans': 'list_alt', '/saas/modules': 'widgets', '/saas/companies': 'apartment',
  '/saas/gateway': 'payment', '/saas/whatsapp-config': 'chat', '/saas/evolution-config': 'hub',
};
// Group-header icons (parents with children)
const MS_GROUP_ICONS = {
  '/inbox': 'support_agent', '/riders': 'sports_motorsports', '/reports': 'bar_chart',
  '/marketing': 'campaign', '/ingredient-groups': 'inventory_2', '/financial/health': 'account_balance',
  '/settings/general': 'settings', '/saas': 'grid_view',
};
function msIcon(to) {
  return MS_ICONS[to] || 'chevron_right';
}
function msGroupIcon(to) {
  return MS_GROUP_ICONS[to] || MS_ICONS[to] || 'folder';
}


const planBadge = computed(() => {
  try {
    if (!saas.subscription || !saas.subscription.plan) return null
    const p = saas.subscription.plan
    return { name: p.name, plan: p }
  } catch (e) { return null }
})

const storeCount = computed(() => new Set((menusList.value || []).map(m => m.storeId).filter(Boolean)).size)

// menus widget state (cardápios are the storefronts)
const menusList = ref([])
// dropdown state for menus control
const dropdownOpen = ref(false)
const menuToggleBtn = ref(null)
const menusDropdownEl = ref(null)
// quick menu (three-dots) state
const quickMenuOpen = ref(false)
const quickMenuBtn = ref(null)
const quickMenuMenu = ref(null)

// AI credits shown inside the user dropdown
const aiCredits = useAiCreditsStore()
watch(quickMenuOpen, (open) => {
  if (open && aiCredits.balance === null) aiCredits.fetch().catch(() => {})
})

// effective open state of a menu: manual override wins over schedule
function isMenuOpen(m) {
  return (m._meta && m._meta.forceOpen !== undefined && m._meta.forceOpen !== null)
    ? !!m._meta.forceOpen
    : !!(m._status && m._status.isOpen)
}
const openMenusCount = computed(() => (menusList.value || []).filter(isMenuOpen).length)

function menuInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}
const MENU_LOGO_COLORS = ['#3a7d2c', '#2b2b2b', '#d9942b', '#cf3b34', '#b5392f', '#0d6f99', '#6b4fa0']
function menuColor(name) {
  let h = 0
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return MENU_LOGO_COLORS[h % MENU_LOGO_COLORS.length]
}

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
        // Merge: store settings < menu-specific settings < DB menu fields (open24Hours, weeklySchedule)
        const combined = { ...(merged || {}), ...(menuMeta || {}), open24Hours: m.open24Hours, weeklySchedule: m.weeklySchedule || (menuMeta || {}).weeklySchedule || (merged || {}).weeklySchedule }
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

// Dispara o evento global que LuccaChat.vue está escutando (substitui o FAB
// flutuante que existia antes). Usado pelo atalho de ajuda no topbar.
function openLuccaAssistant() {
  try {
    window.dispatchEvent(new CustomEvent('open-lucca'));
  } catch (e) { /* defensive — ignora se window indisponível */ }
}

// UI state for off-canvas, quick shortcuts and add-link modal
const offCanvasOpen = ref(false);
const SHORTCUTS_KEY = 'sidebar-quick-shortcuts';
const defaultShortcuts = [
  { icon: 'bi bi-lightning-charge', title: 'Atalho 1', to: null },
  { icon: 'bi bi-star', title: 'Atalho 2', to: null },
  { icon: 'bi bi-gear', title: 'Atalho 3', to: null },
  { icon: 'bi bi-plus-circle', title: 'Atalho 4', to: null },
  { icon: 'bi bi-plus-circle', title: 'Atalho 5', to: null },
];
const quickShortcuts = ref([]);
const showAddLinkModal = ref(false);
const showManageShortcuts = ref(false);
const manageSelected = ref('');
const manageList = ref([]);

function openManageShortcuts(){
  // prefill modal with current configured shortcuts so user edits persist
  try{
    manageList.value = (quickShortcuts.value || []).filter(s => s && s.to).map(s => ({ icon: s.icon || 'bi bi-link', title: s.title || 'Atalho', to: s.to }));
  }catch(e){ manageList.value = [] }
  manageSelected.value = '';
  showManageShortcuts.value = true;
}

function addSelectedToManage(){
  try{
    // prevent adding beyond the 5-link limit
    if((manageList.value || []).length >= 5) return;
    if(!manageSelected.value) return;
    const opt = (menuOptions.value || []).find(m => m.to === manageSelected.value) || { name: manageSelected.value, to: manageSelected.value, icon: 'bi bi-link' };
    manageList.value.push({ icon: opt.icon || 'bi bi-link', title: opt.name || 'Atalho', to: opt.to || manageSelected.value });
    manageSelected.value = '';
  }catch(e){ console.error('addSelectedToManage', e) }
}

function removeFromManage(idx){ if(typeof idx === 'number') manageList.value.splice(idx,1); }

function saveManageList(){
  try{
    const items = manageList.value.slice(0,5).map(s => ({ icon: s.icon || 'bi bi-link', title: s.title || 'Atalho', to: s.to || null, action: null }));
    while(items.length < 5) items.push({ icon: 'bi bi-plus-circle', title: 'Atalho', to: null, action: null });
    quickShortcuts.value = items;
    attachShortcutActions();
    persistShortcuts();
    showManageShortcuts.value = false;
  }catch(e){ console.error('saveManageList', e) }
}

function loadShortcuts(){
  try{
    const raw = localStorage.getItem(SHORTCUTS_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      // ensure it's array of length 5
      const arr = Array.isArray(parsed) ? parsed.slice(0,5) : [];
      while(arr.length < 5) arr.push({ icon: 'bi bi-plus-circle', title: 'Atalho', to: null });
      quickShortcuts.value = arr.map(s => ({ icon: s.icon || 'bi bi-link', title: s.title || 'Atalho', to: s.to || null, action: null }));
    } else {
      quickShortcuts.value = defaultShortcuts.map(s => ({ ...s, action: null }));
    }
  }catch(e){ quickShortcuts.value = defaultShortcuts.map(s => ({ ...s, action: null })); }
  // attach actions
  attachShortcutActions();
}

function persistShortcuts(){
  try{
    const toStore = quickShortcuts.value.map(s => ({ icon: s.icon, title: s.title, to: s.to || null }));
    localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(toStore));
  }catch(e){ console.warn('Failed to persist shortcuts', e) }
}

function attachShortcutActions(){
  try{
    quickShortcuts.value.forEach(s => {
      s.action = s.to ? (() => { try{ router.push(s.to) }catch(e){} }) : null;
    });
  }catch(e){}
}

function shortcutClick(s){
  if(s && s.to){ try{ router.push(s.to) } catch(e){} }
}

function addShortcutFromMenu(item){
  try{
    // item: { name, to, icon }
    const idx = quickShortcuts.value.findIndex(s => !s.to);
    const targetIdx = idx >= 0 ? idx : 0; // overwrite first if none empty
    quickShortcuts.value[targetIdx] = { icon: item.icon || 'bi bi-link', title: item.name || 'Atalho', to: item.to || null, action: null };
    attachShortcutActions();
    persistShortcuts();
    showAddLinkModal.value = false;
  }catch(e){ console.error('addShortcutFromMenu failed', e) }
}

// persist when shortcuts change
watch(quickShortcuts, () => persistShortcuts(), { deep: true });

// load initially
onMounted(() => { loadShortcuts(); });

// Edit/remove shortcuts UI state
const editingIndex = ref(-1);
const editForm = ref({ icon: '', title: '', to: '' });

function openEditModal(index){
  const s = quickShortcuts.value[index] || { icon: '', title: '', to: null };
  editingIndex.value = index;
  editForm.value = { icon: s.icon || '', title: s.title || '', to: s.to || '' };
}

function saveEditedShortcut(){
  try{
    const idx = Number(editingIndex.value);
    if(idx < 0 || idx >= quickShortcuts.value.length) return;
    quickShortcuts.value[idx] = { icon: editForm.value.icon || 'bi bi-link', title: editForm.value.title || 'Atalho', to: editForm.value.to || null, action: null };
    attachShortcutActions();
    persistShortcuts();
    editingIndex.value = -1;
  }catch(e){ console.error('saveEditedShortcut', e) }
}

function addIconNow(){
  try{
    const idx = Number(editingIndex.value);
    if(idx < 0 || idx >= quickShortcuts.value.length) return;
    // apply the selected icon immediately to the shortcut (keeps title/to unchanged)
    const cur = quickShortcuts.value[idx] || { title: 'Atalho', to: null };
    quickShortcuts.value[idx] = { icon: editForm.value.icon || 'bi bi-link', title: cur.title || editForm.value.title || 'Atalho', to: cur.to || editForm.value.to || null, action: null };
    attachShortcutActions();
    persistShortcuts();
  }catch(e){ console.error('addIconNow', e) }
}

function removeShortcut(idx){
  try{
    if(idx < 0 || idx >= quickShortcuts.value.length) return;
    quickShortcuts.value[idx] = { icon: 'bi bi-plus-circle', title: 'Atalho', to: null, action: null };
    attachShortcutActions();
    persistShortcuts();
  }catch(e){ console.error('removeShortcut', e) }
}

// Icon selection options and menu options for edit modal
const ICON_OPTIONS = [
  'bi bi-house', 'bi bi-box-seam', 'bi bi-file-earmark', 'bi bi-person', 'bi bi-bicycle',
  'bi bi-megaphone', 'bi bi-gear', 'bi bi-list', 'bi bi-star', 'bi bi-plus-circle', 'bi bi-lightning-charge'
];

const menuOptions = computed(() => {
  try{
    const out = [];
    (visibleNav.value || []).forEach(i => {
      out.push({ name: i.name, to: i.to, icon: i.icon });
      if(Array.isArray(i.children)){
        i.children.forEach(c => out.push({ name: (i.name + ' → ' + c.name), to: c.to, icon: c.icon }));
      }
    });
    return out;
  }catch(e){ return [] }
});

const hasAnyShortcut = computed(() => {
  try{ return (quickShortcuts.value || []).some(s => !!s && !!s.to); }catch(e){ return false }
});

function selectMenuOption(opt){
  try{
    if(!opt) return;
    editForm.value.to = opt.to || '';
    // if title empty or placeholder, fill with selected name
    if(!editForm.value.title || editForm.value.title.startsWith('Atalho')) editForm.value.title = opt.name || '';
    if(!editForm.value.icon) editForm.value.icon = opt.icon || '';
  }catch(e){}
}
</script>
<template>
  <div v-if="showSidebar">
    <header class="top-navbar d-none d-sm-flex align-items-center justify-content-between px-3 py-2 w-100">
      <div class="d-flex align-items-center">
        <button class="btn me-3" @click="offCanvasOpen = true" aria-label="Abrir menu">
          <i class="bi bi-list" style="font-size:2rem"></i>
        </button>
          <div class="d-flex align-items-center header-content">
          <i v-if="mini" class="bi bi-shop logo-compact-icon" aria-hidden="true" :title="'Delivery SaaS'" aria-label="Delivery SaaS"></i>
          <div v-else>
            <img src="/chefiz.png" alt="" class="log">
          </div>
        </div>
      </div>

      <div class="d-flex align-items-center">
        <router-link v-if="inboxStore.unreadTotal > 0" to="/inbox" class="btn btn-light p-2 position-relative me-2 shortcut-btn" title="Mensagens não lidas" aria-label="Mensagens não lidas">
          <i class="bi bi-chat-dots" style="font-size:1.1rem;"></i>
          <span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger" style="font-size:0.6rem;min-width:18px">
            {{ inboxStore.unreadTotal > 99 ? '99+' : inboxStore.unreadTotal }}
          </span>
        </router-link>
        <div v-if="!saas.isCardapioSimplesOnly" class="quick-shortcuts d-none d-sm-flex align-items-center justify-content-end">
          <template v-if="!hasAnyShortcut">
            <button class="btn btn-light p-2 shortcut-btn" title="Configurar atalhos" @click.prevent="openManageShortcuts()">
              <i class="bi bi-plus" style="font-size:1.1rem;"></i>
            </button>
          </template>
          <template v-else>
            <div v-for="(shortcut, idx) in quickShortcuts.slice().reverse()" :key="idx" class="position-relative d-inline-block mx-1">
              <template v-if="shortcut && shortcut.to">
                <button class="btn btn-light p-2 shortcut-btn" :title="shortcut.title" @click.prevent="shortcutClick(shortcut)">
                  <i :class="shortcut.icon" style="font-size:1.3rem;"></i>
                </button>
              </template>
              <template v-else>
                <!-- empty slot placeholder (no per-slot add button to avoid duplicate edit icons) -->
                <span style="display:inline-block;width:40px;height:40px;margin-right:0.25rem"></span>
              </template>
            </div>
            <button v-if="hasAnyShortcut" class="shortcut-edit-fixed btn btn-light p-2 ms-2" title="Configurar atalhos" @click.prevent="openManageShortcuts()" aria-label="Configurar atalhos">
              <i class="bi bi-plus" style="font-size:1.1rem;"></i>
            </button>
          </template>
        </div>

        <!-- Atalho de ajuda — abre o assistente (Lucca) via evento window
             capturado por LuccaChat. Mesmo estilo dos shortcuts do topbar. -->
        <button
          type="button"
          class="btn btn-light p-2 shortcut-btn ms-2 d-none d-sm-inline-flex align-items-center justify-content-center"
          title="Falar com o Lucca (assistente)"
          aria-label="Abrir assistente Lucca"
          @click.prevent="openLuccaAssistant()"
        >
          <i class="bi bi-question-circle" style="font-size:1.3rem;"></i>
        </button>

        <div class="d-none d-sm-block dropdown ms-3">
          <button ref="quickMenuBtn" class="btn btn-light dropdown-toggle" type="button" id="quickMenuDropdown" @click.prevent="quickMenuOpen = !quickMenuOpen" :aria-expanded="quickMenuOpen">
           <div v-if="auth.user" class="d-flex align-items-center user-info" style="gap: 16px; padding: 1px 4px;">
          <div class="d-flex">
            <div class="user-initials rounded-circle d-flex align-items-center justify-content-center me-2">{{ userInitials }}</div>
          <div class="user-text mr-3">
            <div class="user-name">{{ userName }}</div>
            <div class="user-role small text-muted">{{ userRoleLabel }}</div>
          </div>
          </div>
          <i class="bi bi-chevron-down"></i>
        </div>
          </button>
          <div v-if="quickMenuOpen" ref="quickMenuMenu" class="user-menu" aria-labelledby="quickMenuDropdown">
            <template v-if="!saas.isCardapioSimplesOnly">
              <div class="um-head">
                <span class="um-label">Minhas lojas</span>
                <span class="um-count">{{ openMenusCount }} aberta{{ openMenusCount === 1 ? '' : 's' }}</span>
              </div>
              <div class="um-stores">
                <div v-if="(menusList || []).length === 0" class="um-empty">Nenhum cardápio disponível</div>
                <div v-for="m in menusList" :key="m.id" class="store-row" :class="{ 'is-open': isMenuOpen(m) }">
                  <img v-if="m._thumb" :src="m._thumb" alt="" class="store-logo store-logo-img" />
                  <span v-else class="store-logo" :style="{ background: menuColor(m.name) }">{{ menuInitials(m.name) }}</span>
                  <div class="store-meta">
                    <div class="store-name">{{ m.name }}</div>
                    <div class="store-status"><span class="st-dot"></span>{{ isMenuOpen(m) ? 'Aberto' : 'Fechado' }}</div>
                  </div>
                  <button
                    class="switch"
                    :class="{ on: isMenuOpen(m) }"
                    type="button"
                    role="switch"
                    :aria-checked="isMenuOpen(m)"
                    :aria-label="`Alternar ${m.name}`"
                    @click="onToggleForce(m, { target: { checked: !isMenuOpen(m) } })"
                  >
                    <span class="knob"></span>
                  </button>
                </div>
              </div>
            </template>

            <div v-if="auth.user?.companyId" class="um-credits">
              <div class="cr-top">
                <span class="cr-title"><i class="bi bi-stars"></i> Créditos IA</span>
                <span class="cr-count">{{ aiCredits.balance ?? '—' }} <span class="cr-max">/ {{ aiCredits.monthlyLimit }}</span></span>
              </div>
              <div class="cr-bar"><span :style="{ width: aiCredits.percent() + '%' }"></span></div>
              <div class="cr-foot">
                <span v-if="aiCredits.nextResetFormatted()" class="cr-renew"><i class="bi bi-clock"></i> Renova em {{ aiCredits.nextResetFormatted() }}</span>
                <span v-else></span>
                <button class="cr-buy" type="button" @click="quickMenuOpen = false; router.push('/store/credits')">Comprar créditos</button>
              </div>
            </div>

            <div class="um-links">
              <router-link to="/billing" class="um-link" @click="quickMenuOpen = false">
                <i class="bi bi-receipt"></i> <span>Cobranças</span>
                <span v-if="addOnStore.pendingInvoiceCount" class="um-badge">{{ addOnStore.pendingInvoiceCount }}</span>
              </router-link>
              <a href="#" class="um-link um-logout" @click.prevent="logout()">
                <i class="bi bi-box-arrow-right"></i> <span>Sair</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </header>

    <!-- Off-canvas mega-menu (template "Menu lateral") -->
    <div v-if="offCanvasOpen" class="mega-scrim" @click.self="offCanvasOpen = false">
      <aside class="mega-oc" aria-label="Menu principal">
        <!-- Header: logo atual + subtítulo + fechar -->
        <div class="oc-head">
          <div class="oc-brand">
            <img src="/chefiz.png" alt="Chefiz" class="oc-logo-img">
            <div class="oc-sub">Painel do restaurante</div>
          </div>
          <button class="oc-close" @click="offCanvasOpen = false" aria-label="Fechar menu">
            <span class="material-symbols-rounded">close</span>
          </button>
        </div>

        <!-- Body: itens primários + grupos distribuídos em 3 colunas -->
        <nav class="oc-body">
          <div v-for="(col, ci) in navColumns" :key="ci" class="oc-col">
            <template v-for="(block, bi) in col" :key="bi">
              <!-- Bloco de itens diretos (sem filhos) em destaque -->
              <div v-if="block.type === 'primary'" class="oc-primary">
                <router-link
                  v-for="item in block.items"
                  :key="item.to"
                  :to="item.to || '/store'"
                  class="prim"
                  :class="{ 'is-locked': item.locked }"
                  @click="offCanvasOpen = false"
                >
                  <span class="prim-ic"><span class="material-symbols-rounded">{{ msIcon(item.to) }}</span></span>
                  <span class="prim-label">{{ item.name }}</span>
                  <span v-if="item.locked" class="lock-tag"><span class="material-symbols-rounded">lock</span> Upgrade</span>
                  <span v-else-if="item.to === '/billing' && addOnStore.pendingInvoiceCount" class="lnk-badge danger">{{ addOnStore.pendingInvoiceCount }}</span>
                  <span v-else-if="item.to === '/inbox' && inboxStore.unreadTotal" class="lnk-badge">{{ inboxStore.unreadTotal }}</span>
                  <span v-else class="prim-chev material-symbols-rounded">chevron_right</span>
                </router-link>
              </div>

              <!-- Grupo (item com filhos) -->
              <div v-else class="grp">
                <div class="grp-head">
                  <span class="grp-ic"><span class="material-symbols-rounded">{{ msGroupIcon(block.group.to) }}</span></span>
                  <span class="grp-title">{{ block.group.name }}</span>
                  <span class="grp-rule"></span>
                </div>
                <router-link
                  v-for="child in block.group.children"
                  :key="child.to"
                  :to="child.to || '/store'"
                  class="lnk"
                  :class="{ active: isLinkActive(child.to), 'is-locked': child.locked }"
                  @click="offCanvasOpen = false"
                >
                  <span class="material-symbols-rounded">{{ msIcon(child.to) }}</span>
                  <span class="lnk-label">{{ child.name }}</span>
                  <span v-if="child.locked" class="lock-tag"><span class="material-symbols-rounded">lock</span> Upgrade</span>
                </router-link>
              </div>
            </template>
          </div>
        </nav>

        <!-- Footer: usuário + sair -->
        <div class="oc-foot">
          <div class="oc-user">
            <span class="oc-av">{{ userInitials }}</span>
            <div class="oc-user-meta">
              <div class="oc-uname">{{ userName }}</div>
              <div class="oc-urole">{{ userRoleLabel }}</div>
            </div>
          </div>
          <button class="oc-logout" @click="logout()">
            <span class="material-symbols-rounded">logout</span> Sair
          </button>
        </div>
      </aside>
    </div>

    <!-- Modal para adicionar link (placeholder) -->
    <div v-if="showAddLinkModal" class="modal-backdrop-custom" @click.self="showAddLinkModal = false">
      <div class="modal-dialog-custom">
        <div class="modal-content p-4">
          <h5 class="mb-3">Escolher link do menu principal</h5>
          <p class="text-muted">Selecione um item do menu para adicioná-lo aos atalhos rápidos.</p>
          <ul class="list-unstyled">
            <li v-for="item in visibleNav" :key="item.to" class="mb-2">
              <button class="btn btn-sm btn-outline-secondary w-100 text-start" @click.prevent="addShortcutFromMenu(item)">
                <i :class="item.icon + ' me-2'"></i>{{ item.name }}
              </button>
            </li>
          </ul>
          <div class="text-end">
            <button class="btn btn-secondary" @click="showAddLinkModal = false">Fechar</button>
          </div>
        </div>
      </div>
    </div>
  </div>
  
    <!-- removed global fixed edit button (moved inline next to shortcuts) -->

    <!-- Modal de gerenciar atalhos -->
    <div v-if="showManageShortcuts" class="modal-backdrop-custom" @click.self="showManageShortcuts = false">
      <div class="modal-dialog-custom">
        <div class="modal-content p-4">
          <h5 class="mb-3">Gerenciar atalhos</h5>

          <div class="mb-3 d-flex gap-2 flex-column">
            <div class="d-flex gap-2 flex-row w-100">
            <select class="form-select" v-model="manageSelected" :disabled="manageList.length >= 5">
              <option value="">Selecionar link</option>
              <option v-for="opt in menuOptions" :key="opt.to" :value="opt.to">{{ opt.name }} — {{ opt.to }}</option>
            </select>
            <button class="btn btn-primary" @click.prevent="addSelectedToManage" :disabled="manageList.length >= 5">Adicionar</button>
            </div>

            <span v-if="manageList.length >= 5" class="ms-2 text-muted small align-self-center w-100">Máximo 5</span>
          </div>

          <ul class="list-group mb-3">
            <li v-for="(m, idx) in manageList" :key="idx" class="list-group-item d-flex justify-content-between align-items-center">
              <div><i :class="m.icon + ' me-2'"></i>{{ m.title }} <small class="text-muted">({{ m.to }})</small></div>
              <button class="btn btn-sm btn-outline-danger" @click.prevent="removeFromManage(idx)">Remover</button>
            </li>
            <li v-if="manageList.length === 0" class="list-group-item text-muted">Nenhum link adicionado.</li>
          </ul>

          <div class="d-flex justify-content-end gap-2">
            <button class="btn btn-secondary" @click="showManageShortcuts = false">Cancelar</button>
            <button class="btn btn-primary" @click.prevent="saveManageList">Salvar</button>
          </div>
        </div>
      </div>
    </div>
</template>


<style scoped>
*, html {
  transition: all 0.3s ease;
}
.log, .logo-neg {
    max-width: 120px;
}
.nav-link {
  transition: background-color 0.12s, color 0.12s;
  color: #000435;
}
.nav-link i { color: #000435 !important}
.nav-link.title{
  font-size: 1rem;
    font-weight: bold;
    color: #000435;
    border-radius: 50px !important;
}
.nav-link:hover, .nav-link:focus {
  color: #89D136;
}
.parent-link { cursor: pointer; }
.nav-direct-link {
  border-left: 3px solid #89D136;
  padding-left: 0.65rem !important;
  border-radius: 0 6px 6px 0;
  background: rgba(137, 209, 54, 0.06);
}
.nav-direct-link:hover, .nav-direct-link:focus {
  background: rgba(137, 209, 54, 0.15) !important;
}
.nav-pedidos-link {
  background: #89D136 !important;
  color: #000435 !important;
  border-left: none !important;
  border-radius: 50px !important;
  padding: 0.5rem 1rem !important;
  font-weight: 700 !important;
  box-shadow: 0 3px 10px rgba(137, 209, 54, 0.4);
  margin-bottom: 0.25rem;
}
.nav-pedidos-link i { color: #000435 !important; }
.nav-pedidos-link:hover, .nav-pedidos-link:focus {
  background: #7bc22e !important;
  box-shadow: 0 4px 14px rgba(137, 209, 54, 0.55) !important;
  color: #000435 !important;
}
.nav-pedidos-link.active {
  background: #6aaa28 !important;
  color: #000435 !important;
}
.child-link { font-size: .95rem; }
.child-link i { font-size: 1rem }

/* diagonal gradient background */
/*aside { background-color: #0B3D5E; background-image: linear-gradient(180deg, #105784 0%, #0B3D5E 100%); }*/
aside { background-color: #FFF; }
/* active state: primary accent */



.nav-link{ color: #000435 !important; }
.nav-link.active { color: #89D136 !important; }

.nav-item ul.nav {
  background-color: #89D136 !important;
  border-radius: 0px 0px 20px 0;
  z-index: 999;
}
/*.nav-item ul.nav .nav-item {background-color: #89D136 !important;}*/
.nav-item div > .nav-link[aria-expanded="true"] {
    background-color: #89D136;
    color: #000435 !important;
    border-radius: 20px 0px 0px 0px !important; 
  }
.nav-item ul.nav .nav-item .nav-link{color:#000435 !important; z-index:999;}

.nav-item ul.nav .nav-item .nav-link.active { color: #000435 !important; }
/* chevron rotate on toggle */
.chevron { transition: transform 180ms ease; transform-origin: 50% 50%; color:#105784 !important;     transform: rotate(-180deg);}
.chevron.rotated { transform: rotate(0deg); }

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
  background: linear-gradient(180deg, #1A6FA8 0%, #0B3D5E 100%);
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



/* Mini (icons-only) sidebar styles 
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
.btn-toggle-mini { border-color: rgba(255,255,255,0.15); color: #fff; margin-right: -35px;
  background-color: rgba(255,255,255,0.1);}
.btn-toggle-mini:hover { background-color: rgba(255,255,255,0.18); border-color: rgba(255,255,255,0.2); color: #fff; }
.btn-toggle-mini i { font-size: 0.92rem }*/

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

/* Prevent menu items from wrapping and reduce size when space is constrained */
/* Allow wrapping by default to avoid horizontal overflow; only enforce nowrap in compact widths */
ul.nav.flex-row { flex-wrap: wrap; overflow: hidden; max-width: 100%; }
ul.nav.flex-row > li.nav-item { flex: 0 0 auto; }
.nav-link span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: inline-block; max-width: 160px; vertical-align: middle; }
.child-link { font-size: 0.82rem }

@media (max-width: 1120px) {
  ul.nav.flex-row { flex-wrap: nowrap; overflow: visible; }
  .nav-link.title { font-size: 0.82rem }
  .nav-link span { max-width: 120px }
}

/* Ensure sidebar never exceeds viewport height and make nav scrollable with themed scrollbar */
aside { height: 70px; display: flex; flex-direction: column; }
/* make the main nav area scrollable 
aside nav { overflow-y: auto; -webkit-overflow-scrolling: touch; }*/

/* Themed custom scrollbar for WebKit browsers */
aside nav::-webkit-scrollbar { width: 10px; }
aside nav::-webkit-scrollbar-track { background: transparent; }
aside nav::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 10px; border: 2px solid transparent; background-clip: padding-box; }
aside nav::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.16); }

/* Firefox scrollbar styling */
aside nav { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent; }

/* Top navbar and off-canvas styles */
.top-navbar {
  background: #fff;
  border-bottom: 1px solid #e5e5e5;
  min-height: 64px;
  z-index: 1020;
}
/* ===================== Off-canvas mega-menu (template "Menu lateral") ===================== */
.mega-oc {
  --mg-surface: #ffffff; --mg-surface-2: #f6f8f9; --mg-border: #e8edf0; --mg-border-strong: #d6dde2;
  --mg-ink: #16222c; --mg-ink-2: #3a4853; --mg-muted: #6c7a85; --mg-faint: #9aa6af;
  --mg-brand: #5ea829; --mg-brand-ink: #467f1d; --mg-brand-dark: #3f761b;
  --mg-brand-soft: #edf6e2; --mg-brand-soft-border: #d6ebbf; --mg-danger: #df433d;
  font-family: 'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.mega-scrim {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(13,26,8,.46); backdrop-filter: blur(2px);
  display: flex; align-items: stretch;
  animation: mega-fade .2s ease;
}
@keyframes mega-fade { from { opacity: 0; } }
.mega-oc {
  position: relative; height: 100%; width: min(780px, 95vw);
  background: var(--mg-surface); color: var(--mg-ink);
  box-shadow: 0 30px 80px rgba(16,32,12,.30), 0 8px 24px rgba(16,32,12,.16);
  display: flex; flex-direction: column;
  border-top-right-radius: 20px; border-bottom-right-radius: 20px;
  animation: mega-slide .34s cubic-bezier(.22,.7,.25,1);
}
@keyframes mega-slide { from { transform: translateX(-104%); } to { transform: translateX(0); } }

/* header */
.mega-oc .oc-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 16px 22px; border-bottom: 1px solid var(--mg-border); flex-shrink: 0;
  background: linear-gradient(180deg, #ffffff, #fbfdf9);
}
.mega-oc .oc-brand { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mega-oc .oc-logo-img { height: 26px; width: auto; object-fit: contain; }
.mega-oc .oc-sub { font-size: 12px; color: var(--mg-faint); font-weight: 600; margin-top: 1px; }
.mega-oc .oc-close {
  width: 42px; height: 42px; border-radius: 12px; border: 1px solid var(--mg-border);
  background: var(--mg-surface); color: var(--mg-muted); display: grid; place-items: center;
  cursor: pointer; transition: .15s; flex-shrink: 0;
}
.mega-oc .oc-close:hover { background: #fdecec; color: var(--mg-danger); border-color: #f6d4d2; transform: rotate(90deg); }

/* body — 3 balanced columns (distributed in JS, source order preserved) */
.mega-oc .oc-body {
  padding: 18px 22px 26px; overflow-y: auto; flex: 1; min-height: 0;
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 0 22px; align-content: start;
}
.mega-oc .oc-col { display: flex; flex-direction: column; gap: 4px; min-width: 0; }

/* primary items */
.mega-oc .oc-primary {
  display: flex; flex-direction: column; gap: 6px;
  padding-bottom: 14px; margin-bottom: 8px; border-bottom: 1px dashed var(--mg-border-strong);
}
.mega-oc .prim {
  display: flex; align-items: center; gap: 12px; padding: 11px 12px; border-radius: 12px;
  cursor: pointer; text-decoration: none; color: var(--mg-ink); transition: .14s; border: 1px solid transparent;
}
.mega-oc .prim:hover { background: var(--mg-brand-soft); border-color: var(--mg-brand-soft-border); }
.mega-oc .prim-ic {
  width: 38px; height: 38px; border-radius: 10px; background: var(--mg-brand-soft); color: var(--mg-brand-ink);
  display: grid; place-items: center; flex-shrink: 0; transition: .14s;
}
.mega-oc .prim:hover .prim-ic { background: var(--mg-brand); color: #fff; }
.mega-oc .prim-ic .material-symbols-rounded { font-size: 22px; }
.mega-oc .prim-label { font-weight: 700; font-size: 15px; letter-spacing: -.01em; flex: 1; }
.mega-oc .prim-chev { color: var(--mg-faint); font-size: 20px; transition: transform .14s; }
.mega-oc .prim:hover .prim-chev { color: var(--mg-brand-ink); transform: translateX(2px); }

/* group */
.mega-oc .grp { margin-top: 12px; }
.mega-oc .grp-head { display: flex; align-items: center; gap: 9px; padding: 0 4px 7px; }
.mega-oc .grp-ic {
  width: 26px; height: 26px; border-radius: 8px; background: var(--mg-brand-soft); color: var(--mg-brand-ink);
  display: grid; place-items: center; flex-shrink: 0;
}
.mega-oc .grp-ic .material-symbols-rounded { font-size: 17px; font-variation-settings: 'FILL' 1, 'wght' 500; }
.mega-oc .grp-title { font-size: 11.5px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--mg-muted); white-space: nowrap; }
.mega-oc .grp-rule { flex: 1; height: 1px; background: var(--mg-border); border-radius: 1px; }

/* nav link */
.mega-oc .lnk {
  display: flex; align-items: center; gap: 11px; padding: 8px 10px; border-radius: 9px; cursor: pointer;
  text-decoration: none; color: var(--mg-ink-2); font-weight: 600; font-size: 13.5px;
  transition: background .13s, color .13s; position: relative;
}
.mega-oc .lnk .material-symbols-rounded { font-size: 20px; color: var(--mg-faint); transition: color .13s; flex-shrink: 0; }
.mega-oc .lnk-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mega-oc .lnk:hover { background: var(--mg-surface-2); color: var(--mg-ink); }
.mega-oc .lnk:hover .material-symbols-rounded { color: var(--mg-brand-ink); }
.mega-oc .lnk.active { background: var(--mg-brand-soft); color: var(--mg-brand-ink); font-weight: 700; box-shadow: inset 3px 0 0 var(--mg-brand); }
.mega-oc .lnk.active .material-symbols-rounded { color: var(--mg-brand-ink); font-variation-settings: 'FILL' 1, 'wght' 500; }
.mega-oc .lnk-badge { margin-left: auto; font-size: 10.5px; font-weight: 800; background: var(--mg-brand); color: #fff; border-radius: 999px; padding: 1px 7px; }
.mega-oc .lnk-badge.danger, .mega-oc .prim .lnk-badge { background: var(--mg-danger); }
.mega-oc .prim .lnk-badge { margin-left: 0; }

/* locked items */
.mega-oc .is-locked { opacity: .6; }
.mega-oc .lock-tag {
  margin-left: auto; display: inline-flex; align-items: center; gap: 3px; white-space: nowrap;
  font-size: 10px; font-weight: 800; color: #9a6400; background: #fcf1da; border-radius: 999px; padding: 2px 7px;
}
.mega-oc .lock-tag .material-symbols-rounded { font-size: 13px; color: #9a6400; }

/* footer */
.mega-oc .oc-foot {
  flex-shrink: 0; border-top: 1px solid var(--mg-border); padding: 12px 22px;
  display: flex; align-items: center; gap: 12px; background: var(--mg-surface-2);
}
.mega-oc .oc-user { display: flex; align-items: center; gap: 11px; flex: 1; min-width: 0; }
.mega-oc .oc-av { width: 36px; height: 36px; border-radius: 50%; background: var(--mg-brand); color: #fff; display: grid; place-items: center; font-weight: 800; font-size: 13px; flex-shrink: 0; }
.mega-oc .oc-user-meta { min-width: 0; }
.mega-oc .oc-uname { font-weight: 700; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mega-oc .oc-urole { font-size: 11px; color: var(--mg-faint); font-weight: 700; letter-spacing: .05em; }
.mega-oc .oc-logout {
  display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 700; color: var(--mg-muted);
  background: var(--mg-surface); border: 1px solid var(--mg-border); border-radius: 9px; padding: 8px 13px;
  cursor: pointer; transition: .14s; flex-shrink: 0;
}
.mega-oc .oc-logout:hover { color: var(--mg-danger); border-color: #f6d4d2; background: #fdecec; }
.mega-oc .oc-logout .material-symbols-rounded { font-size: 18px; }

.mega-oc .oc-body::-webkit-scrollbar { width: 10px; }
.mega-oc .oc-body::-webkit-scrollbar-thumb { background: #dde3e7; border-radius: 999px; border: 3px solid var(--mg-surface); }
.mega-oc .oc-body::-webkit-scrollbar-thumb:hover { background: #c8d0d5; }

@media (max-width: 720px) {
  .mega-oc .oc-body { grid-template-columns: 1fr; }
}
.quick-shortcuts .shortcut-btn {
  background: #f8f9fa;
  border-radius: 50% 50% 50% 10% !important;
  border: none;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  transition: background 0.15s;
  padding: 4px 10px !important;
}
.quick-shortcuts .shortcut-btn:hover { background: #89d136; }
.shortcut-actions .btn { line-height: 1; }
.modal-backdrop-custom {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0,0,0,0.32);
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal-dialog-custom { background: #fff; border-radius: 10px; box-shadow: 0 8px 32px rgba(0,0,0,0.18); min-width: 320px; max-width: 90vw; }
/* Fixed edit button shown while scrolling */
.shortcut-edit-fixed {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(15,30,60,0.08);
  background: #f8f9fa;
  border: none;
}
.shortcut-edit-fixed i { color: #333 }

/* Keep a fixed-position variant available if needed */
.shortcut-edit-fixed--fixed {
  position: fixed;
  bottom: 18px;
  right: 18px;
  z-index: 5500;
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
button#quickMenuDropdown {
        background: #f8f9fa;
    padding: 2px 4px;
}
button#quickMenuDropdown[aria-expanded="true"], .btn:first-child:active {
  background: #89d136 !important;
  border-color: #89d136 !important;
  border-radius: 16px 16px 0px 0px;
}

#quickMenuDropdown::after { display:none; }

/* ---------- User menu (green dropdown — Cobranças template) ---------- */
.user-menu {
  position: absolute; top: calc(100% + 10px); right: 0; width: 332px; z-index: 1400;
  background: linear-gradient(180deg, #84c63f 0%, #74b531 100%);
  border-radius: 18px; padding: 8px; color: #fff;
  box-shadow: 0 22px 50px rgba(58,110,18,.38), 0 4px 12px rgba(0,0,0,.12);
  animation: um-pop .18s cubic-bezier(.2,.7,.3,1);
  text-align: left;
}
@keyframes um-pop { from { opacity: 0; transform: translateY(12px) scale(.985); } }
.user-menu::after {
  content: ''; position: absolute; top: -7px; right: 26px; width: 14px; height: 14px;
  background: #84c63f; transform: rotate(45deg); border-radius: 3px;
}
.um-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px 6px; }
.um-label { font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: rgba(255,255,255,.78); white-space: nowrap; }
.um-count { font-size: 11px; font-weight: 700; color: #fff; background: rgba(255,255,255,.22); padding: 2px 9px; border-radius: 999px; white-space: nowrap; }

.um-stores { display: flex; flex-direction: column; gap: 2px; }
.um-empty { padding: 10px 12px; font-size: 13px; font-weight: 600; color: rgba(255,255,255,.85); }
.store-row { display: flex; align-items: center; gap: 12px; padding: 9px 12px; border-radius: 12px; transition: background .14s; }
.store-row:hover { background: rgba(255,255,255,.16); }
.store-logo {
  width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; flex-shrink: 0;
  color: #fff; font-weight: 800; font-size: 12.5px; letter-spacing: -.02em;
  box-shadow: 0 2px 5px rgba(0,0,0,.18), inset 0 0 0 1px rgba(255,255,255,.18);
}
.store-logo-img { object-fit: cover; }
.store-meta { flex: 1; min-width: 0; }
.store-row .store-name { font-weight: 700; font-size: 14.5px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.store-status { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: rgba(255,255,255,.82); margin-top: 1px; }
.st-dot { width: 7px; height: 7px; border-radius: 50%; background: #ffd9d2; box-shadow: 0 0 0 2px rgba(255,255,255,.12); }
.store-row.is-open .st-dot { background: #eafad3; box-shadow: 0 0 6px rgba(234,250,211,.9); }

/* switch */
.switch {
  width: 46px; height: 26px; border-radius: 999px; border: 0; cursor: pointer; flex-shrink: 0;
  background: rgba(20,50,8,.30); position: relative; transition: background .2s; padding: 0;
}
.switch .knob {
  position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,.3); transition: left .2s cubic-bezier(.3,1.4,.5,1);
}
.switch.on { background: #ffffff; }
.switch.on .knob { left: 23px; background: #5ea829; box-shadow: 0 1px 3px rgba(0,0,0,.2); }

.um-credits {
  margin: 8px 4px; padding: 13px 14px; border-radius: 14px;
  background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.22);
}
.cr-top { display: flex; align-items: center; justify-content: space-between; }
.cr-title { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 800; color: #fff; white-space: nowrap; }
.cr-count { font-size: 14px; font-weight: 800; color: #fff; white-space: nowrap; }
.cr-max { color: rgba(255,255,255,.65); font-weight: 700; }
.cr-bar { height: 7px; border-radius: 999px; background: rgba(20,50,8,.22); overflow: hidden; margin: 10px 0 11px; }
.cr-bar > span { display: block; height: 100%; border-radius: 999px; background: #fff; }
.cr-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.cr-renew { display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; color: rgba(255,255,255,.85); }
.cr-buy {
  border: 0; background: #fff; color: #4a8a1f; font-family: inherit; font-weight: 800; font-size: 12.5px;
  padding: 7px 13px; border-radius: 999px; cursor: pointer; transition: .14s; white-space: nowrap;
}
.cr-buy:hover { background: #f3fbe9; transform: translateY(-1px); }

.um-links { border-top: 1px solid rgba(255,255,255,.24); margin-top: 4px; padding-top: 6px; display: flex; flex-direction: column; gap: 2px; }
.um-link {
  display: flex; align-items: center; gap: 12px; padding: 11px 12px; border-radius: 11px;
  color: #fff !important; text-decoration: none; font-weight: 700; font-size: 14.5px; transition: background .14s;
}
.um-link i { font-size: 18px; line-height: 1; }
.um-link:hover, .um-link:focus { background: rgba(255,255,255,.18); color: #fff; }
.um-link > span:first-of-type { flex: 1; }
.um-badge { background: #df433d; color: #fff; font-size: 11.5px; font-weight: 800; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 999px; display: grid; place-items: center; box-shadow: 0 2px 5px rgba(0,0,0,.18); }
.um-logout { color: rgba(255,255,255,.92) !important; }
</style>