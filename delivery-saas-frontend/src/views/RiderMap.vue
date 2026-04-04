<template>
  <div class="rider-map-wrapper">
    <!-- HEADER BAR -->
    <div class="rider-map-header">
      <div class="d-flex align-items-center gap-2">
        <i class="bi bi-map fs-5" style="color: var(--primary)"></i>
        <h4 class="mb-0">Mapa de Entregas</h4>
        <span v-if="trackingEnabled" class="badge bg-success ms-2">
          <i class="bi bi-broadcast me-1"></i>Ativo
        </span>
        <span v-else class="badge bg-secondary ms-2">
          <i class="bi bi-broadcast-pin me-1"></i>Desligado
        </span>
      </div>
      <div class="d-flex align-items-center gap-2">
        <!-- Store filter -->
        <select
          v-if="storeOptions.length > 1"
          v-model="selectedStoreId"
          class="form-select form-select-sm"
          style="width: auto; min-width: 180px"
          @change="onStoreFilterChange"
        >
          <option value="">Todas as lojas</option>
          <option v-for="s in storeOptions" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <button class="btn btn-outline-secondary btn-sm" @click="loadPositions" :disabled="loadingPositions">
          <span v-if="loadingPositions" class="spinner-border spinner-border-sm me-1"></span>
          <i v-else class="bi bi-arrow-clockwise me-1"></i>Atualizar
        </button>
        <router-link to="/settings/rider-tracking" class="btn btn-outline-primary btn-sm">
          <i class="bi bi-gear me-1"></i>Configurar
        </router-link>
      </div>
    </div>

    <div v-if="!trackingEnabled" class="alert alert-warning mb-0 rounded-0 py-2 px-3" style="flex-shrink:0">
      <i class="bi bi-exclamation-triangle me-1"></i>
      Rastreamento em tempo real <strong>desligado</strong>.
      <router-link to="/settings/rider-tracking" class="alert-link ms-1">Ativar →</router-link>
    </div>

    <!-- MAIN CONTENT: map + sidebar -->
    <div class="rider-map-body">
      <!-- MAP -->
      <div class="rider-map-container">
        <div v-if="leafletError" class="d-flex align-items-center justify-content-center h-100 text-danger">
          <div class="text-center">
            <i class="bi bi-exclamation-triangle fs-3"></i>
            <div class="mt-2">Erro ao carregar mapa: {{ leafletError }}</div>
          </div>
        </div>
        <div v-else id="rider-map" style="width:100%;height:100%"></div>
      </div>

      <!-- SIDEBAR -->
      <div class="rider-map-sidebar">
        <!-- Legend -->
        <div class="sidebar-section">
          <div class="sidebar-section-title">Legenda</div>
          <div class="d-flex flex-column gap-1">
            <span class="small"><span class="legend-dot" style="background:var(--primary)"></span>Entregadores</span>
            <span class="small"><span class="legend-dot" style="background:#fd7e14"></span>Em preparo</span>
            <span class="small"><span class="legend-dot" style="background:#dc3545"></span>Saiu p/ entrega</span>
            <span class="small"><span class="legend-dot" style="background:#198754"></span>Loja</span>
          </div>
        </div>

        <!-- Riders -->
        <div class="sidebar-section">
          <div class="sidebar-section-title">
            <i class="bi bi-person-fill me-1" style="color:var(--primary)"></i>
            Entregadores
            <span class="badge bg-light text-dark ms-1">{{ filteredPositions.length }}</span>
          </div>
          <div v-if="filteredPositions.length === 0" class="text-muted small py-1">
            Nenhum entregador ativo.
          </div>
          <div v-for="pos in filteredPositions" :key="pos.riderId" class="sidebar-item" @click="flyToRider(pos)">
            <div class="d-flex align-items-center gap-2">
              <i class="bi bi-person-fill" style="color:var(--primary)"></i>
              <div class="flex-grow-1">
                <div class="small fw-medium">{{ pos.rider?.name || pos.riderName || 'Entregador' }}</div>
                <div class="text-muted" style="font-size:0.72rem">{{ formatTime(pos.updatedAt) }}</div>
              </div>
              <span v-if="riderPendingCount(pos.riderId || pos.rider?.id) > 0" class="badge bg-primary" style="font-size:0.72rem" :title="riderPendingCount(pos.riderId || pos.rider?.id) + ' pedidos pendentes'">
                {{ riderPendingCount(pos.riderId || pos.rider?.id) }}
              </span>
            </div>
          </div>
        </div>

        <!-- Deliveries -->
        <div class="sidebar-section">
          <div class="sidebar-section-title">
            <i class="bi bi-bag-fill me-1" style="color:#fd7e14"></i>
            Pedidos Ativos
            <span class="badge bg-light text-dark ms-1">{{ filteredDeliveries.length }}</span>
          </div>
          <div v-if="filteredDeliveries.length === 0" class="text-muted small py-1">
            Nenhum pedido ativo.
          </div>
          <div v-for="order in filteredDeliveries" :key="order.id" class="sidebar-item" @click="flyToDelivery(order)">
            <div class="d-flex align-items-center gap-2">
              <i class="bi bi-geo-alt-fill" :style="{ color: order.status === 'SAIU_PARA_ENTREGA' ? '#dc3545' : '#fd7e14' }"></i>
              <div style="min-width:0">
                <div class="small fw-medium">
                  #{{ order.displayId || order.id.slice(0,6) }}
                  <span v-if="order.store" class="text-muted fw-normal"> · {{ order.store.name }}</span>
                </div>
                <div class="text-muted text-truncate" style="font-size:0.72rem">
                  {{ order.customerName || '' }} {{ order.address ? '— ' + order.address : '' }}
                </div>
                <span class="badge" :class="order.status === 'SAIU_PARA_ENTREGA' ? 'bg-danger' : 'bg-warning text-dark'" style="font-size:0.65rem">
                  {{ order.status === 'SAIU_PARA_ENTREGA' ? 'Saiu p/ entrega' : 'Em preparo' }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import api from '../api'
import { io } from 'socket.io-client'
import { SOCKET_URL } from '@/config'

const trackingEnabled = ref(false)
const positions = ref([])
const deliveries = ref([])
const loadingPositions = ref(false)
const leafletError = ref('')
const selectedStoreId = ref('')

let map = null
let markersMap = {}
let circlesMap = {}
let deliveryMarkersMap = {}
let storeMarkersMap = {}
let staleCheckInterval = null
let socket = null
let pollInterval = null
let L = null
let companyCenter = null
let storesCenterCache = {} // storeId -> [lat, lng]

// Stores that have active orders
const storeOptions = computed(() => {
  const seen = new Map()
  for (const d of deliveries.value) {
    if (d.store && !seen.has(d.store.id)) {
      seen.set(d.store.id, { id: d.store.id, name: d.store.name, address: d.store.address })
    }
  }
  return Array.from(seen.values())
})

const filteredPositions = computed(() => positions.value)

const filteredDeliveries = computed(() => {
  if (!selectedStoreId.value) return deliveries.value
  return deliveries.value.filter(d => d.storeId === selectedStoreId.value)
})

// Load Leaflet CSS + JS from CDN dynamically
function loadLeaflet() {
  return new Promise((resolve, reject) => {
    if (window.L) { L = window.L; return resolve() }
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link')
      link.id = 'leaflet-css'
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      document.head.appendChild(link)
    }
    const script = document.createElement('script')
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.onload = () => { L = window.L; resolve() }
    script.onerror = () => reject(new Error('Falha ao carregar Leaflet do CDN'))
    document.head.appendChild(script)
  })
}

function pinSvg(color, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40">
    <path d="M14 0C6.27 0 0 6.27 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.27 21.73 0 14 0z" fill="${color}" stroke="#fff" stroke-width="1.5"/>
    <circle cx="14" cy="14" r="7" fill="#fff"/>
    <text x="14" y="18" text-anchor="middle" font-size="11" font-weight="bold" fill="${color}" font-family="sans-serif">${label}</text>
  </svg>`
}

function riderPendingCount(riderId) {
  return deliveries.value.filter(d => d.riderId === riderId).length
}


function riderIcon(count) {
  const label = count > 0 ? String(count) : '🛵'
  return L.divIcon({
    className: '',
    html: pinSvg('#0d6efd', label),
    iconSize: [28, 40],
    iconAnchor: [14, 40],
    popupAnchor: [0, -40],
  })
}

function deliveryIcon(status) {
  const color = status === 'SAIU_PARA_ENTREGA' ? '#dc3545' : '#fd7e14'
  const label = status === 'SAIU_PARA_ENTREGA' ? '🏍' : '📦'
  return L.divIcon({
    className: '',
    html: pinSvg(color, label),
    iconSize: [28, 40],
    iconAnchor: [14, 40],
    popupAnchor: [0, -40],
  })
}

function storeIcon() {
  return L.divIcon({
    className: '',
    html: '<div style="background:#198754;color:white;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 2px 6px rgba(0,0,0,0.35)">🏪</div>',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  })
}

function updateDeliveryMarker(order) {
  if (!map || !L) return
  const lat = Number(order.latitude)
  const lng = Number(order.longitude)
  if (isNaN(lat) || isNaN(lng)) return

  const display = order.displayId || order.id.slice(0, 6)
  const customer = order.customerName || ''
  const addr = order.address || ''
  const statusLabel = order.status === 'SAIU_PARA_ENTREGA' ? 'Saiu p/ entrega' : 'Em preparo'
  const riderName = order.rider?.name || ''
  const storeName = order.store?.name || ''
  const popupHtml = `
    <div style="min-width:160px">
      <strong>#${display}</strong> — ${statusLabel}<br>
      ${storeName ? `<small>Loja: ${storeName}</small><br>` : ''}
      ${customer ? `<small>${customer}</small><br>` : ''}
      ${addr ? `<small class="text-muted">${addr}</small><br>` : ''}
      ${riderName ? `<small>Entregador: ${riderName}</small>` : ''}
    </div>`

  if (deliveryMarkersMap[order.id]) {
    deliveryMarkersMap[order.id].setLatLng([lat, lng])
    deliveryMarkersMap[order.id].setIcon(deliveryIcon(order.status))
    deliveryMarkersMap[order.id].getPopup()?.setContent(popupHtml)
  } else {
    deliveryMarkersMap[order.id] = L.marker([lat, lng], { icon: deliveryIcon(order.status) })
      .bindPopup(popupHtml)
      .addTo(map)
  }
}

function removeStaleDeliveryMarkers(activeIds) {
  for (const id of Object.keys(deliveryMarkersMap)) {
    if (!activeIds.includes(id)) {
      map.removeLayer(deliveryMarkersMap[id])
      delete deliveryMarkersMap[id]
    }
  }
}

function initMap(center) {
  try {
    const startCenter = center || [-12.9714, -38.5014]
    map = L.map('rider-map', { zoomControl: false }).setView(startCenter, 14)
    L.control.zoom({ position: 'topright' }).addTo(map)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map)
  } catch (e) {
    leafletError.value = e?.message || 'Erro ao inicializar mapa'
  }
}

function addStoreMarker(storeId, name, coords) {
  if (!map || !L) return
  if (storeMarkersMap[storeId]) {
    storeMarkersMap[storeId].setLatLng(coords)
    return
  }
  storeMarkersMap[storeId] = L.marker(coords, { icon: storeIcon() })
    .bindPopup(`<strong>${name}</strong>`)
    .addTo(map)
}

async function geocodeAddress(address) {
  if (!address) return null
  try {
    const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`)
    const results = await resp.json()
    if (results && results.length > 0) {
      return [parseFloat(results[0].lat), parseFloat(results[0].lon)]
    }
  } catch (e) {
    console.warn('geocode error:', e)
  }
  return null
}

async function resolveCompanyCenter() {
  try {
    const { data } = await api.get('/settings/company')
    const parts = [data.street, data.addressNumber, data.addressNeighborhood, data.city, data.state].filter(Boolean)
    if (parts.length < 2) return null
    return await geocodeAddress(parts.join(', '))
  } catch (e) {
    console.warn('resolveCompanyCenter error:', e)
  }
  return null
}

async function resolveStoreCenter(store) {
  if (!store || !store.address) return null
  if (storesCenterCache[store.id]) return storesCenterCache[store.id]
  const coords = await geocodeAddress(store.address)
  if (coords) {
    storesCenterCache[store.id] = coords
    addStoreMarker(store.id, store.name, coords)
  }
  return coords
}

async function onStoreFilterChange() {
  if (!map) return
  if (!selectedStoreId.value) {
    // Show all: fit to company center or show all markers
    if (companyCenter) {
      map.setView(companyCenter, 14)
    }
    // Show all delivery markers
    deliveries.value.forEach(updateDeliveryMarker)
    return
  }
  // Hide non-matching delivery markers, show matching
  for (const id of Object.keys(deliveryMarkersMap)) {
    const order = deliveries.value.find(d => d.id === id)
    if (order && order.storeId !== selectedStoreId.value) {
      map.removeLayer(deliveryMarkersMap[id])
      delete deliveryMarkersMap[id]
    }
  }
  filteredDeliveries.value.forEach(updateDeliveryMarker)

  // Center on selected store
  const store = storeOptions.value.find(s => s.id === selectedStoreId.value)
  if (store) {
    const coords = await resolveStoreCenter(store)
    if (coords) {
      map.setView(coords, 15)
    }
  }
}

function updateMarker(pos) {
  if (!map || !L) return
  const riderId = pos.riderId || pos.rider?.id
  const name = pos.rider?.name || pos.riderName || 'Entregador'
  const lat = Number(pos.lat)
  const lng = Number(pos.lng)
  if (isNaN(lat) || isNaN(lng)) return

  const accuracy = pos.accuracy ? Number(pos.accuracy) : null
  const pending = riderPendingCount(riderId)
  const pendingLabel = pending > 0 ? `<br><small>Pedidos pendentes: <strong>${pending}</strong></small>` : ''
  const popupHtml = `
    <div style="min-width:140px">
      <strong>${name}</strong><br>
      <small class="text-muted">Atualizado: ${formatTime(pos.updatedAt)}</small>
      ${pendingLabel}
      ${pos.orderId ? `<br><small>Pedido: ${pos.orderId.slice(0,8)}...</small>` : ''}
      ${accuracy ? `<br><small>Precisão: ~${Math.round(accuracy)}m</small>` : ''}
      <hr style="margin:4px 0">
      <button onclick="window.__hideRider__('${riderId}')" class="btn btn-sm btn-outline-danger w-100">
        <i class="bi bi-eye-slash me-1"></i>Ocultar do mapa
      </button>
    </div>`

  const icon = riderIcon(pending)
  if (markersMap[riderId]) {
    markersMap[riderId].setLatLng([lat, lng])
    markersMap[riderId].setIcon(icon)
    markersMap[riderId].getPopup()?.setContent(popupHtml)
    markersMap[riderId].setOpacity(1)
  } else {
    markersMap[riderId] = L.marker([lat, lng], { icon })
      .bindPopup(popupHtml)
      .addTo(map)
  }
  markersMap[riderId]._lastUpdate = new Date(pos.updatedAt || Date.now()).getTime()
}

function removeStaleMarkers(activeIds) {
  for (const id of Object.keys(markersMap)) {
    if (!activeIds.includes(id)) {
      map.removeLayer(markersMap[id])
      delete markersMap[id]
      if (circlesMap[id]) {
        map.removeLayer(circlesMap[id])
        delete circlesMap[id]
      }
    }
  }
}

function checkStaleMarkers() {
  const now = Date.now()
  for (const [riderId, marker] of Object.entries(markersMap)) {
    const lastUpdate = marker._lastUpdate || 0
    const ageMs = now - lastUpdate
    if (ageMs > 30 * 60 * 1000) {
      // 30+ min without update: remove from map
      removeMarker(riderId)
    } else if (ageMs > 5 * 60 * 1000) {
      // 5+ min: fade opacity to indicate stale
      marker.setOpacity(0.5)
    } else {
      marker.setOpacity(1)
    }
  }
}

async function loadPositions() {
  loadingPositions.value = true
  try {
    const [posRes, delRes] = await Promise.all([
      api.get('/riders/map/positions'),
      api.get('/riders/map/deliveries').catch(() => ({ data: [] })),
    ])
    positions.value = posRes.data
    deliveries.value = delRes.data
    if (map) {
      posRes.data.forEach(updateMarker)
      // Don't aggressively remove markers — let checkStaleMarkers handle expiry by timestamp

      // Add store markers for stores with active orders
      const seenStores = new Set()
      for (const order of delRes.data) {
        if (order.store && !seenStores.has(order.store.id)) {
          seenStores.add(order.store.id)
          resolveStoreCenter(order.store) // async, adds marker when resolved
        }
      }

      // Apply store filter for delivery markers
      const ordersToShow = selectedStoreId.value
        ? delRes.data.filter(d => d.storeId === selectedStoreId.value)
        : delRes.data
      ordersToShow.forEach(updateDeliveryMarker)
      removeStaleDeliveryMarkers(ordersToShow.map(o => o.id))
    }
  } catch (e) {
    console.warn('loadPositions error:', e)
  } finally {
    loadingPositions.value = false
  }
}

function removeMarker(riderId) {
  if (markersMap[riderId] && map) {
    map.removeLayer(markersMap[riderId])
    delete markersMap[riderId]
  }
  if (circlesMap[riderId] && map) {
    map.removeLayer(circlesMap[riderId])
    delete circlesMap[riderId]
  }
  positions.value = positions.value.filter(p => (p.riderId || p.rider?.id) !== riderId)
}

function ensureSocket() {
  try {
    socket = io(SOCKET_URL, { transports: ['websocket'] })
    socket.on('rider-position', (payload) => {
      const riderId = payload.riderId
      const idx = positions.value.findIndex(p => (p.riderId || p.rider?.id) === riderId)
      if (idx !== -1) {
        positions.value[idx] = { ...positions.value[idx], ...payload, rider: positions.value[idx].rider || { name: payload.riderName } }
      } else {
        positions.value.push({ riderId: payload.riderId, rider: { id: riderId, name: payload.riderName }, ...payload })
      }
      updateMarker(payload)
    })
    socket.on('rider-offline', (payload) => {
      if (payload?.riderId) removeMarker(payload.riderId)
    })
    socket.on('order-updated', (payload) => {
      const hideStatuses = ['CONFIRMACAO_PAGAMENTO', 'CONCLUIDO', 'CANCELADO']
      if (payload?.id && hideStatuses.includes(payload.status)) {
        const removed = deliveries.value.find(d => d.id === payload.id)
        if (deliveryMarkersMap[payload.id] && map) {
          map.removeLayer(deliveryMarkersMap[payload.id])
          delete deliveryMarkersMap[payload.id]
        }
        deliveries.value = deliveries.value.filter(d => d.id !== payload.id)
        // Refresh rider icon to update pending count
        if (removed?.riderId) {
          const pos = positions.value.find(p => (p.riderId || p.rider?.id) === removed.riderId)
          if (pos) updateMarker(pos)
        }
      }
    })
  } catch (e) {
    console.warn('Socket init failed in RiderMap:', e)
  }
}

function formatTime(d) {
  if (!d) return ''
  try {
    return new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch (e) { return '' }
}

function flyToRider(pos) {
  if (!map) return
  const lat = Number(pos.lat)
  const lng = Number(pos.lng)
  if (!isNaN(lat) && !isNaN(lng)) {
    map.flyTo([lat, lng], 17, { duration: 0.5 })
    const riderId = pos.riderId || pos.rider?.id
    if (markersMap[riderId]) markersMap[riderId].openPopup()
  }
}

function flyToDelivery(order) {
  if (!map) return
  const lat = Number(order.latitude)
  const lng = Number(order.longitude)
  if (!isNaN(lat) && !isNaN(lng)) {
    map.flyTo([lat, lng], 17, { duration: 0.5 })
    if (deliveryMarkersMap[order.id]) deliveryMarkersMap[order.id].openPopup()
  }
}

onMounted(async () => {
  try {
    const { data } = await api.get('/riders/tracking-status')
    trackingEnabled.value = data.enabled ?? false
  } catch (e) { /* non-blocking */ }

  try {
    const [center] = await Promise.all([resolveCompanyCenter(), loadLeaflet()])
    companyCenter = center
    await nextTick()
    initMap(companyCenter)
    await loadPositions()

    // If we have a single store with orders, center on it
    if (storeOptions.value.length === 1) {
      const store = storeOptions.value[0]
      const coords = await resolveStoreCenter(store)
      if (coords) map.setView(coords, 15)
    } else if (companyCenter) {
      addStoreMarker('company', 'Empresa', companyCenter)
    }
  } catch (e) {
    leafletError.value = e?.message || 'Erro ao inicializar mapa'
    console.error('RiderMap init error:', e)
  }

  ensureSocket()

  window.__hideRider__ = async (riderId) => {
    try {
      await api.put(`/riders/${riderId}/position/hide`, { hidden: true })
      removeMarker(riderId)
    } catch (e) {
      console.warn('Failed to hide rider:', e)
    }
  }

  pollInterval = setInterval(loadPositions, 15000)
  staleCheckInterval = setInterval(checkStaleMarkers, 30000)
})

onUnmounted(() => {
  try { socket?.disconnect() } catch (e) {}
  if (pollInterval) clearInterval(pollInterval)
  if (staleCheckInterval) clearInterval(staleCheckInterval)
  if (map) { map.remove(); map = null }
  markersMap = {}
  circlesMap = {}
  deliveryMarkersMap = {}
  storeMarkersMap = {}
  delete window.__hideRider__
})
</script>

<style scoped>
.rider-map-wrapper {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 56px);
  overflow: hidden;
  /* bleed into main-content padding */
  margin: -1.5rem;
}

.rider-map-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.65rem 1rem;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.rider-map-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.rider-map-container {
  flex: 1;
  min-width: 0;
  position: relative;
}

.rider-map-sidebar {
  width: 320px;
  flex-shrink: 0;
  overflow-y: auto;
  background: var(--bg-card);
  border-left: 1px solid var(--border-color);
}

.sidebar-section {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-color-soft);
}

.sidebar-section-title {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-bottom: 0.5rem;
}

.sidebar-item {
  padding: 0.5rem 0.5rem;
  border-radius: var(--border-radius-sm);
  cursor: pointer;
  transition: background 0.15s;
}

.sidebar-item:hover {
  background: var(--bg-hover);
}

.legend-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 0.4rem;
  vertical-align: middle;
}

/* Mobile: adjust bleed for smaller padding */
@media (max-width: 767px) {
  .rider-map-wrapper {
    margin: -1rem -0.75rem;
    margin-top: calc(-0.75rem - 52px);
    height: calc(100vh);
  }
}

/* Tablet/Mobile: sidebar below map */
@media (max-width: 991px) {
  .rider-map-body {
    flex-direction: column;
  }
  .rider-map-container {
    min-height: 50vh;
  }
  .rider-map-sidebar {
    width: 100%;
    border-left: none;
    border-top: 1px solid var(--border-color);
    max-height: 40vh;
  }
  .rider-map-header {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
