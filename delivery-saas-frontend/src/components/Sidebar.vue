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
import AiCreditsWidget from './AiCreditsWidget.vue';

const props = defineProps({
  embedded: { type: Boolean, default: false }
});

      const route = useRoute();
      const router = useRouter();
    const auth = useAuthStore();
const saas = useSaasStore();
const modules = useModulesStore();

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
            <img src="/core.png" alt="" class="log">
          </div>
        </div>
      </div>

      <div class="d-flex align-items-center">
        <div class="quick-shortcuts d-none d-sm-flex align-items-center justify-content-end">
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
            <li class="px-1 py-1">
              <AiCreditsWidget compact v-if="auth.user?.companyId" />
            </li>
            <li><hr class="dropdown-divider"></li>
            <li>
              <button class="dropdown-item" @click.prevent="logout()">Sair</button>
            </li>
          </ul>
        </div>
      </div>
    </header>

    <!-- Off-canvas menu com toda a navegação -->
    <div v-if="offCanvasOpen" class="offcanvas-backdrop" @click.self="offCanvasOpen = false">
      <nav class="offcanvas-menu p-4">
        <div class="d-flex justify-content-between align-items-start">
        <img src="/core-neg.png" alt="" class="logo-neg">
        <button class="btn btn-close mb-4" @click="offCanvasOpen = false" aria-label="Fechar menu"></button>
      </div>
        <ul class="nav flex-column" style="height:100vh;">
          <li v-for="item in visibleNav" :key="item.to" class="nav-item mb-2">
            <router-link :to="item.to" class="nav-link title d-flex align-items-center" @click="offCanvasOpen = false">
              <i :class="item.icon + ' me-2'" aria-hidden="true"></i>
              <span>{{ item.name }}</span>
            </router-link>
            <ul v-if="item.children" class="nav flex-column ms-3">
              <li v-for="child in item.children" :key="child.to" class="nav-item mb-1">
                <router-link :to="child.to" class="nav-link d-flex align-items-center" @click="offCanvasOpen = false">
                  <i :class="child.icon + ' me-2'" aria-hidden="true"></i>
                  <span>{{ child.name }}</span>
                </router-link>
              </li>
            </ul>
          </li>
          <li class="mt-auto pt-2">
            <hr class="text-white opacity-25">
            <AiCreditsWidget compact v-if="auth.user?.companyId" />
          </li>
        </ul>
      </nav>
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
    max-width: 180px;
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
.offcanvas-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0,0,0,0.32);
  z-index: 2000;
  display: flex;
  align-items: flex-start;
}
.offcanvas-menu {
  background: #89d136;
  min-width: 280px;
  max-width: 90vw;
  min-height: 100vh;
  box-shadow: 2px 0 16px rgba(0,0,0,0.08);
  border-radius: 0 12px 12px 0;
  animation: slideInLeft 0.22s cubic-bezier(.4,1.3,.6,1) both;
  text-align:right;
}
@keyframes slideInLeft {
  from { transform: translateX(-100%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
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
</style>