
import { ref, onMounted, onBeforeUnmount, computed, reactive, watch, nextTick } from 'vue';
import { bindLoading } from '../state/globalLoading.js';
import api from '../api';
import { useRoute, useRouter } from 'vue-router';
import { assetUrl } from '../utils/assetUrl.js';
import { applyPhoneMask, removePhoneMask } from '../utils/phoneMask';
import ListGroup from '../components/form/list-group/ListGroup.vue';

const route = useRoute();
const router = useRouter();
const companyId = route.params.companyId || '1';
// support store-scoped and menu-scoped public views via query params
// persist storeId in localStorage per company so selection survives navigation
const storeStorageKey = `public_store_${companyId}`
const storeId = ref(route.query.storeId || localStorage.getItem(storeStorageKey) || null);
// persist menuId similarly so the selected menu survives navigation
const menuStorageKey = `public_menu_${companyId}`
const menuId = ref(route.query.menuId || localStorage.getItem(menuStorageKey) || null);

// Hero banner URL: if backend provides a banner use it; otherwise
// fallback to non-/public path /:companyId/default-banner.jpg as requested.
const heroBannerUrl = computed(() => {
  try {
    const b = menu.value?.banner || company.value?.banner;
    if(b) return assetUrl(b);
    // fallback path without /public prefix
    return assetUrl('/' + companyId + '/default-banner.jpg');
  } catch(e){ return assetUrl('/' + companyId + '/default-banner.jpg'); }
});

const loading = ref(true);
bindLoading(loading);
const categories = ref([]);
const uncategorized = ref([]);
const paymentMethods = ref([]);
const company = ref(null)
const menu = ref(null)
const orderType = ref('DELIVERY') // 'DELIVERY' or 'PICKUP'

// Derived display values: prefer the menu name (cardápio title), then fall back
// to store name or company name. This ensures the page heading shows the
// currently selected menu instead of the store name.
const displayName = computed(() => {
  try {
    const menuName = menu.value?.name?.toString().trim();
    const storeName = company.value?.store?.name?.toString().trim();
    const companyName = company.value?.name?.toString().trim();
    return menuName || storeName || companyName || 'Cardápio';
  } catch (e) { return 'Cardápio' }
});

const displayPickup = computed(() => {
  // Prefer the store-level address from settings/stores. Fallback to company.address if missing.
  const storeAddr = (company.value?.store?.address || '').toString().trim();
  const companyAddr = (company.value?.address || '').toString().trim();
  return storeAddr || companyAddr || '';
});

// Helper: produce an effective settings object that prefers menu-level meta
function effectiveSettings(){
  try{
    // prefer top-level company fields but also include nested `store` settings
    // (some API versions store schedule fields under company.store)
    const base = company.value ? { ...company.value, ...(company.value.store || {}) } : {}
    // menu-level direct fields (menu may store open24Hours, weeklySchedule, timezone, openFrom/openTo)
    const menuMeta = menu.value ? { ...menu.value, ...(menu.value.store || {}) } : {}
    // also support company.value.menus[menuId] (menu-specific meta stored under store settings)
    try{
      const menusMap = company.value && company.value.menus ? company.value.menus : null
      if(menuId.value && menusMap && menusMap[String(menuId.value)]){
        Object.assign(menuMeta, menusMap[String(menuId.value)])
      }
    }catch(e){}
    return { ...base, ...menuMeta }
  }catch(e){ return company.value || {} }
}

// Normalize different names used across API versions for the "always open / 24h" flag
function isAlwaysOpenFlag(c){
  try{
    return !!(c && (c.alwaysOpen || c.open24Hours || c.open24 || c.always_open))
  }catch(e){ return false }
}

// Sticky categories bar state
const heroRef = ref(null)
const navRef = ref(null)
const isNavSticky = ref(false)
let rafId = null
function handleScroll() {
  try{
    if(!heroRef.value) return
    const navEl = navRef.value || document.querySelector('.nav-pills')
    if(!navEl) return
    const heroRect = heroRef.value.getBoundingClientRect()
    const headerEl = document.querySelector('header, .site-header, .navbar, .app-header')
    const headerH = headerEl ? headerEl.getBoundingClientRect().height : 0
    const shouldStick = heroRect.bottom <= headerH

    if(isNavSticky.value !== shouldStick){
      isNavSticky.value = shouldStick
      if(shouldStick){
        // compute nav position and constrain it to nearest .container (avoid full-width fixed)
        const navRect = navEl.getBoundingClientRect()
        const containerEl = (navEl.closest && navEl.closest('.container')) || document.querySelector('.container') || document.body
        const containerRect = containerEl ? containerEl.getBoundingClientRect() : { left: 0, width: navRect.width }

        // prepare animated entrance using transform (slide down) with tuned easing/duration
        try{
          navEl.style.transition = 'transform 260ms cubic-bezier(.2,.9,.2,1), box-shadow 260ms ease'
          navEl.style.transform = 'translateY(-10px)'
        }catch(e){}
        navEl.style.position = 'fixed'
        navEl.style.top = `${headerH}px`
        // constrain to container left/width so the sticky isn't full-viewport width
        navEl.style.left = `${containerRect.left}px`
        navEl.style.width = `${containerRect.width}px`
        navEl.style.zIndex = '1075'
        // trigger slide-in and subtle shadow
        requestAnimationFrame(()=>{ try{ navEl.style.transform = 'translateY(0)'; navEl.style.boxShadow = '0 4px 14px rgba(0,0,0,0.08)'; }catch(e){} })
      } else {
        // animate slide-out with slightly different easing/delay for extra polish, then restore
        try{ navEl.style.transition = 'transform 220ms cubic-bezier(.4,0,.2,1), box-shadow 180ms ease'; navEl.style.transform = 'translateY(-10px)'; navEl.style.boxShadow = '' }catch(e){}
        setTimeout(()=>{
          try{
            navEl.style.position = ''
            navEl.style.top = ''
            navEl.style.left = ''
            navEl.style.width = ''
            navEl.style.zIndex = ''
            navEl.style.transition = ''
            navEl.style.transform = ''
          }catch(e){}
        }, 260)
      }
    } else {
      // if already sticky, update top/left/width on scroll (handles header resize/resize while pinned)
      if(isNavSticky.value){
        const headerEl2 = document.querySelector('header, .site-header, .navbar, .app-header')
        const headerH2 = headerEl2 ? headerEl2.getBoundingClientRect().height : 0
        // keep pinned width aligned to nearest container if available
        const containerEl2 = (navEl.closest && navEl.closest('.container')) || document.querySelector('.container') || null
        if(containerEl2){
          const containerRect2 = containerEl2.getBoundingClientRect()
          navEl.style.top = `${headerH2}px`
          navEl.style.left = `${containerRect2.left}px`
          navEl.style.width = `${containerRect2.width}px`
        } else {
          const navRect2 = navEl.getBoundingClientRect()
          navEl.style.top = `${headerH2}px`
          navEl.style.left = `${navRect2.left}px`
          navEl.style.width = `${navRect2.width}px`
        }
      }
    }
  }catch(e){ console.warn('handleScroll err', e) }
}

// Integrate scrollspy into handleScroll by calling updateActiveCategory

onMounted(()=>{
  const onScroll = () => {
    if(rafId) cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(()=>{ handleScroll(); updateActiveCategory(); })
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll)
    // listen for login events so we can fetch server-side customer data when token is set
    const onAppUserLoggedIn = () => { try{ fetchProfileAndAddresses() }catch(e){} }
    try{ window.addEventListener('app:user-logged-in', onAppUserLoggedIn) }catch(e){}
    // listen for addresses updates from other views (e.g., PublicAddresses) and refresh local addresses
    const onAddressesUpdated = (ev) => {
      try{
        const arr = (ev && ev.detail && ev.detail.addresses) ? ev.detail.addresses : null
        if(Array.isArray(arr) && arr.length){
          try{ addresses.value = arr }catch(e){}
          try{ selectedAddressId.value = addresses.value.length ? addresses.value[0].id : selectedAddressId.value }catch(e){}
          try{ localStorage.setItem(LOCAL_ADDR_KEY, JSON.stringify(addresses.value)) }catch(e){}
          try{ console.debug('[debug] addresses updated via event', { addresses: addresses.value, selectedAddressId: selectedAddressId.value }) }catch(e){}
          try{ refreshDeliveryFee() }catch(e){}
        }
      }catch(e){}
    }
    try{ window.addEventListener('app:addresses-updated', onAddressesUpdated) }catch(e){}
  // init
  handleScroll()
  updateActiveCategory()
  onBeforeUnmount(() => {
    window.removeEventListener('scroll', onScroll)
    window.removeEventListener('resize', onScroll)
      try{ window.removeEventListener('app:user-logged-in', onAppUserLoggedIn) }catch(e){}
      try{ window.removeEventListener('app:addresses-updated', onAddressesUpdated) }catch(e){}
    if(rafId) cancelAnimationFrame(rafId)
    try{ if(_discountsDebounce) clearTimeout(_discountsDebounce) }catch(e){}
    // ensure styles cleared
    try{ if(navRef.value){ navRef.value.style.position=''; navRef.value.style.top=''; navRef.value.style.left=''; navRef.value.style.width=''; navRef.value.style.zIndex=''; } }catch(e){}
  })

  })

const scheduleList = computed(() => {
  const c = effectiveSettings()
  if(!c) return null
  if(Array.isArray(c.weeklySchedule) && c.weeklySchedule.length) return c.weeklySchedule
  return null
})

// Display-friendly weekday names (Portuguese), match indices 0=Domingo..6=Sábado
const weekDayNames = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado']

// Compute current weekday index in the store timezone (0=Sunday..6=Saturday)
const currentWeekDayIndex = computed(() => {
  try{
    const c = effectiveSettings() || {}
    const tz = c.timezone || 'America/Sao_Paulo'
    const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    const parts = fmt.split('/')
    if(parts.length !== 3) return new Date().getDay()
    const [dayStr, monthStr, yearStr] = parts
    const tzDate = new Date(`${yearStr}-${monthStr}-${dayStr}T00:00:00Z`)
    return tzDate.getUTCDay()
  }catch(e){ return new Date().getDay() }
})

function isTodaySchedule(d){
  try{
    const idx = Number(d && d.day) || 0
    return idx === Number(currentWeekDayIndex.value)
  }catch(e){ return false }
}


function toggleOrderType(){
  orderType.value = orderType.value === 'DELIVERY' ? 'PICKUP' : 'DELIVERY'
}
// checkout modal state (multi-step)
const checkoutModalOpen = ref(false)
const checkoutStep = ref('customer') // 'customer' | 'delivery' | 'payment' | 'review'
// Stepper configuration for checkout modal
const stepOrder = ['customer','delivery','payment','review']
const stepLabels = { customer: 'Cliente', delivery: 'Entrega', payment: 'Pagamento', review: 'Resumo' }
const stepIcons = { customer: 'bi-person', delivery: 'bi-geo-alt', payment: 'bi-credit-card', review: 'bi-list-check' }
const stepIndex = computed(() => Math.max(0, stepOrder.indexOf(checkoutStep.value)))
// simple info modal state (opened by 'Mais informações')
// simple info modal state (opened by 'Mais informações')
const infoModalOpen = ref(false)
// which tab inside the info modal is active: 'hours' | 'contacts' | 'payments'
const infoTab = ref('hours')

function openInfoModal(){ infoModalOpen.value = true; infoTab.value = 'hours' }
function closeInfoModal(){ infoModalOpen.value = false }
// persist customer and addresses in localStorage for convenience
// namespace localStorage by company + optional store + optional menu so carts don't collide
const PUBLIC_NS = [companyId, storeId.value || '', menuId.value || ''].filter(Boolean).join('_') || companyId
const LOCAL_CUSTOMER_KEY = `public_customer_${PUBLIC_NS}`
const LOCAL_ADDR_KEY = `public_addresses_${companyId}`
// load persisted customer/address
const addresses = ref(JSON.parse(localStorage.getItem(LOCAL_ADDR_KEY) || '[]'))
const selectedAddressId = ref(addresses.value.length ? addresses.value[0].id : null)
  // if user is authenticated via public profile, prefill addresses and select first
  try{
    const token = localStorage.getItem('token')
    const stored = JSON.parse(localStorage.getItem(LOCAL_CUSTOMER_KEY) || localStorage.getItem(`public_customer_${companyId}`) || 'null')
    if(token && stored && stored.addresses && Array.isArray(stored.addresses) && stored.addresses.length){
      addresses.value = stored.addresses.map(a => ({
        id: a.id || String(Date.now()) + Math.random().toString(36).slice(2,8),
        label: a.label || a.formatted || '',
        formattedAddress: a.formatted || a.formattedAddress || '',
        number: a.number || a.numero || '',
        complement: a.complement || a.complemento || '',
        neighborhood: a.neighborhood || a.neigh || '',
        reference: a.reference || a.ref || '',
        observation: a.observation || a.observacao || '',
        postalCode: a.postalCode || a.postal_code || a.zip || '',
        city: a.city || '',
        state: a.state || '',
        country: a.country || '',
        latitude: a.latitude || a.lat || null,
        longitude: a.longitude || a.lon || a.lng || null,
        fullDisplay: a.fullDisplay || a.display_name || ''
      }))
      selectedAddressId.value = addresses.value.length ? addresses.value[0].id : selectedAddressId.value
      // debug: log loaded addresses and selection for troubleshooting delivery fee
      try{ console.debug('[debug] loaded stored public customer addresses', { addresses: addresses.value, selectedAddressId: selectedAddressId.value }) }catch(e){}
      // ensure delivery fee is computed for the pre-selected address
      try{ refreshDeliveryFee() }catch(e){}
    } else if (token && !stored) {
          // token exists but we have no cached customer info — try to fetch profile and addresses from server
          try{ fetchProfileAndAddresses() }catch(e){}
    }
  }catch(e){ /* ignore */ }

async function openCheckout(){
  checkoutModalOpen.value = true
  // if a public customer is already authenticated (token + stored customer), skip customer step
  try{
    const token = localStorage.getItem('token')
    // ensure we try to fetch server-side profile/addresses when opening checkout
    if(token){
      try{
        // if we have no addresses yet, wait a short time for the fetch to complete
        if(!addresses.value.length){
          const p = fetchProfileAndAddresses()
          const timeout = new Promise(r => setTimeout(r, 800))
          await Promise.race([p, timeout])
        } else {
          try{ fetchProfileAndAddresses() }catch(e){}
        }
      }catch(e){}
    }
    const stored = JSON.parse(localStorage.getItem(LOCAL_CUSTOMER_KEY) || localStorage.getItem(`public_customer_${companyId}`) || 'null')
    if(token && stored){
      checkoutStep.value = 'delivery'
      // compute delivery fee immediately even if the selected address was already set
      try{ refreshDeliveryFee() }catch(e){}
      return
    }
  }catch(e){ /* ignore parse errors */ }
  checkoutStep.value = 'customer'
}
function closeCheckout(){ checkoutModalOpen.value = false }

function goBackFromStep(){
  const idx = stepOrder.indexOf(checkoutStep.value)
  if(idx > 0){ checkoutStep.value = stepOrder[idx - 1] }
  else { closeCheckout() }
}

function openRegister(){
  router.push({ path: `/public/${companyId}/profile`, query: { tab: 'register' } })
}

function saveCustomerToLocal(){
  localStorage.setItem(LOCAL_CUSTOMER_KEY, JSON.stringify({ name: customer.value.name, contact: customer.value.contact }))
}

function addAddress(addr){
  // addr: { label, formattedAddress, neighborhood }
  const id = String(Date.now()) + '-' + Math.random().toString(36).slice(2,8)
  // allow optional latitude/longitude
  const a = { id, ...addr }
  // ensure label is present; default to the formatted address for identification
  try{ a.label = String(a.label || a.formattedAddress || '').trim() }catch(e){ a.label = String(a.formattedAddress || '') }
  try{ a.reference = a.reference || a.ref || '' }catch(e){}
  try{ a.observation = a.observation || a.observacao || '' }catch(e){}
  try{ a.number = a.number || a.num || '' }catch(e){}
  try{ a.complement = a.complement || a.complemento || '' }catch(e){}
  try{ a.latitude = a.latitude || a.lat || null }catch(e){}
  try{ a.longitude = a.longitude || a.lon || a.lng || null }catch(e){}
  try{ a.postalCode = a.postalCode || a.postal_code || a.zip || '' }catch(e){}
  try{ a.city = a.city || '' }catch(e){}
  try{ a.state = a.state || '' }catch(e){}
  try{ a.country = a.country || '' }catch(e){}
  try{ a.fullDisplay = a.fullDisplay || a.display_name || '' }catch(e){}
  addresses.value.push(a)
  selectedAddressId.value = id
  localStorage.setItem(LOCAL_ADDR_KEY, JSON.stringify(addresses.value))
}

function removeAddress(id){
  const idx = addresses.value.findIndex(a=>a.id===id)
  if(idx>=0) addresses.value.splice(idx,1)
  if(selectedAddressId.value===id) selectedAddressId.value = addresses.value.length ? addresses.value[0].id : null
  localStorage.setItem(LOCAL_ADDR_KEY, JSON.stringify(addresses.value))
}

// Fetch server-side public profile and addresses when we have a token but no cached customer
async function fetchProfileAndAddresses(){
  let storedContact = null
  let prof = null
  try{
    // if we have a stored public customer contact, send it as x-public-phone so server can resolve guest customer
    const stored = JSON.parse(localStorage.getItem(LOCAL_CUSTOMER_KEY) || localStorage.getItem(`public_customer_${companyId}`) || 'null')
    storedContact = stored && (stored.contact || stored.whatsapp || stored.phone) ? (stored.contact || stored.whatsapp || stored.phone) : null
    const cfg = {}
    if(storedContact) cfg.headers = { 'x-public-phone': storedContact }

    const p = await api.get(`/public/${companyId}/profile`, cfg)
    prof = p && p.data ? p.data : null
    if(prof){
      try{ localStorage.setItem(LOCAL_CUSTOMER_KEY, JSON.stringify(prof)) }catch(e){}
      // also populate runtime `customer` so `publicCustomerConnected` becomes available
      try{
        const resolvedName = String(prof.name || prof.fullName || prof.customerName || (prof.customer && (prof.customer.fullName || prof.customer.name)) || '')
        const resolvedContact = String(prof.contact || prof.whatsapp || prof.phone || (prof.customer && (prof.customer.whatsapp || prof.customer.phone)) || '')
        customer.value = {
          name: resolvedName,
          contact: resolvedContact,
          address: (prof.addresses && prof.addresses.length && prof.addresses[0]) ? {
            formattedAddress: prof.addresses[0].formatted || prof.addresses[0].formattedAddress || '',
            number: prof.addresses[0].number || prof.addresses[0].numero || '',
            complement: prof.addresses[0].complement || prof.addresses[0].complemento || '',
            neighborhood: prof.addresses[0].neighborhood || prof.addresses[0].neigh || '',
            reference: prof.addresses[0].reference || prof.addresses[0].ref || '',
            observation: prof.addresses[0].observation || prof.addresses[0].observacao || '',
            latitude: prof.addresses[0].latitude || prof.addresses[0].lat || null,
            longitude: prof.addresses[0].longitude || prof.addresses[0].lon || prof.addresses[0].lng || null,
            fullDisplay: prof.addresses[0].fullDisplay || prof.addresses[0].display_name || ''
          } : (customer.value && customer.value.address) ? { ...customer.value.address } : { formattedAddress: '', number: '', complement: '', neighborhood: '', reference: '', observation: '', latitude: null, longitude: null, fullDisplay: '' }
        }
        // refresh discounts now that we have customer context
        try{ scheduleEvaluateDiscounts() }catch(e){}
      }catch(e){}
    }
  }catch(e){ /* ignore profile fetch errors */ }

  try{
    const cfg2 = {}
    if(storedContact) cfg2.headers = { 'x-public-phone': storedContact }
    const r = await api.get(`/public/${companyId}/addresses`, cfg2)
    let addrData = (r && r.data) ? (Array.isArray(r.data) ? r.data : r.data.addresses || []) : []
    // fallback to profile addresses when the addresses endpoint returns empty
    if((!Array.isArray(addrData) || !addrData.length) && prof && Array.isArray(prof.addresses) && prof.addresses.length){
      addrData = prof.addresses
    }
    if(Array.isArray(addrData) && addrData.length){
      addresses.value = addrData.map(a => ({
        id: a.id || String(Date.now()) + Math.random().toString(36).slice(2,8),
        label: a.label || a.formatted || '',
        formattedAddress: a.formatted || a.formattedAddress || '',
        number: a.number || a.numero || '',
        complement: a.complement || a.complemento || '',
        neighborhood: a.neighborhood || a.neigh || '',
        reference: a.reference || a.ref || '',
        observation: a.observation || a.observacao || '',
        postalCode: a.postalCode || a.postal_code || a.zip || '',
        city: a.city || '',
        state: a.state || '',
        country: a.country || '',
        latitude: a.latitude || a.lat || null,
        longitude: a.longitude || a.lon || a.lng || null,
        fullDisplay: a.fullDisplay || a.display_name || '',
        isDefault: !!a.isDefault
      }))
      // prefer address marked as default when available
      const def = addresses.value.find(a => a.isDefault)
      selectedAddressId.value = def ? def.id : (addresses.value.length ? addresses.value[0].id : selectedAddressId.value)
      try{ localStorage.setItem(LOCAL_ADDR_KEY, JSON.stringify(addresses.value)) }catch(e){}
      try{ console.debug('[debug] fetched server addresses for logged-in customer', { addresses: addresses.value, selectedAddressId: selectedAddressId.value }) }catch(e){}
      try{ refreshDeliveryFee() }catch(e){}
    }
  }catch(e){ /* ignore addresses fetch errors */ }
}

const activeCategoryId = ref(null)

// update active category based on scroll position (scrollspy)
function updateActiveCategory(){
  try{
    if(!categories.value || !categories.value.length) { activeCategoryId.value = null; return }
    const headerEl = document.querySelector('header, .site-header, .navbar, .app-header')
    const headerH = headerEl ? headerEl.getBoundingClientRect().height : 0
    const offsets = []
    for(const c of categories.value){
      const el = document.getElementById(`cat-${c.id}`)
      if(!el) continue
      const top = el.getBoundingClientRect().top - headerH
      offsets.push({ id: c.id, top })
    }
    if(!offsets.length){ activeCategoryId.value = null; return }
    // determine if we're above the first category
    const firstTop = offsets[0].top
    if(window.scrollY === 0 || firstTop > 80){ activeCategoryId.value = null; return }
    // choose the category whose top is the largest <= 80px (closest to header)
    const candidates = offsets.filter(o => o.top <= 80)
    if(candidates.length){
      candidates.sort((a,b) => b.top - a.top)
      activeCategoryId.value = candidates[0].id
      return
    }
    // fallback: pick the first
    activeCategoryId.value = offsets[0].id
  }catch(e){ console.warn('updateActiveCategory err', e) }
}

const cart = ref([]);
const subtotal = computed(()=> cart.value.reduce((s,it)=> s + (it.price * it.quantity),0));
// storage key per company so different menus don't clash
const CART_STORAGE_KEY = `public_cart_${PUBLIC_NS}`
// try to restore cart from localStorage (keep numeric types safe)
try{
  const raw = localStorage.getItem(CART_STORAGE_KEY)
  if(raw){
    const parsed = JSON.parse(raw)
    if(Array.isArray(parsed)){
      // ensure numbers are numbers
      cart.value = parsed.map(item => ({
        lineId: String(item.lineId || _makeLineId()),
        productId: item.productId,
        name: item.name,
        price: Number(item.price || 0),
        quantity: Number(item.quantity || 0),
        options: Array.isArray(item.options) ? item.options.map(o => ({ id: o.id, name: o.name, price: Number(o.price || 0) })) : []
      }))
    }
  }
}catch(e){ console.warn('restore cart from localStorage failed', e) }
const customer = ref({ name: '', contact: '', address: { formattedAddress: '', number: '', complement: '', neighborhood: '', reference: '', observation: '', latitude: null, longitude: null, fullDisplay: '' } });
// load persisted customer if any (after customer is defined)
const savedCustomerRaw = localStorage.getItem(LOCAL_CUSTOMER_KEY) || localStorage.getItem(`public_customer_${companyId}`) || null
const savedCustomer = JSON.parse(savedCustomerRaw || 'null')
if(savedCustomer) {
  // merge with default shape to ensure nested fields (like address) exist
  // Support multiple customer shapes returned by backend: { name, contact } or { fullName, whatsapp } or nested 'customer' object
  const resolvedName = String(savedCustomer.name || savedCustomer.fullName || savedCustomer.customerName || (savedCustomer.customer && (savedCustomer.customer.fullName || savedCustomer.customer.name)) || '')
  const resolvedContact = String(savedCustomer.contact || savedCustomer.whatsapp || savedCustomer.phone || (savedCustomer.customer && (savedCustomer.customer.whatsapp || savedCustomer.customer.phone)) || '')
  customer.value = {
    name: resolvedName,
    contact: resolvedContact,
    address: (customer.value && customer.value.address) ? { ...customer.value.address } : { formattedAddress: '', number: '', complement: '', neighborhood: '', reference: '', observation: '', latitude: null, longitude: null, fullDisplay: '' }
  }
}
const neighborhood = ref('');
// list of neighborhoods (public) for this company
const neighborhoodsList = ref([])

const deliveryFee = computed(() => {
  try{
    // robust matching: try exact, id match, alias, and accent-insensitive match
    const normalize = (s) => {
      try{ return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g,'') }catch(e){ return String(s||'').trim().toLowerCase() }
    }
    const needleRaw = String(neighborhood.value || '')
    const needle = normalize(needleRaw)
    let found = null
    for(const x of (neighborhoodsList.value || [])){
      if(!x) continue
      // match by id directly
      if(String(x.id) === String(needleRaw)) { found = x; break }
      // exact name (case-insensitive)
      if(String(x.name || '').trim().toLowerCase() === String(needleRaw).trim().toLowerCase()){ found = x; break }
      // alias match
      if(Array.isArray(x.aliases) && x.aliases.some(a => String(a||'').trim().toLowerCase() === String(needleRaw).trim().toLowerCase())){ found = x; break }
      // normalized match to ignore accents/spaces/punctuation
      if(normalize(x.name) === needle) { found = x; break }
      if(Array.isArray(x.aliases) && x.aliases.some(a => normalize(a) === needle)){ found = x; break }
    }
    // dev-only debug info to diagnose why fee may appear as 0
    try{
      if(typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV){
        console.debug('[debug] deliveryFee lookup:', { needleRaw, found, neighborhoodsCount: (neighborhoodsList.value||[]).length })
      }
    }catch(e){}
    return Number(found?.deliveryFee || 0)
  }catch(e){ return 0 }
})
// explicit delivery fee used by UI/totals to ensure fee is calculated
const currentDeliveryFee = ref(0)

function refreshDeliveryFee(){
  try{
    const normalize = (s) => {
      try{ return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g,'') }catch(e){ return String(s||'').trim().toLowerCase() }
    }
    // allow neighborhood to be an object (from some address shapes)
    let needleRaw = neighborhood.value || ''
    try{ if(needleRaw && typeof needleRaw === 'object') needleRaw = needleRaw.name || needleRaw.id || String(needleRaw) }catch(e){}
    needleRaw = String(needleRaw || '')
    const needle = normalize(needleRaw)
    let found = null
    for(const x of (neighborhoodsList.value || [])){
      if(!x) continue
      if(String(x.id) === String(needleRaw)) { found = x; break }
      if(String(x.name || '').trim().toLowerCase() === String(needleRaw).trim().toLowerCase()){ found = x; break }
      if(Array.isArray(x.aliases) && x.aliases.some(a => String(a||'').trim().toLowerCase() === String(needleRaw).trim().toLowerCase())){ found = x; break }
      if(normalize(x.name) === needle) { found = x; break }
      if(Array.isArray(x.aliases) && x.aliases.some(a => normalize(a) === needle)){ found = x; break }
    }
    currentDeliveryFee.value = Number(found?.deliveryFee || 0)
    if(typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV){
      console.debug('[debug] refreshDeliveryFee ->', { neighborhood: neighborhood.value, currentDeliveryFee: currentDeliveryFee.value, found })
    }
  }catch(e){ currentDeliveryFee.value = 0 }
}
const paymentMethod = ref('CASH');
// when paying with cash, customer may provide a 'troco' amount
const changeFor = ref('');
// cashback state
const cashbackEnabled = ref(false)
const cashbackSettings = ref(null)
const wallet = ref({ balance: 0 })
const walletLoaded = ref(false)

// debug: log wallet changes to help trace why balance may be zero
try{
  watch([
    () => wallet.value,
    () => walletLoaded.value
  ], ([w, l]) => {
    try{ console.debug('[debug] wallet change', { wallet: w, walletLoaded: l, customer: (customer && customer.value) ? { name: customer.value.name, contact: customer.value.contact } : null }) }catch(e){}
  }, { deep: true })
}catch(e){}
const useCashback = ref(false)
const useCashbackAmount = ref(0)
// (info modal removed) handlers and visibility state deleted
const submitting = ref(false);
const serverError = ref('');
const clientError = ref('');
const orderResponse = ref(null);
const customerPhoneValid = computed(() => {
  try{
    const digits = removePhoneMask(customer.value.contact || '')
    return !!digits && (String(digits).length >= 10)
  }catch(e){ return false }
})
const isDev = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV

// compute whether a public customer is connected (token + stored customer)
const publicCustomerConnected = computed(() => {
  try{
    const token = localStorage.getItem('token')
    if(!token) return null
    if(!customer.value) return null
    return { name: customer.value.name || null, contact: customer.value.contact || null }
  }catch(e){ return null }
})

function logoutPublicCustomer(){
  try{
    localStorage.removeItem('token')
    localStorage.removeItem(LOCAL_CUSTOMER_KEY)
    localStorage.removeItem(`public_customer_${companyId}`)
  }catch(e){}
  customer.value = { name: '', contact: '', address: { formattedAddress: '', number: '', complement: '', neighborhood: '', reference: '', observation: '', latitude: null, longitude: null, fullDisplay: '' } }
  addresses.value = []
  selectedAddressId.value = null
  checkoutStep.value = 'customer'
}

function switchAccount(){
  router.push({ path: `/public/${companyId}/profile`, query: { tab: 'login' } })
}

// helper to build public API paths with optional storeId/menuId query params
function publicPath(path){
  try{
    const params = new URLSearchParams()
    if(storeId.value) params.set('storeId', storeId.value)
  if(menuId.value) params.set('menuId', menuId.value)
    const qs = params.toString()
    if(!qs) return path
    return `${path}${path.includes('?') ? '&' : '?'}${qs}`
  }catch(e){ return path }
}

const visibleCategories = computed(() => {
  // show all categories — navigation is handled via anchors now
  return categories.value || []
})

// map productId -> cashback percent (when provided on product object)
const productCashbackMap = computed(() => {
  const map = {}
  try{
    for(const c of (categories.value || [])){
      for(const p of (c.products || [])){
        if(p && (p.cashback || p.cashbackPercent)) map[String(p.id)] = Number(p.cashback || p.cashbackPercent || 0)
      }
    }
    for(const p of (uncategorized.value || [])){
      if(p && (p.cashback || p.cashbackPercent)) map[String(p.id)] = Number(p.cashback || p.cashbackPercent || 0)
    }
  }catch(e){}
  return map
})

// compute if company is open (client-side check)
const isOpen = computed(() => {
  const c = effectiveSettings()
  if(!c) return true
  // Prefer detailed weeklySchedule when present — it should take precedence
  // over coarse always-open flags stored at company level.

  const parseHM = (s) => {
    if(!s) return null
    const parts = String(s).split(':').map(x=>Number(x))
    if(parts.length<2) return null
    const [hh, mm] = parts
    if(Number.isNaN(hh) || Number.isNaN(mm)) return null
    return { hh, mm }
  }

  // Prefer weeklySchedule when provided (more precise). weeklySchedule is an array with { day, from, to, enabled }
  try{
    if(Array.isArray(c.weeklySchedule) && c.weeklySchedule.length){
      const tz = c.timezone || 'America/Sao_Paulo'
      const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      const parts = fmt.format(new Date()).split('/')
      const [dd, mm, yyyy] = parts
      const tzDate = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`)
      const weekDay = tzDate.getUTCDay()
      const today = c.weeklySchedule.find(d => Number(d?.day) === Number(weekDay))
      if(!today || !today.enabled) return false
      const from = parseHM(today.from)
      const to = parseHM(today.to)
      if(!from || !to) return false

      // compute current time in store timezone
      let nowParts
      try{
        const fmt2 = new Intl.DateTimeFormat(undefined, { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' })
        if(fmt2.formatToParts){
          const p = fmt2.formatToParts(new Date())
          nowParts = { hh: Number(p.find(x=>x.type==='hour')?.value), mm: Number(p.find(x=>x.type==='minute')?.value) }
        } else {
          const s = fmt2.format(new Date())
          const [hh, mm] = s.split(':').map(x=>Number(x))
          nowParts = { hh, mm }
        }
      }catch(e){ const d = new Date(); nowParts = { hh: d.getHours(), mm: d.getMinutes() } }

      const toMinutes = (p) => p.hh*60 + p.mm
      const nowM = toMinutes(nowParts)
      const fromM = toMinutes(from)
      const toM = toMinutes(to)
      if(fromM <= toM) return nowM >= fromM && nowM <= toM
      return (nowM >= fromM) || (nowM <= toM)
    }
  }catch(e){ console.warn('weeklySchedule parse failed', e) }
  // If weeklySchedule not provided or invalid, check coarse always-open flag
  if(isAlwaysOpenFlag(c)) return true

  // fallback: use openFrom/openTo fields
  const from = parseHM(c.openFrom)
  const to = parseHM(c.openTo)
  if(!from || !to) return false

  // compute current time in store timezone if provided using Intl
  let nowParts
  try{
    if(c.timezone){
      const fmt = new Intl.DateTimeFormat(undefined, { timeZone: c.timezone, hour12: false, hour: '2-digit', minute: '2-digit' })
      if(fmt.formatToParts){
        const parts = fmt.formatToParts(new Date())
        const hh = Number(parts.find(p=>p.type==='hour')?.value)
        const mm = Number(parts.find(p=>p.type==='minute')?.value)
        nowParts = { hh, mm }
      } else {
        const str = fmt.format(new Date())
        const [hh, mm] = str.split(':').map(x=>Number(x))
        nowParts = { hh, mm }
      }
    } else {
      const d = new Date(); nowParts = { hh: d.getHours(), mm: d.getMinutes() }
    }
  }catch(e){
    console.warn('Timezone parse failed on client, falling back to local time', e)
    const d = new Date(); nowParts = { hh: d.getHours(), mm: d.getMinutes() }
  }

  const toMinutes = (p) => p.hh*60 + p.mm
  const nowM = toMinutes(nowParts)
  const fromM = toMinutes(from)
  const toM = toMinutes(to)
  if(fromM <= toM){
    return nowM >= fromM && nowM <= toM
  }
  return (nowM >= fromM) || (nowM <= toM)
})

const companyHoursText = computed(() => {
  const c = effectiveSettings()
  if(!c) return ''
  // If weeklySchedule is present, prefer today's schedule range
  try{
    if(Array.isArray(c.weeklySchedule) && c.weeklySchedule.length){
      const tz = c.timezone || 'America/Sao_Paulo'
      const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      const parts = fmt.format(new Date()).split('/')
      const [dd, mm, yyyy] = parts
      const tzDate = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`)
      const weekDay = tzDate.getUTCDay()
      const today = c.weeklySchedule.find(d => Number(d?.day) === Number(weekDay))
      if(today && today.enabled){
        return `${today.from || '--:--'} — ${today.to || '--:--'}`
      }
    }
  }catch(e){ /* ignore and fallback */ }
  // If no weekly schedule, fall back to coarse always-open flag or openFrom/openTo
  if(isAlwaysOpenFlag(c)) return '24h'
  return `${c.openFrom || '--:--'} — ${c.openTo || '--:--'}`
})

 

const nextOpenText = computed(() => {
  const c = effectiveSettings()
  if(!c) return ''
  // Prefer weeklySchedule when present

  const padTime = (s) => s || '--:--'

  // If weeklySchedule present, find the next enabled day
  try{
    if(Array.isArray(c.weeklySchedule) && c.weeklySchedule.length){
      const tz = c.timezone || 'America/Sao_Paulo'
      const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      const parts = fmt.format(new Date()).split('/')
      const [dd, mm, yyyy] = parts
      const tzDate = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`)
      const weekDay = tzDate.getUTCDay()
      const schedule = c.weeklySchedule
      // check today first
      const today = schedule.find(d => Number(d?.day) === Number(weekDay))
      if(today && today.enabled){
        return `abre hoje às ${padTime(today.from)}`
      }
      // search next enabled day
      const names = ['domingo','segunda','terça','quarta','quinta','sexta','sábado']
      for(let i=1;i<7;i++){
        const idx = (weekDay + i) % 7
        const d = schedule.find(sch => Number(sch?.day) === Number(idx))
        if(d && d.enabled){
          if(i === 1) return `amanhã às ${padTime(d.from)}`
          return `abre ${names[idx]} às ${padTime(d.from)}`
        }
      }
    }
  }catch(e){ /* ignore */ }

    // fallback: when always open, don't show nextOpen text
    if(isAlwaysOpenFlag(c)) return ''
    // fallback: use openFrom if present
    if(c.openFrom) return `abre às ${c.openFrom}`
    return ''
})

  const openUntilText = computed(() => {
    // when store is open, return a friendly 'Aberto até as HH:MM' when possible
    try{
      const c = effectiveSettings()
      if(!c) return ''
        // prefer weeklySchedule today's 'to'
      if(Array.isArray(c.weeklySchedule) && c.weeklySchedule.length){
        const tz = c.timezone || 'America/Sao_Paulo'
        const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
        const parts = fmt.format(new Date()).split('/')
        const [dd, mm, yyyy] = parts
        const tzDate = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`)
        const weekDay = tzDate.getUTCDay()
        const today = c.weeklySchedule.find(d => Number(d?.day) === Number(weekDay))
        if(today && today.enabled && today.to) return `Aberto até as ${today.to}`
      }
      // fallback to openTo or always-open
      if(c.openTo) return `Aberto até as ${c.openTo}`
      if(isAlwaysOpenFlag(c)) return 'Aberto — 24h'
      return ''
    }catch(e){ return '' }
  })

// product options modal state
const modalOpen = ref(false)
const selectedProduct = ref(null)
const modalQty = ref(1)
const optionSelections = ref({}) // map groupId -> Set(optionId)
const modalError = ref('')
const searchTerm = ref('')
// option groups are always expanded — no collapse state needed
const tipMessages = reactive({}) // map key -> message for transient tips
// map groupId -> boolean indicating the group failed validation after an add attempt
const requiredWarnings = reactive({})
// human messages for group warnings (e.g. 'Escolha 2 opções')
const requiredMessages = reactive({})
// auto-change timers for press-and-hold
const _autoTimers = {}

function showTip(key, msg, ms = 1400){
  try{
    tipMessages[key] = msg
    setTimeout(()=>{ try{ delete tipMessages[key] }catch(e){} }, ms)
  }catch(e){ console.error('showTip', e) }
}
// swipe-down-to-close support (mobile)
const modalContentRef = ref(null)
let _dragging = false
let _startY = 0
let _lastY = 0
let _lastTime = 0



function onPointerDown(e){
  try{
    if(window.innerWidth > 767) return
    const el = modalContentRef.value
    if(!el) return
    // only start drag if scrollTop is at the top (so scrolling doesn't conflict)
    if(el.scrollTop > 0) return
    _dragging = true
    _startY = e.clientY
    _lastY = e.clientY
    _lastTime = Date.now()
    // disable transition while dragging
    el.style.transition = 'none'
    // capture pointer if supported
    try{ e.target && e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId) }catch(err){}
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }catch(err){ console.error('onPointerDown error', err) }
}

function onPointerMove(e){
  if(!_dragging) return
  const el = modalContentRef.value
  if(!el) return
  const dy = Math.max(0, e.clientY - _startY)
  // apply a slight resistance beyond 200px
  const translate = dy > 200 ? 200 + (dy - 200) * 0.2 : dy
  el.style.transform = `translateY(${translate}px)`
  // record last for velocity
  _lastY = e.clientY
  _lastTime = Date.now()
}

function onPointerUp(e){
  if(!_dragging) return
  const el = modalContentRef.value
  if(!el) return
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  const dy = Math.max(0, e.clientY - _startY)
  const dt = Math.max(1, Date.now() - _lastTime)
  const vy = (e.clientY - _lastY) / dt
  _dragging = false
  // restore transition for animation
  el.style.transition = 'transform .18s ease'
  // close threshold: dragged enough or flicked fast
  if(dy > 120 || vy > 0.7){
    // animate out then close
    el.style.transform = `translateY(100%)`
    setTimeout(()=>{
      // reset transform and close
      try{ el.style.transition = ''; el.style.transform = '' }catch(e){}
      closeModal()
    }, 180)
  } else {
    // revert
    el.style.transform = 'translateY(0)'
    setTimeout(()=>{ try{ el.style.transition = ''; }catch(e){} }, 180)
  }
}

// Helper to prefer a thumbnail URL for option images when available.
// Strategy: try the 'thumbs' subfolder variant first, fall back to the original
// image URL on error. This keeps frontend resilient regardless of backend
// thumbnail generation.
function optionThumbUrl(opt){
  try{
    if(!opt) return ''
    const s = String(opt.image || '')
    if(!s) return ''
    // If path contains '/public/uploads/options/', insert 'thumbs/' segment
    // Works for full absolute URLs and relative paths.
    if(s.includes('/public/uploads/options/')){
      return assetUrl(s.replace('/public/uploads/options/', '/public/uploads/options/thumbs/'))
    }
    // also handle when path starts with 'public/uploads/options/' (no leading slash)
    if(s.startsWith('public/uploads/options/')){
      return assetUrl(s.replace('public/uploads/options/', 'public/uploads/options/thumbs/'))
    }
    // fallback: return original image URL via assetUrl
    return assetUrl(s)
  }catch(e){ return assetUrl(opt.image) }
}

function onOptionThumbError(evt, opt){
  try{
    if(!evt || !evt.target) return
    // prevent infinite loop by clearing onerror before changing src
    try{ evt.target.onerror = null }catch(e){}
    // set to the original image (non-thumb) so browser will try that
    evt.target.src = assetUrl(opt && opt.image ? opt.image : '')
  }catch(e){ /* ignore */ }
}
// cart modal (view-only) so users can inspect the bag without entering data
// restore persisted modal state and auto-open preference
const persistedCartModal = localStorage.getItem('public_cart_modal_open')
const cartModalOpen = ref(persistedCartModal === null ? false : persistedCartModal === 'true')

// migration notice state: used when persisted cart is reconciled against a newer menu
const migrationSummary = ref([])
const showCartMigration = ref(false)
function showMigrationNotice(items){
  try{
    if(!items || !items.length) return
    migrationSummary.value = items.slice(0, 8) // limit to a reasonable number
    showCartMigration.value = true
    // auto-hide after 7s
    setTimeout(() => { try{ showCartMigration.value = false }catch(e){} }, 7000)
  }catch(e){ console.warn('showMigrationNotice err', e) }
}

/* cart auto-open preference removed — feature deprecated */

function openCartModal(){ cartModalOpen.value = true }
function closeCartModal(){ cartModalOpen.value = false }
function proceedFromCart(){ closeCartModal(); openCheckout() }

// when user picks a saved address, update current neighborhood (this drives delivery fee calculation)
watch(selectedAddressId, (v) => {
  try{
    const a = addresses.value.find(x => x.id === v)
    let n = a ? (a.neighborhood || '') : ''
    // normalize if neighborhood stored as object { id,name }
    try{ if(n && typeof n === 'object'){ n = n.name || n.title || n.id || String(n) } }catch(e){}
    neighborhood.value = n || ''
    // ensure delivery fee is refreshed when selected address changes
    try{
      console.debug('[debug] selectedAddressId changed ->', { v, neighborhood: neighborhood.value })
      refreshDeliveryFee()
    }catch(e){}
  }catch(e){ console.warn('watch selectedAddressId', e) }
})

// body scroll lock removed: avoid changing document.body styles here

// persist preferences and modal open state
watch(cartModalOpen, v => {
  try{ localStorage.setItem('public_cart_modal_open', v ? 'true' : 'false') }catch(e){}
})
// persist cart to localStorage on every change
watch(cart, (v) => {
  try{ localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(v || [])) }catch(e){ console.warn('persist cart failed', e) }
}, { deep: true })

// re-evaluate customer-group discounts when cart or customer state changes
watch([
  () => cart.value.length,
  () => subtotal.value,
  () => publicCustomerConnected.value,
  () => (customer.value && customer.value.contact) ? String(customer.value.contact) : ''
], () => {
  try{ scheduleEvaluateDiscounts() }catch(e){}
}, { deep: true })

// refresh delivery fee when inline customer address changes
watch(() => (customer.value && customer.value.address && customer.value.address.formattedAddress) ? String(customer.value.address.formattedAddress) : '', (v) => {
  try{ refreshDeliveryFee() }catch(e){}
})
// Note: automatic opening of the cart when items are added was removed.

// re-evaluate discounts when order type changes (PICKUP/DELIVERY)
watch(orderType, (v) => { try{ scheduleEvaluateDiscounts() }catch(e){} })

const formatCurrency = (v) => {
  try{ return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v)); }catch(e){ return v; }
}

function _makeLineId(){ return String(Date.now()) + '-' + Math.random().toString(36).slice(2,9) }

function _optionsKey(opts){ try{ return JSON.stringify((opts||[]).map(o=>({ id: o.id }))) }catch(e){ return '' } }

function findCartIndex(productId, options){
  const key = _optionsKey(options)
  return cart.value.findIndex(i => i.productId === productId && _optionsKey(i.options) === key)
}

function optionsSummary(it){
  try{
    if(!it || !it.options || !it.options.length) return ''
    // group by option id to preserve distinct prices
    const map = {}
    for(const o of it.options){
      if(!o) continue
      const id = String(o.id || o.name || Math.random())
      const name = String(o.name || '').trim()
      const price = Number(o.price || 0)
      if(!map[id]) map[id] = { name, unitPrice: price, count: 0 }
      map[id].count += 1
    }
    const parts = []
    for(const k of Object.keys(map)){
      const entry = map[k]
      if(!entry.name) continue
      const cnt = entry.count
      if(entry.unitPrice && entry.unitPrice > 0){
        // show total price for the option group (count * unitPrice)
        const total = entry.unitPrice * cnt
        parts.push(cnt > 1 ? `${cnt}x ${entry.name} ${formatCurrency(total)}` : `${entry.name} ${formatCurrency(entry.unitPrice)}`)
      } else {
        parts.push(cnt > 1 ? `${cnt}x ${entry.name}` : entry.name)
      }
    }
    return parts.join(', ')
  }catch(e){ return '' }
}

function optionsSummaryNoPrice(it){
  try{
    if(!it || !it.options || !it.options.length) return ''
    const counts = {}
    for(const o of it.options){
      if(!o) continue
      const name = String(o.name || '').trim()
      if(!name) continue
      counts[name] = (counts[name] || 0) + 1
    }
    const parts = []
    for(const [name, cnt] of Object.entries(counts)){
      parts.push(cnt > 1 ? `${cnt}x ${name}` : name)
    }
    return parts.join(', ')
  }catch(e){ return '' }
}

// Validate the persisted cart against the loaded menu.
// - remove items whose product no longer exists
// - remove options that don't exist anymore
// - recalculate unit price (product base + options) and ensure quantity >= 1
function validatePersistedCart(){
  try{
    if(!cart.value || !cart.value.length) return
    // collect all products from categories + uncategorized
    const allProducts = []
    for(const c of categories.value || []){
      if(Array.isArray(c.products)) allProducts.push(...c.products)
    }
    if(Array.isArray(uncategorized.value)) allProducts.push(...uncategorized.value)

    const newCart = []
    let changed = false
    const removedItems = []
    for(const it of cart.value){
      const p = allProducts.find(x => x.id === it.productId)
      if(!p){ changed = true; removedItems.push(it.name || String(it.productId)); continue } // product removed from menu

      // build option map from product definition
      const optMap = {}
      if(p.optionGroups && Array.isArray(p.optionGroups)){
        for(const g of p.optionGroups){
          for(const o of (g.options || [])) optMap[o.id] = { id: o.id, name: o.name, price: Number(o.price || 0) }
        }
      }

      const validatedOptions = []
      let optionsTotal = 0
      let optionDropped = false
      if(Array.isArray(it.options)){
        for(const oo of it.options){
          const oid = oo && (oo.id || oo)
          if(oid && optMap[oid]){
            validatedOptions.push({ id: optMap[oid].id, name: optMap[oid].name, price: Number(optMap[oid].price) })
            optionsTotal += Number(optMap[oid].price)
          } else {
            // option missing -> drop it
            changed = true
            optionDropped = true
          }
        }
      }

      const unit = Number(p.price || 0) + optionsTotal
      const qty = Math.max(1, Number(it.quantity || 1))
      newCart.push({ lineId: it.lineId || _makeLineId(), productId: p.id, name: p.name, price: unit, quantity: qty, options: validatedOptions, image: it.image, categoryId: p.categoryId || null })
      if(optionDropped) removedItems.push(`${it.name} (opções removidas)`)
    }

    if(changed || newCart.length !== cart.value.length){
      cart.value = newCart
      if(removedItems.length) showMigrationNotice(removedItems)
    }
  }catch(e){ console.warn('validatePersistedCart error', e) }
}

function addToCart(p, options = []){
  // add/merge considering selected options
  const idx = findCartIndex(p.id, options)
  if(idx >= 0){ cart.value[idx].quantity += 1 }
  else {
    cart.value.push({ lineId: _makeLineId(), productId: p.id, name: p.name, price: Number(p.price), quantity: 1, options: options || [], categoryId: p.categoryId || null })
  }
}

function addToCartWithOptions(p, selections, qty=1){
  // selections: { groupId: [optionIds] }
  // compute options total price
  let optionsTotal = 0
  const selectedOptions = []
  if(p.optionGroups && p.optionGroups.length){
    for(const g of p.optionGroups){
      const sel = selections[g.id] || []
      for(const oid of sel){
        const opt = (g.options||[]).find(o=>o.id===oid)
        if(opt){ optionsTotal += Number(opt.price||0); selectedOptions.push({ id: opt.id, name: opt.name, price: Number(opt.price||0) }) }
      }
    }
  }
  const unitPrice = Number(p.price||0) + optionsTotal
  // try to merge with existing line that has same productId+options
  const idx = findCartIndex(p.id, selectedOptions)
  if(idx >= 0){ cart.value[idx].quantity += qty }
  else { cart.value.push({ lineId: _makeLineId(), productId: p.id, name: p.name, price: unitPrice, quantity: qty, options: selectedOptions, categoryId: p.categoryId || null }) }
}

function openProductModal(p, force = false){
  // If there are no option groups and not forcing the modal, quick-add directly to cart
  if(!force && (!p.optionGroups || !p.optionGroups.length)){
    addToCartWithOptions(p, {}, 1)
    return
  }

  selectedProduct.value = p
  modalQty.value = 1
  modalError.value = ''
  searchTerm.value = ''
  // initialize selections with defaults (empty)
  const map = {}
  if(p.optionGroups){
    for(const g of p.optionGroups){
      // If group allows only one selection and is mandatory, use radio-array shape
      if(g.max === 1 && (g.min || 0) > 0) map[g.id] = []
      else map[g.id] = {}
      // clear previous required warnings for this group's id when opening modal
      try{ delete requiredWarnings[g.id]; delete requiredMessages[g.id] }catch(e){}
    }
  }
  optionSelections.value = map
  modalOpen.value = true
}

function filterOptions(group){
  const q = (searchTerm.value || '').toLowerCase().trim()
  if(!q) return group.options || []
  // hide options that are explicitly marked unavailable (false). Treat undefined as available.
  const available = (group.options || []).filter(o => o.isAvailable !== false)
  return available.filter(o => (o.name||'').toLowerCase().includes(q))
}

function qtyFor(groupId, optionId){
  const gsel = optionSelections.value[groupId]
  if(!gsel) return 0
  return Number(gsel[optionId] || 0)
}

function setQty(group, option, value){
  try{
    if(option && option.isAvailable === false) return
    const gid = group.id
    const max = group.max || 99
    let v = Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0
    if(v > max) v = max
    // compute current total excluding this option
    const gsel = optionSelections.value[gid] || {}
    let total = 0
    for(const k of Object.keys(gsel)){
      if(k === option.id) continue
      total += Number(gsel[k] || 0)
    }
    // remaining capacity
    const remaining = Math.max(0, max - total)
    const desired = v
    if(v > remaining) v = remaining
    if(desired > v){
      // inform user we clamped to remaining
      showTip(`${gid}:${option.id}`, `Máximo de ${max} atingido`) 
    }
    // set or delete
    const next = { ...(optionSelections.value[gid] && !Array.isArray(optionSelections.value[gid]) ? optionSelections.value[gid] : {}) }
    if(v > 0) next[option.id] = v
    else delete next[option.id]
    optionSelections.value[gid] = next
    // clear warning for this group if requirement now satisfied
    try{
      const minReq = group.min || 0
      let cur = 0
      for(const k of Object.keys(next)) cur += Number(next[k] || 0)
      if(cur >= minReq) { try{ delete requiredWarnings[gid]; delete requiredMessages[gid] }catch(e){} }
    }catch(e){}
  }catch(err){ console.error('setQty error', err) }
}

function adjustQty(group, option, delta){
  const cur = qtyFor(group.id, option.id)
  const desired = Math.max(0, cur + delta)
  setQty(group, option, desired)
  try{ if(window.navigator && window.navigator.vibrate) window.navigator.vibrate(8) }catch(e){}
}

function startAutoChange(group, option, delta, ev){
  const key = `${group.id}:${option.id}`
  // do immediate change
  adjustQty(group, option, delta)
  // if existing timer, clear
  stopAutoChange(group, option, ev)
  // start a timeout, then interval for rapid changes
  const t = {}
  // store the pressed element for visual state
  try{ t.el = ev && (ev.currentTarget || ev.target) }catch(e){}
  if(t.el) try{ t.el.classList && t.el.classList.add('pressed') }catch(e){}
  t.timeout = setTimeout(()=>{
    t.interval = setInterval(()=> adjustQty(group, option, delta), 120)
  }, 420)
  _autoTimers[key] = t
}

function stopAutoChange(group, option, ev){
  const key = `${group.id}:${option.id}`
  const t = _autoTimers[key]
  if(!t) return
  if(t.timeout) clearTimeout(t.timeout)
  if(t.interval) clearInterval(t.interval)
  // remove pressed class if present
  try{
    const el = (t && t.el) || (ev && (ev.currentTarget || ev.target))
    if(el && el.classList) el.classList.remove('pressed')
  }catch(e){}
  delete _autoTimers[key]
}

function selectRadio(group, option){
  if(option && option.isAvailable === false) return
  optionSelections.value[group.id] = [option.id]
  // radio selection satisfies min for the group if min>=1
  try{ if((group.min || 0) <= 1) { try{ delete requiredWarnings[group.id]; delete requiredMessages[group.id] }catch(e){} } }catch(e){}
}

function isOptionSelected(group, option){
  const sel = optionSelections.value[group.id] || []
  if(Array.isArray(sel)) return sel.indexOf(option.id) >= 0
  // object map: selected if qty>0
  return Number((sel && sel[option.id]) || 0) > 0
}

function computeLineDiscount(it){
  try{
    if(!it || !it.productId) return 0
    // aggregate total discount for this productId from discountsList
    const prodId = String(it.productId)
    const entries = (discountsList.value || []).filter(d => d.productId && String(d.productId) === prodId)
    if(!entries.length) return 0
    const totalForProduct = entries.reduce((s,e)=>s + Number(e.amount || 0), 0)
    // if multiple cart lines with same productId, distribute proportionally by line total
    const lines = (cart.value || []).filter(x => String(x.productId) === prodId)
    const productSum = lines.reduce((s,x)=> s + (Number(x.price||0) * Number(x.quantity||0)), 0)
    if(productSum <= 0) return 0
    const lineTotal = Number(it.price||0) * Number(it.quantity||0)
    const share = (lineTotal / productSum)
    const allocated = Math.round((totalForProduct * share) * 100) / 100
    return allocated
  }catch(e){ return 0 }
}

function getLineDiscountEntries(it){
  if(!it || !it.productId) return [];
  var prodId = String(it.productId);
  var entries = (discountsList.value || []).filter(function(d){ return d.productId && String(d.productId) === prodId; });
  if(!entries.length) return [];

  var groups = {};
  for(var i=0;i<entries.length;i++){
    var e = entries[i];
    var key = (e.ruleId || '') + '::' + (e.description || '');
    if(!groups[key]) groups[key] = { description: e.description || 'Desconto', amount: 0 };
    groups[key].amount += Number(e.amount || 0);
  }

  var lines = (cart.value || []).filter(function(x){ return String(x.productId) === prodId; });
  var productSum = lines.reduce(function(s,x){ return s + (Number(x.price || 0) * Number(x.quantity || 0)); }, 0);
  var lineTotal = Number(it.price || 0) * Number(it.quantity || 0);

  var out = [];
  var keys = Object.keys(groups);
  for(var j=0;j<keys.length;j++){
    var grp = groups[keys[j]];
    var allocated = grp.amount;
    if(productSum > 0){
      var share = lineTotal / productSum;
      allocated = Math.round((grp.amount * share) * 100) / 100;
    }
    if(allocated > 0){
      out.push({ description: String(grp.description || ''), amount: Number(allocated) });
    }
  }
  return out;
}

function confirmAddFromModal(){
  modalError.value = ''
  const p = selectedProduct.value
  const selectionsForCart = {}
  if(p && p.optionGroups){
    for(const g of p.optionGroups){
      const raw = optionSelections.value[g.id]
      let total = 0
      if(Array.isArray(raw)){
        total = raw.length
        selectionsForCart[g.id] = raw.slice()
      } else {
        // raw is a map optionId->qty
        const arr = []
        for(const oid of Object.keys(raw || {})){
          const q = Math.max(0, Number(raw[oid] || 0))
          total += q
          for(let i=0;i<q;i++) arr.push(oid)
        }
        selectionsForCart[g.id] = arr
      }
      if((g.min || 0) > total){ 
        // mark warning for this group and keep checking others
        requiredWarnings[g.id] = true
        requiredMessages[g.id] = `Escolha ${g.min || 0} opção(s)`
      } else {
        // clear any previous warning for this group
        try{ delete requiredWarnings[g.id]; delete requiredMessages[g.id] }catch(e){}
      }
      if(g.max && total > g.max){ 
        // max violation - keep using modalError for this case
        modalError.value = `Máximo ${g.max} opção(ões) permitido para "${g.name}"`; return 
      }
    }
    }
    // if any required warnings present, do not proceed and remove modal alert
    const failing = Object.keys(requiredWarnings).length > 0
    if(failing){
      try{
        const first = Object.keys(requiredWarnings)[0]
        const el = document.getElementById('grp-' + first)
        if(el){
          // prefer scrolling inside the modal options column when available
          const modalCol = el.closest('.modal-options-scroll') || document.querySelector('.modal-options-scroll')
          if(modalCol){
            // compute offset of element relative to the scroll container
            const elRect = el.getBoundingClientRect()
            const contRect = modalCol.getBoundingClientRect()
            const offset = (elRect.top - contRect.top) + modalCol.scrollTop - 12
            modalCol.scrollTo({ top: offset, behavior: 'smooth' })
          } else {
            // fallback: scroll the window as before (account for header)
            const headerEl = document.querySelector('header, .site-header, .navbar, .app-header')
            const headerH = headerEl ? headerEl.getBoundingClientRect().height : 0
            const top = el.getBoundingClientRect().top + window.pageYOffset - headerH - 12
            window.scrollTo({ top, behavior: 'smooth' })
          }
          try{
            // add a temporary pulse highlight class to draw attention
            el.classList.add('required-pulse')
            // remove after animation completes
            setTimeout(()=>{ try{ el.classList.remove('required-pulse') }catch(e){} }, 900)
          }catch(e){}
        }
      }catch(e){ console.warn('scroll to required group failed', e) }
      return
    }
    // no required warnings -> proceed
    addToCartWithOptions(p, selectionsForCart, modalQty.value)
    modalOpen.value = false
}

function groupSelectedCount(g){
  const raw = optionSelections.value[g.id]
  if(!raw) return 0
  if(Array.isArray(raw)) return raw.length
  let s = 0
  for(const k of Object.keys(raw)) s += Number(raw[k] || 0)
  return s
}

function closeModal(){ modalOpen.value = false; modalError.value = '' }

function shareStub(){
  // placeholder for native share / copy link — no-op for now
  try{ if(navigator && navigator.share){ navigator.share({ title: selectedProduct.value?.name || '', url: window.location.href }) } }
  catch(e){ /* ignore */ }
}
// modal quantity auto-change (press-and-hold) support — mirrors option qty UI
let _modalAutoTimer = null
function adjustModalQty(delta){
  try{
    const cur = Number.isFinite(Number(modalQty.value)) ? Math.floor(Number(modalQty.value)) : 1
    modalQty.value = Math.max(1, cur + delta)
    try{ if(window.navigator && window.navigator.vibrate) window.navigator.vibrate(8) }catch(e){}
  }catch(e){ console.error('adjustModalQty', e) }
}

function startModalAutoChange(delta, ev){
  // immediate change
  adjustModalQty(delta)
  // clear existing
  stopModalAutoChange()
  const t = {}
  try{ t.el = ev && (ev.currentTarget || ev.target) }catch(e){}
  if(t.el) try{ t.el.classList && t.el.classList.add('pressed') }catch(e){}
  t.timeout = setTimeout(()=>{ t.interval = setInterval(()=> adjustModalQty(delta), 120) }, 420)
  _modalAutoTimer = t
}

function stopModalAutoChange(ev){
  const t = _modalAutoTimer
  if(!t) return
  if(t.timeout) clearTimeout(t.timeout)
  if(t.interval) clearInterval(t.interval)
  try{
    const el = (t && t.el) || (ev && (ev.currentTarget || ev.target))
    if(el && el.classList) el.classList.remove('pressed')
  }catch(e){}
  _modalAutoTimer = null
}
function incQuantity(i){ cart.value[i].quantity += 1; }
function decQuantity(i){ cart.value[i].quantity = Math.max(1, cart.value[i].quantity - 1); }
function removeItem(i){ cart.value.splice(i,1); }

function incrementProduct(p){
  // Always open the product modal to force selection (even for products without option groups)
  openProductModal(p, true)
}

function decrementProduct(p){
  // prefer decrementing a line with no options first
  let idx = findCartIndex(p.id, []);
  if(idx >= 0){
    if(cart.value[idx].quantity > 1) cart.value[idx].quantity -= 1;
    else cart.value.splice(idx,1);
    return;
  }

  // otherwise decrement the first matching line for that product (any options)
  idx = cart.value.findIndex(i=>i.productId===p.id);
  if(idx>=0){
    if(cart.value[idx].quantity>1) cart.value[idx].quantity -= 1;
    else cart.value.splice(idx,1);
  }
}
function getCartQty(productId){
  return cart.value.filter(i=>i.productId===productId).reduce((s,it)=>s+it.quantity,0)
}

// Coupon and discounts state
const openCoupon = ref(false)
const couponCode = ref('')
const couponApplied = ref(false)
const couponDiscount = ref(0)
const couponInfo = ref(null)
const couponLoading = ref(false)

const discountsList = ref([])
const discountsTotal = ref(0)
const discountsLoading = ref(false)
let _discountsDebounce = null

async function evaluateDiscountsNow(){
  try{
    discountsLoading.value = true
    const items = cart.value.map(i=>({ productId: i.productId, categoryId: i.categoryId, price: i.price, quantity: i.quantity }))
    // only evaluate customer-group discounts for logged-in customers
    if(!publicCustomerConnected.value){
      discountsList.value = []
      discountsTotal.value = 0
      return
    }
    // include customer phone, order type and coupon state so backend can resolve the logged customer and delivery restrictions
    const payload = {
      items,
      subtotal: subtotal.value,
      customerPhone: (customer.value && customer.value.contact) ? customer.value.contact : undefined,
      orderType: orderType.value,
      couponApplied: couponApplied.value
    }
    const resp = await api.post(`/public/${companyId}/cart/discounts`, payload)
    discountsList.value = resp.data?.discounts || []
    discountsTotal.value = Number(resp.data?.totalDiscount || 0)
  }catch(e){
    discountsList.value = []
    discountsTotal.value = 0
  }finally{ discountsLoading.value = false }
}

function scheduleEvaluateDiscounts(){
  try{ if(_discountsDebounce) clearTimeout(_discountsDebounce) }catch(e){}
  _discountsDebounce = setTimeout(()=> evaluateDiscountsNow(), 300)
}

// Final total after coupon discount and customer-group discounts. Delivery fee is calculated only after the
// customer selects an address (neighborhood). The CTA and cart should not
// include delivery fee until a neighborhood is chosen.
const finalTotal = computed(() => {
  try{
    const base = Math.max(0, subtotal.value - (couponDiscount.value || 0) - (discountsTotal.value || 0))
    const includeDelivery = orderType.value === 'DELIVERY' && neighborhood.value && String(neighborhood.value).trim() !== ''
    // prefer explicit refreshed fee when available
    const fee = Number(currentDeliveryFee.value || 0) || Number(deliveryFee.value || 0)
    const beforeCashback = base + (includeDelivery ? fee : 0)
    const cashbackDeduction = Number(useCashbackAmount.value || 0)
    return Math.max(0, beforeCashback - cashbackDeduction)
  }catch(e){ return subtotal.value }
})

async function applyCoupon(){
    try{
      if(!couponCode.value || !couponCode.value.trim()){
        // show inline message under coupon input
        tipMessages['coupon'] = 'Insira um código válido'
        setTimeout(()=>{ try{ delete tipMessages['coupon'] }catch(e){} }, 1600)
        return
      }
      couponLoading.value = true
      // call public coupon validation endpoint
  const res = await api.post(publicPath(`/public/${companyId}/coupons/validate`), { code: couponCode.value.trim(), subtotal: subtotal.value, customerPhone: (customer.value && customer.value.contact) ? customer.value.contact : undefined })
      const data = res.data || {}
      if(data && data.valid){
        couponApplied.value = true
        couponDiscount.value = Number(data.discountAmount || 0)
        couponInfo.value = data.coupon || null
        openCoupon.value = false
          // re-evaluate customer-group discounts when a coupon is applied
          try{ scheduleEvaluateDiscounts() }catch(e){}
        tipMessages['coupon-success'] = `Cupom aplicado: -${formatCurrency(couponDiscount.value)}`
        setTimeout(()=>{ try{ delete tipMessages['coupon-success'] }catch(e){} }, 2000)
        return
      }
      tipMessages['coupon'] = 'Cupom inválido'
      setTimeout(()=>{ try{ delete tipMessages['coupon'] }catch(e){} }, 1600)
    }catch(e){
      const msg = e?.response?.data?.message || 'Erro ao validar cupom'
      tipMessages['coupon'] = msg
      setTimeout(()=>{ try{ delete tipMessages['coupon'] }catch(e){} }, 2000)
      console.warn('applyCoupon error', e)
    } finally {
      couponLoading.value = false
    }
}

function removeCoupon(){ couponApplied.value = false; couponDiscount.value = 0; couponInfo.value = null; try{ scheduleEvaluateDiscounts() }catch(e){} }

function editCartItem(i){
  try{
    const it = cart.value[i]
    if(!it) return
    // find product in categories or uncategorized
    let p = null
    for(const c of categories.value){
      p = (c.products || []).find(x=>x.id === it.productId)
      if(p) break
    }
    if(!p){ p = (uncategorized.value || []).find(x=>x.id === it.productId) }
    if(!p) return
    // close the cart drawer so the product modal is visible
    try{ closeCartModal() }catch(e){}
    // open modal and prefill selections
    selectedProduct.value = p
    modalQty.value = Number(it.quantity || 1)
    modalError.value = ''
    const map = {}
    if(p.optionGroups){
      for(const g of p.optionGroups){
        if(g.max === 1 && (g.min || 0) > 0) map[g.id] = []
        else map[g.id] = {}
      }
    }
    // apply options from cart item
    if(it.options && it.options.length && p.optionGroups){
      for(const opt of it.options){
        for(const g of p.optionGroups){
          const found = (g.options||[]).find(o=>o.id === opt.id)
          if(found){
            if(Array.isArray(map[g.id])) map[g.id].push(opt.id)
            else map[g.id][opt.id] = (map[g.id][opt.id] || 0) + 1
            break
          }
        }
      }
    }
    optionSelections.value = map
    modalOpen.value = true
  }catch(e){ console.error('editCartItem', e) }
}

// modal total: product price + selected options (per unit) multiplied by quantity
const modalTotal = computed(() => {
  try{
    const p = selectedProduct.value
    if(!p) return 0
    let optionsTotalPerUnit = 0
    if(p.optionGroups && p.optionGroups.length){
      for(const g of p.optionGroups){
        const raw = optionSelections.value[g.id]
        if(!raw) continue
        if(Array.isArray(raw)){
          for(const oid of raw){
            const opt = (g.options||[]).find(o=>o.id === oid)
            if(opt) optionsTotalPerUnit += Number(opt.price || 0)
          }
        } else {
          // map of optionId -> qty
          for(const oid of Object.keys(raw || {})){
            const q = Math.max(0, Number(raw[oid] || 0))
            if(q <= 0) continue
            const opt = (g.options||[]).find(o=>o.id === oid)
            if(opt) optionsTotalPerUnit += Number(opt.price || 0) * q
          }
        }
      }
    }
    const unit = Number(p.price || 0) + optionsTotalPerUnit
    const qty = Math.max(1, Number.isFinite(Number(modalQty.value)) ? Math.floor(Number(modalQty.value)) : 1)
    return unit * qty
  }catch(e){ return 0 }
})

// transient inputs for adding/editing a new address in modal
const _newAddrLabel = ref('')
const _newAddrFormatted = ref('')
const _newAddrNumber = ref('')
const _newAddrComplement = ref('')
const _newAddrNeighborhood = ref('')
const _newAddrReference = ref('')
const _newAddrObservation = ref('')
const _newAddrLat = ref(null)
const _newAddrLon = ref(null)
const _newAddrFull = ref('') // store full display_name from reverse geocode if available
const _locating = ref(false)
const editingAddressId = ref(null)

// control visibility of the "new address" form inside checkout delivery step
// If the user has no saved addresses, we show the form by default so they can
// enter an address and continue without having to save it. If they have saved
// addresses, we show the selector and a small shortcut "Cadastrar novo endereço"
// to reveal the form.
const showNewAddressForm = ref(addresses.value.length === 0)
function clearNewAddress(){
  _newAddrLabel.value = ''
  _newAddrFormatted.value = ''
  _newAddrNumber.value = ''
  _newAddrComplement.value = ''
  _newAddrNeighborhood.value = ''
  _newAddrReference.value = ''
  _newAddrObservation.value = ''
  _newAddrLat.value = null
  _newAddrLon.value = null
  _newAddrFull.value = ''
  editingAddressId.value = null
  // hide the new-address form when user has saved addresses
  showNewAddressForm.value = addresses.value.length === 0
}

async function performOrderFromModal(){
  // populate customer/address from modal selections and call submitOrder
  if(orderType.value === 'DELIVERY'){
    // prefer a selected saved address, but allow a temporary address entered in the
    // flow (customer.value.address) when the user didn't save it.
    const a = addresses.value.find(x=>x.id===selectedAddressId.value)
    if(a){
      if(!customer.value.address) customer.value.address = { formattedAddress: '', number: '', complement: '', neighborhood: '', reference: '', observation: '', latitude: null, longitude: null, fullDisplay: '' }
      customer.value.address.formattedAddress = a.formattedAddress
      customer.value.address.number = a.number || ''
      customer.value.address.complement = a.complement || ''
      customer.value.address.neighborhood = a.neighborhood || ''
      customer.value.address.reference = a.reference || ''
      customer.value.address.observation = a.observation || ''
      customer.value.address.fullDisplay = a.fullDisplay || ''
      // copy additional optional fields so payload contains full address shape
      try{ customer.value.address.postalCode = a.postalCode || a.postal_code || '' }catch(e){}
      try{ customer.value.address.city = a.city || '' }catch(e){}
      try{ customer.value.address.state = a.state || '' }catch(e){}
      try{ customer.value.address.country = a.country || '' }catch(e){}
      try{ customer.value.address.latitude = a.latitude ?? a.lat ?? null }catch(e){}
      try{ customer.value.address.longitude = a.longitude ?? a.lon ?? a.lng ?? null }catch(e){}
      neighborhood.value = a.neighborhood || ''
    } else if(customer.value.address && customer.value.address.formattedAddress){
      // already filled via inline "Usar para este pedido" or nextFromDelivery copy
      neighborhood.value = customer.value.address.neighborhood || ''
      // ensure reference is present when user filled inline fields
      customer.value.address.reference = customer.value.address.reference || _newAddrReference.value || ''
    } else {
      clientError.value = 'Selecione um endereço'; return
    }
  } else {
    // pickup: clear address
    if(customer.value.address) {
      customer.value.address.formattedAddress = ''
      customer.value.address.neighborhood = ''
    }
    neighborhood.value = ''
  }
  // persist customer
  saveCustomerToLocal()
  // call existing submitOrder
  await submitOrder()
  // if success (orderResponse set), close modal
  if(orderResponse.value){ closeCheckout() }
}

function handleContactInput(e) {
  customer.value.contact = applyPhoneMask(e.target.value)
}

function nextFromCustomer(){
  clientError.value = ''
  if(!customer.value || !customer.value.name || !customer.value.contact){
    clientError.value = 'Preencha nome e WhatsApp'
    return
  }
  // validate whatsapp digits (require DDD + number -> 10 or 11 digits)
  try{
    const digits = removePhoneMask(customer.value.contact || '')
    if(!digits || String(digits).length < 10){
      clientError.value = 'Informe um número de WhatsApp válido (inclua DDD)'
      return
    }
  }catch(e){ /* ignore */ }
  saveCustomerToLocal()
  checkoutStep.value = 'delivery'
}

function addNewAddress(){
  clientError.value = ''
  if(!_newAddrFormatted.value || !_newAddrNeighborhood.value){
    clientError.value = 'Preencha endereço e bairro'
    return
  }
  // ensure selected neighborhood exists in canonical list
  try{
    const found = (neighborhoodsList.value || []).find(n => String(n.name || '').trim().toLowerCase() === String(_newAddrNeighborhood.value || '').trim().toLowerCase())
    if(!found){
      clientError.value = 'Bairro não encontrado na lista. Selecione um bairro válido.'
      return
    }
  }catch(e){ /* ignore matching errors */ }
  // if editing, update existing address
  if(editingAddressId.value){
    const idx = addresses.value.findIndex(a=>a.id===editingAddressId.value)
    if(idx >= 0){
      const upd = { ...addresses.value[idx], label: (_newAddrLabel.value || _newAddrFormatted.value), formattedAddress: _newAddrFormatted.value, number: _newAddrNumber.value, complement: _newAddrComplement.value, neighborhood: _newAddrNeighborhood.value, latitude: _newAddrLat.value, longitude: _newAddrLon.value, reference: _newAddrReference.value, observation: _newAddrObservation.value }
      if(_newAddrFull.value) upd.fullDisplay = _newAddrFull.value
      addresses.value.splice(idx, 1, upd)
      localStorage.setItem(LOCAL_ADDR_KEY, JSON.stringify(addresses.value))
      selectedAddressId.value = upd.id
    }
    clearNewAddress()
    return
  }

  addAddress({ label: _newAddrLabel.value, formattedAddress: _newAddrFormatted.value, number: _newAddrNumber.value, complement: _newAddrComplement.value, neighborhood: _newAddrNeighborhood.value, latitude: _newAddrLat.value, longitude: _newAddrLon.value, fullDisplay: _newAddrFull.value, reference: _newAddrReference.value, observation: _newAddrObservation.value })
  clearNewAddress()
}

// Temporary-use functions removed — advancing will now persist the address when needed

async function useMyLocation(){
  clientError.value = ''
  if(!navigator.geolocation){ clientError.value = 'Geolocalização não suportada no seu navegador.'; return }
  _locating.value = true
  try{
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 })
    })
    const lat = pos.coords.latitude
    const lon = pos.coords.longitude
    // use Nominatim reverse geocoding (OpenStreetMap) to get a human readable address
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`
    const r = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'projetoDelivery/1.0 (example)' } })
    if(!r.ok) throw new Error('Falha ao consultar serviço de geocodificação')
    const j = await r.json()
    // compute a short, useful formatted address (keep full display_name too)
    const short = shortAddressFromNominatim(j) || j.display_name || `${lat.toFixed(6)}, ${lon.toFixed(6)}`
    _newAddrFormatted.value = short
    _newAddrFull.value = j.display_name || ''
    const addr = j.address || {}
    _newAddrNeighborhood.value = addr.suburb || addr.neighbourhood || addr.city_district || addr.village || addr.town || addr.city || ''
    if(!_newAddrNeighborhood.value && addr.county) _newAddrNeighborhood.value = addr.county
    _newAddrLat.value = lat
    _newAddrLon.value = lon
    // try to match the geocoded neighborhood to our canonical list via public match endpoint
    try{
      if(_newAddrNeighborhood.value && neighborhoodsList.value && neighborhoodsList.value.length){
  const mr = await api.post(publicPath(`/public/${companyId}/neighborhoods/match`), { text: _newAddrNeighborhood.value })
        const md = mr && mr.data ? mr.data : null
        if(md && md.match){
          // use the canonical match name so select will resolve correctly
          _newAddrNeighborhood.value = md.match
          showTip('neighborhood', `Bairro identificado: ${md.match} (${formatCurrency(md.deliveryFee || 0)})`, 2500)
        } else {
          // no match found — hint the user to manually select
          showTip('neighborhood', 'Bairro não encontrado na lista. Selecione manualmente.', 3000)
        }
      }
    }catch(matchErr){
      console.warn('neighborhood match failed', matchErr)
    }

    // If the user already has saved addresses, auto-save this as a new address
    // (existing behavior). If there are no saved addresses, just populate the
    // transient form fields so the user can "Usar para este pedido" without
    // forcing a save.
    if(addresses.value && addresses.value.length){
      addAddress({ label: _newAddrLabel.value || 'Minha localização', formattedAddress: _newAddrFormatted.value, neighborhood: _newAddrNeighborhood.value, latitude: _newAddrLat.value, longitude: _newAddrLon.value, fullDisplay: _newAddrFull.value })
      // clear transient fields after saving
      clearNewAddress()
      // ensure the new-address form is hidden after auto-saving (keep UX tidy)
      showNewAddressForm.value = false
    } else {
      // keep the populated _newAddr* fields for the user to confirm and use
      showTip('neighborhood', 'Endereço preenchido. Clique em Avançar para salvar e continuar.', 2800)
      // show the new address form so they can see/edit the values
      showNewAddressForm.value = true
    }
  }catch(err){
    console.error('useMyLocation failed', err)
    clientError.value = 'Não foi possível obter localização: ' + (err.message || err)
  }finally{ _locating.value = false }
}

// helper: produce a short address from Nominatim result
function shortAddressFromNominatim(j){
  if(!j) return ''
  const a = j.address || {}
  // prefer road + house_number or pedestrian; then neighbourhood/suburb, then postcode, then country
  const parts = []
  if(a.house_number && a.road) parts.push(`${a.road}, ${a.house_number}`)
  else if(a.road) parts.push(a.road)
  else if(a.neighbourhood) parts.push(a.neighbourhood)
  else if(a.suburb) parts.push(a.suburb)
  // city / town
  if(a.city && !parts.includes(a.city)) parts.push(a.city)
  else if(a.town && !parts.includes(a.town)) parts.push(a.town)
  else if(a.village && !parts.includes(a.village)) parts.push(a.village)
  // postcode
  if(a.postcode) parts.push(a.postcode)
  // country
  if(a.country) parts.push(a.country)
  return parts.filter(Boolean).join(', ')
}

function editAddress(id){
  const a = addresses.value.find(x=>x.id===id)
  if(!a) return
  editingAddressId.value = id
  _newAddrLabel.value = a.label || ''
  _newAddrFormatted.value = a.formattedAddress || ''
  _newAddrNumber.value = a.number || ''
  _newAddrComplement.value = a.complement || ''
  _newAddrNeighborhood.value = a.neighborhood || ''
  _newAddrLat.value = a.latitude || null
  _newAddrLon.value = a.longitude || null
  _newAddrFull.value = a.fullDisplay || ''
  _newAddrReference.value = a.reference || ''
  _newAddrObservation.value = a.observation || ''
  selectedAddressId.value = id
  // reveal the edit form so user can modify the address
  showNewAddressForm.value = true
}

function saveEditedAddress(){
  // reuse addNewAddress which handles editing flow
  addNewAddress()
}

function cancelEdit(){ clearNewAddress() }

function nextFromDelivery(){
  clientError.value = ''
  if(orderType.value === 'DELIVERY'){
    // allow proceeding when a saved address is selected OR when the user filled a
    // temporary address in the form (showNewAddressForm may be true when adding)
    const hasSaved = !!selectedAddressId.value
    const hasTemp = (customer.value.address && customer.value.address.formattedAddress) || (_newAddrFormatted.value && showNewAddressForm.value)
    if(!hasSaved && !hasTemp){
      clientError.value = 'Selecione um endereço'
      return
    }
    // if user filled the inline form without selecting a saved address, persist it
    if(!hasSaved && _newAddrFormatted.value){
      // attempt to add and persist the address (this will also set selectedAddressId)
      addNewAddress()
      if(clientError.value){
        // addNewAddress reports validation errors via clientError; stop progression
        return
      }
      // ensure neighborhood is synchronized from the newly saved address
      const a = addresses.value.find(x => x.id === selectedAddressId.value)
      if(a){ neighborhood.value = a.neighborhood || '' }
    }
    // if user provided a temporary inline address directly into customer.value.address
    // (not saved via _newAddrFormatted), ensure neighborhood is set so delivery fee displays
    if(!hasSaved && ! _newAddrFormatted.value && customer.value.address && customer.value.address.formattedAddress){
      let n = customer.value.address.neighborhood || _newAddrNeighborhood.value || ''
      try{ if(n && typeof n === 'object'){ n = n.name || n.id || String(n) } }catch(e){}
      neighborhood.value = n || ''
    }
  }
  // ensure delivery fee is refreshed before moving to next step
  try{ refreshDeliveryFee() }catch(e){}
  checkoutStep.value = (orderType.value === 'DELIVERY' ? 'payment' : 'review')
}

function goToCustomer(){ checkoutStep.value = 'customer' }
function goToDelivery(){ checkoutStep.value = 'delivery' }
function goToReview(){ checkoutStep.value = 'review' }
function backFromReview(){ checkoutStep.value = (orderType.value === 'DELIVERY' ? 'payment' : 'delivery') }

onMounted(async ()=>{
  loading.value = true;
  try{
    // TEMP LOG: indicate component mounted and parameters
    try{ console.log('[PublicMenu] mounted', { companyId: companyId, menuId: menuId && menuId.value, storeId: storeId && storeId.value }) }catch(e){}
  // build public menu path including optional menuId/storeId query hints
  const menuQuery = []
  if(menuId.value) menuQuery.push(`menuId=${encodeURIComponent(menuId.value)}`)
  if(storeId.value) menuQuery.push(`storeId=${encodeURIComponent(storeId.value)}`)
  const menuUrl = publicPath(`/public/${companyId}/menu${menuQuery.length ? ('?' + menuQuery.join('&')) : ''}`)
  const res = await api.get(menuUrl);
  const data = res.data || {};
    // TEMP LOG: inspect payload in browser console to debug schedule fields
    try{ console.log('[PublicMenu] payload', {
      company: data.company,
      company_store: data.company && data.company.store,
      company_menus: data.company && data.company.menus,
      menu: data.menu,
      raw: data
    }); }catch(e){}
    // expose payload for quick inspection from console
    try{ window.__PUBLIC_MENU_PAYLOAD = data }catch(e){}
    // If API returned no `menu` and we don't have a menuId, try to infer a menuId from the categories
    // (some public payloads include categories even when menu wasn't selected). Retry once with inferred menuId.
    try{
      if(!menuId.value && (!data.menu) && data.categories && data.categories.length){
        const found = data.categories.find(c => c && c.menuId)
        if(found && found.menuId){
          const inferred = String(found.menuId)
          try{ console.log('[PublicMenu] inferring menuId from categories', inferred) }catch(e){}
          menuId.value = inferred
          try{ localStorage.setItem(menuStorageKey, inferred) }catch(e){}
          // refetch using inferred menuId
          const menuUrl2 = publicPath(`/public/${companyId}/menu${menuQuery.length ? ('?' + menuQuery.join('&')) : ('?menuId=' + encodeURIComponent(inferred))}`)
          const res2 = await api.get(menuUrl2);
          const data2 = res2.data || {}
          try{ console.log('[PublicMenu] payload after inferring menuId', { menuId: inferred, company: data2.company, menu: data2.menu, raw: data2 }) }catch(e){}
          try{ window.__PUBLIC_MENU_MENU_INFERRED = data2 }catch(e){}
          // replace data with the refetched payload
          if(data2) {
            // overwrite locals below by reassigning data variable
            Object.assign(data, data2)
          }
        }
      }
    }catch(e){ console.warn('menuId inference failed', e) }
  // filter out inactive categories and inactive products
  const rawCategories = data.categories || []
  categories.value = rawCategories.map(c => ({ ...c, products: (c.products || []).filter(p => p.isActive !== false) })).filter(c => c.isActive !== false)
  uncategorized.value = (data.uncategorized || []).filter(p => p.isActive !== false)
  // if a previously selected/active category is now inactive/absent, reset active state
  if(activeCategoryId.value && !categories.value.find(c => c.id === activeCategoryId.value)) activeCategoryId.value = null
  company.value = data.company || null
  menu.value = data.menu || null
    // set page title and social meta tags, prefer store name when available
    try{
      // Prefer the selected menu's name as the document title, then store name, then company name
      const title = (menu.value && menu.value.name) || (company.value && company.value.store && company.value.store.name) || (company.value && company.value.name) || 'Cardápio'
      try{ document.title = title }catch(e){}
      const setMeta = (prop, val, isProperty=false) => {
        try{
          if(!val) return
          const selector = isProperty ? `meta[property="${prop}"]` : `meta[name="${prop}"]`
          let m = document.querySelector(selector)
          if(!m){ m = document.createElement('meta'); if(isProperty) m.setAttribute('property', prop); else m.setAttribute('name', prop); document.getElementsByTagName('head')[0].appendChild(m) }
          m.setAttribute(isProperty ? 'content' : 'content', val)
        }catch(e){ }
      }
      setMeta('og:title', title, true)
      setMeta('twitter:title', title)
      // image: prefer menu banner, then store banner, then company banner
      try{
        const imgPath = (menu.value && menu.value.banner) || (company.value && company.value.store && company.value.store.banner) || (company.value && company.value.banner) || null
        if(imgPath){ setMeta('og:image', assetUrl(imgPath), true); setMeta('twitter:image', assetUrl(imgPath)) }
      }catch(e){}
        try{ console.error('[PublicMenu] load failed', e) }catch(err){}
    }catch(e){ /* ignore meta tag errors */ }
    // after menu loaded, validate any persisted cart to remove stale items/options
    try{ validatePersistedCart() }catch(e){ console.warn('validatePersistedCart failed', e) }
    // prefer payment methods provided by public endpoint if available
    if(company.value && Array.isArray(company.value.paymentMethods) && company.value.paymentMethods.length){
      paymentMethods.value = company.value.paymentMethods
      if(paymentMethods.value.length && !paymentMethods.value.find(m=>m.code===paymentMethod.value)) paymentMethod.value = paymentMethods.value[0].code
    } else {
      // payment methods for this company (public endpoints may not expose them; try admin endpoint fallback)
      try{
        const pm = await api.get(`/menu/payment-methods?companyId=${companyId}`);
        paymentMethods.value = pm.data || [];
        if(paymentMethods.value.length && !paymentMethods.value.find(m=>m.code===paymentMethod.value)){
          paymentMethod.value = paymentMethods.value[0].code;
        }
      }catch(e){
        // fallback: minimal default method
        paymentMethods.value = [{ code: 'CASH', name: 'Dinheiro' }];
        paymentMethod.value = 'CASH';
      }
    }
    // fetch public neighborhoods for this company (used to compute delivery fee)
    try{
  const nr = await api.get(publicPath(`/public/${companyId}/neighborhoods`))
      neighborhoodsList.value = Array.isArray(nr.data) ? nr.data : []
      try{ refreshDeliveryFee() }catch(e){}
    }catch(e){ console.warn('failed to load public neighborhoods', e) }
    
    // initial evaluation of discounts for the persisted cart
    try{ scheduleEvaluateDiscounts() }catch(e){}
    // fetch cashback settings and wallet when menu/company loaded
    try{ fetchCashbackSettingsAndWallet() }catch(e){}
  }catch(e){
    console.error(e);
    serverError.value = 'Não foi possível carregar o cardápio.';
  }finally{ loading.value = false; }
});

function selectCategory(id){
  // scroll to a category section (or to products-start when id is null)
  try{
    if(id === null){
      const el = document.getElementById('products-start') || document.querySelector('.row')
      const headerEl = document.querySelector('header, .site-header, .navbar, .app-header')
      const headerH = headerEl ? headerEl.getBoundingClientRect().height : 0
      if(el){
        const top = el.getBoundingClientRect().top + window.pageYOffset - headerH - 8
        window.scrollTo({ top, behavior: 'smooth' })
        activeCategoryId.value = null
      }
      return
    }
    const el = document.getElementById(`cat-${id}`)
    const headerEl = document.querySelector('header, .site-header, .navbar, .app-header')
    const headerH = headerEl ? headerEl.getBoundingClientRect().height : 0
    if(el){
      const top = el.getBoundingClientRect().top + window.pageYOffset - headerH - 8
      window.scrollTo({ top, behavior: 'smooth' })
      activeCategoryId.value = id
    }
  }catch(e){ console.warn('selectCategory err', e) }
}

// fetch cashback settings for company and (if logged) the customer's wallet
async function fetchCashbackSettingsAndWallet(){
  try{
    // fetch settings (may require admin role). If forbidden, don't treat as fatal — continue to try wallet fetch.
    try{
      const r = await api.get(`/cashback/settings?companyId=${companyId}`)
      cashbackSettings.value = r.data || null
      cashbackEnabled.value = !!(cashbackSettings.value && (cashbackSettings.value.enabled || cashbackSettings.value.isEnabled))
    }catch(e){
      cashbackSettings.value = null
      try{ console.debug('[debug] cashback settings fetch failed', e?.response?.status || e) }catch(_){}
      // do not assume disabled here; continue and try to fetch wallet below
    }

    // fetch wallet for logged-in public customer when possible, or when we have a stored public customer id
    walletLoaded.value = false
    try{
      // try to derive clientId from stored profile (namespaced or legacy key)
      let stored = null
      try{ stored = JSON.parse(localStorage.getItem(LOCAL_CUSTOMER_KEY) || localStorage.getItem(`public_customer_${companyId}`) || 'null') }catch(e){ stored = null }
      let storedClientId = stored && (stored.id || stored.clientId || stored.customerId) ? (stored.id || stored.clientId || stored.customerId) : null

      // If we have a token but no stored client id, try to fetch the profile (server-resolved) to obtain id
      const token = localStorage.getItem('token')
      if(!storedClientId && token){
        try{
          const p = await api.get(`/public/${companyId}/profile`)
          const prof = p && p.data ? p.data : null
          if(prof){
            // persist legacy key for compatibility
            try{ localStorage.setItem(`public_customer_${companyId}`, JSON.stringify(prof)) }catch(e){}
            storedClientId = prof.id || prof.clientId || prof.customerId || null
          }
        }catch(e){ /* ignore profile fetch error */ }
      }

      const clientIdToUse = storedClientId || null
      if(clientIdToUse){
        try{
          const w = await api.get(`/cashback/wallet?clientId=${encodeURIComponent(clientIdToUse)}&companyId=${companyId}`)
          try{ console.debug('[debug] fetchCashbackSettingsAndWallet -> wallet response', w && w.data) }catch(e){}
          wallet.value = w.data || { balance: 0 }
          // if wallet exists, enable cashback UI even if settings endpoint was not accessible
          if(wallet.value && (wallet.value.balance !== undefined || (Array.isArray(wallet.value.transactions) && wallet.value.transactions.length > 0))){
            cashbackEnabled.value = true
          }
        }catch(e){ console.debug('[debug] fetchCashbackSettingsAndWallet -> wallet fetch error', e); wallet.value = { balance: 0 } }
      } else {
        wallet.value = { balance: 0 }
      }
    }catch(e){ console.debug('[debug] fetchCashbackSettingsAndWallet -> derive client id error', e); wallet.value = { balance: 0 } }
    walletLoaded.value = true
  }catch(e){ console.debug('[debug] fetchCashbackSettingsAndWallet -> outer error', e); walletLoaded.value = true }
}

// refresh wallet when user logs in/out
watch(() => publicCustomerConnected.value, (v) => {
  try{ if(v) fetchCashbackSettingsAndWallet(); else { wallet.value = { balance: 0 }; walletLoaded.value = true; useCashback.value = false; useCashbackAmount.value = 0 } }catch(e){}
})

// clamp cashback amount to allowable range
watch(() => useCashbackAmount.value, (v) => {
  try{
    let val = Number(v || 0)
    const max = Math.min(Number(wallet.value?.balance || 0), Number(finalTotal))
    if(Number.isNaN(val) || val < 0) val = 0
    if(val > max) val = max
    if(val !== v) useCashbackAmount.value = Number(Math.round(val * 100) / 100)
  }catch(e){}
})

function _publicNavigate(pathSuffix, extraQuery = {}){
  try{
    // preserve the current route params (companyId is treated as the slug)
    const base = `/public/${route.params.companyId || companyId}`;
    // merge existing query params so we don't lose the slug-scoped store/menu identification
    const mergedQuery = Object.assign({}, route.query || {}, extraQuery || {});
    // ensure we include persisted storeId when present
  if (storeId.value && !mergedQuery.storeId) mergedQuery.storeId = storeId.value
  if (menuId.value && !mergedQuery.menuId) mergedQuery.menuId = menuId.value
    // remove undefined values to keep the URL clean
    Object.keys(mergedQuery).forEach(k => { if (mergedQuery[k] === undefined) delete mergedQuery[k]; });
    router.push({ path: `${base}${pathSuffix || ''}`, query: mergedQuery });
  }catch(e){ console.warn('_publicNavigate', e) }
}

function goHome(){ _publicNavigate('', { storeId: storeId.value || undefined, menuId: menuId.value || undefined }) }
function goOrders(){ _publicNavigate('/orders', { storeId: storeId.value || undefined, menuId: menuId.value || undefined }) }
function goProfile(){ _publicNavigate('/profile', { storeId: storeId.value || undefined, menuId: menuId.value || undefined }) }

function scrollToCheckout(){
  // scroll to checkout card (mobile) or to sidebar (desktop)
  const el = document.querySelector('.card.mt-4.d-lg-none') || document.querySelector('.position-sticky')
  if(el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

async function submitOrder(){
  serverError.value = '';
  clientError.value = '';
  submitting.value = true;
  orderResponse.value = null;
  try{
    if(!isOpen.value){
      clientError.value = 'Loja fechada no momento. Não é possível enviar pedidos fora do horário de funcionamento.'
      submitting.value = false
      return
    }
    // client-side validation
    if(!customer.value.name || !customer.value.contact){
      clientError.value = 'Preencha nome e telefone antes de enviar.';
      submitting.value = false
      return;
    }
    if(orderType.value === 'DELIVERY'){
      if(!customer.value.address?.formattedAddress || !neighborhood.value){
        clientError.value = 'Preencha endereço e bairro para entrega antes de enviar.';
        submitting.value = false
        return;
      }
    }
    if(cart.value.length===0){
      clientError.value = 'Adicione pelo menos um item ao carrinho.';
      submitting.value = false
      return;
    }
    // Ensure discounts are up-to-date with current orderType/coupon before building payload
    try{ await evaluateDiscountsNow() }catch(e){}

    // Build a plain JS payload (avoid sending reactive refs / proxies which cause cyclic errors)
    const payload = {
      customer: {
        name: String(customer.value.name || ''),
        contact: String(customer.value.contact || ''),
        address: {
          formattedAddress: String((customer.value.address && customer.value.address.formattedAddress) || ''),
          number: String((customer.value.address && customer.value.address.number) || ''),
          complement: String((customer.value.address && customer.value.address.complement) || ''),
          neighborhood: String(neighborhood.value || ''),
            reference: String((customer.value.address && customer.value.address.reference) || ''),
            observation: String((customer.value.address && customer.value.address.observation) || ''),
            postalCode: String((customer.value.address && (customer.value.address.postalCode || customer.value.address.postal_code)) || ''),
            city: String((customer.value.address && customer.value.address.city) || ''),
            state: String((customer.value.address && customer.value.address.state) || ''),
            country: String((customer.value.address && customer.value.address.country) || ''),
            coordinates: (customer.value.address && (customer.value.address.latitude != null || customer.value.address.longitude != null)) ? { latitude: customer.value.address.latitude || null, longitude: customer.value.address.longitude || null } : null
        }
      },
      items: (cart.value || []).map(i => ({
        productId: i.productId,
        name: i.name,
        price: Number(i.price || 0),
        quantity: Number(i.quantity || 0),
        options: (i.options || []).map(o => ({ id: o.id, name: o.name, price: Number(o.price || 0) }))
      })),
  // payment.amount should reflect the final total (subtotal minus coupon + delivery)
  // we'll attach a payment object right after creating the payload to include optional troco information
      neighborhood: String(neighborhood.value || ''),
      orderType: String(orderType.value || '')
    };

    // Ensure we include the structured delivery address in shapes the backend may expect
    try{
      const structuredAddr = {
        formattedAddress: String((customer.value.address && customer.value.address.formattedAddress) || ''),
        number: String((customer.value.address && customer.value.address.number) || ''),
        complement: String((customer.value.address && customer.value.address.complement) || ''),
        neighborhood: String((customer.value.address && customer.value.address.neighborhood) || neighborhood.value || ''),
        reference: String((customer.value.address && customer.value.address.reference) || ''),
        observation: String((customer.value.address && customer.value.address.observation) || ''),
        postalCode: String((customer.value.address && (customer.value.address.postalCode || customer.value.address.postal_code)) || ''),
        city: String((customer.value.address && customer.value.address.city) || ''),
        state: String((customer.value.address && customer.value.address.state) || ''),
        country: String((customer.value.address && customer.value.address.country) || ''),
        coordinates: (customer.value.address && (customer.value.address.latitude != null || customer.value.address.longitude != null)) ? { latitude: customer.value.address.latitude || null, longitude: customer.value.address.longitude || null } : null
      }
      // attach in multiple places for compatibility with older/newer backend shapes
      payload.customer = payload.customer || {}
      payload.customer.address = payload.customer.address || structuredAddr
      payload.delivery = payload.delivery || {}
      payload.delivery.deliveryAddress = structuredAddr
      payload.deliveryAddress = structuredAddr
    }catch(e){ /* ignore */ }

  // build payment object and include optional 'changeFor' when customer requested troco
  try{
    const paymentObj = {
      methodCode: String(paymentMethod.value || ''),
      // also include the human-friendly method name when available so backend
      // can prefer/store the name without relying only on codes
      method: (paymentMethods.value || []).find(m => m.code === paymentMethod.value)?.name || null,
      // include customer-group discounts in the final amount calculation
      amount: Number(Math.max(0, subtotal.value - (couponDiscount.value || 0) - (discountsTotal.value || 0)) + Number(deliveryFee.value || 0)) - Number(useCashbackAmount.value || 0)
    };
    if (Number(changeFor.value) > 0) paymentObj.changeFor = Number(changeFor.value);
    payload.payment = paymentObj;
  }catch(e){ /* ignore */ }

  // include coupon information when applied so backend can persist and track usage
  if (couponApplied.value && couponInfo.value) {
    payload.coupon = { code: couponInfo.value.code, discountAmount: Number(couponDiscount.value || 0) }
  }

  // include customer-group discounts (if any) so backend can persist and reflect in order totals
  if (discountsList.value && discountsList.value.length) {
    payload.discounts = discountsList.value
    payload.discountsTotal = Number(discountsTotal.value || 0)
  }

  // Include canonical store/menu identifiers when present so the backend
  // can persist the relation and the Orders board will show the store name.
  if (storeId.value) {
    try {
      // keep both forms for compatibility: payload.store (object) and payload.storeId (flat)
      payload.store = { id: String(storeId.value) }
      payload.storeId = String(storeId.value)
    } catch(e) { /* ignore */ }
  }
  if (menuId.value) {
    try { payload.menuId = String(menuId.value) } catch(e) { /* ignore */ }
  }

  // If the page didn't include storeId/menuId query params, try to derive them
  // from the loaded `menu` or `company` objects returned by the public menu API.
  try {
    // prefer existing payload values; only set when missing
    if (!payload.menuId && menu && menu.value && menu.value.id) {
      payload.menuId = String(menu.value.id)
      // persist derived menuId for session continuity
      try { menuId.value = String(menu.value.id); localStorage.setItem(menuStorageKey, String(menu.value.id)) } catch(e){}
    }
    // menu may include menu.value.storeId linking it to a store
    if (!payload.storeId && menu && menu.value && menu.value.storeId) {
      payload.storeId = String(menu.value.storeId)
      payload.store = payload.store || { id: String(menu.value.storeId) }
      // persist derived storeId for session continuity
      try { storeId.value = String(menu.value.storeId); localStorage.setItem(storeStorageKey, String(menu.value.storeId)) } catch(e){}
    }
    // as a last resort, if the public API returned a store in company context, use it
    if (!payload.storeId && company && company.value && company.value.store && company.value.store.id) {
      payload.storeId = String(company.value.store.id)
      payload.store = payload.store || { id: String(company.value.store.id) }
      try { storeId.value = String(company.value.store.id); localStorage.setItem(storeStorageKey, String(company.value.store.id)) } catch(e){}
    }
    // If we have a store id and the loaded company/menu returned a store name,
    // attach the canonical store name to the payload for deterministic display.
    try {
      const storeNameFromMenu = menu && menu.value && menu.value.store && menu.value.store.name;
      const storeNameFromCompany = company && company.value && company.value.store && company.value.store.name;
      const candidateName = storeNameFromMenu || storeNameFromCompany || null;
      if (candidateName && payload.storeId) {
        payload.store = payload.store || { id: String(payload.storeId) };
        payload.store.name = String(candidateName);
      }
    } catch (e) { /* ignore */ }
  } catch(e) { /* ignore derivation errors */ }

// persist store/menu ids when route query provides them (keep storage updated)
try{
  if(route.query && route.query.storeId){ localStorage.setItem(storeStorageKey, String(route.query.storeId)) }
  if(route.query && route.query.menuId){ localStorage.setItem(menuStorageKey, String(route.query.menuId)) }
}catch(e){}

  // debug: log outgoing payload to help diagnose server-side validation errors (400)
  try { console.debug && console.debug('Submitting public order payload', payload) } catch(e){}
  // include applied cashback for backend processing when present
  try{ payload.appliedCashback = Number(useCashback && Number(useCashbackAmount) > 0 ? Number(useCashbackAmount) : 0) }catch(e){ payload.appliedCashback = 0 }
  const res = await api.post(publicPath(`/public/${companyId}/orders`), payload);
  orderResponse.value = res.data;
  cart.value = [];
  // persist customer contact so user can view history/status later
  saveCustomerToLocal()
  // redirect to public order status page (include phone for verification)
  const phone = encodeURIComponent(String(customer.value.contact || ''))
  const oid = encodeURIComponent(String(res.data.id || ''))
  try { _publicNavigate(`/order/${oid}`, { phone, storeId: storeId.value || undefined, menuId: menuId.value || undefined }) } catch(e) { console.warn('Redirect failed', e) }
  }catch(err){
    console.error(err);
    // surface server response body and status to browser console for debugging
    try { console.error('Order create response data:', err?.response?.data) } catch (e) {}
    try { console.error('Order create response status:', err?.response?.status) } catch (e) {}
    serverError.value = err?.response?.data?.message || err.message || 'Erro ao enviar pedido';
  }finally{ submitting.value = false; }
}

// Dev helper removed: sendDevTestOrder has been removed to avoid accidental test orders

