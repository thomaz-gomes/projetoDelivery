<template>
  <div class="container-fluid py-3">
    <div class="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
      <div class="d-flex align-items-center gap-2">
        <i class="bi bi-map fs-4 text-primary"></i>
        <h4 class="mb-0">Mapa de Entregas</h4>
      </div>
      <div class="d-flex align-items-center gap-2">
        <span v-if="trackingEnabled" class="badge bg-success">
          <i class="bi bi-broadcast me-1"></i>Rastreamento Ativo
        </span>
        <span v-else class="badge bg-secondary">
          <i class="bi bi-broadcast-pin me-1"></i>Rastreamento Desligado
        </span>
        <button class="btn btn-outline-secondary btn-sm" @click="loadPositions" :disabled="loadingPositions">
          <span v-if="loadingPositions" class="spinner-border spinner-border-sm me-1"></span>
          <i v-else class="bi bi-arrow-clockwise me-1"></i>Atualizar
        </button>
        <router-link to="/settings/rider-tracking" class="btn btn-outline-primary btn-sm">
          <i class="bi bi-gear me-1"></i>Configurar
        </router-link>
      </div>
    </div>

    <div v-if="!trackingEnabled" class="alert alert-warning">
      <i class="bi bi-exclamation-triangle me-1"></i>
      O rastreamento em tempo real está <strong>desligado</strong>.
      <router-link to="/settings/rider-tracking" class="alert-link ms-1">Ativar nas configurações →</router-link>
    </div>

    <div class="card shadow-sm">
      <div class="card-body p-0" style="position: relative">
        <div v-if="leafletError" class="p-4 text-center text-danger">
          <i class="bi bi-exclamation-triangle fs-3"></i>
          <div class="mt-2">Erro ao carregar mapa: {{ leafletError }}</div>
        </div>
        <div v-else id="rider-map" style="height: 520px; border-radius: 0.375rem"></div>
      </div>
    </div>

    <div class="mt-3">
      <div class="d-flex align-items-center gap-3 mb-2 small text-muted">
        <span><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#0d6efd" class="me-1"></span>Entregadores</span>
        <span><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#fd7e14" class="me-1"></span>Em preparo</span>
        <span><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#dc3545" class="me-1"></span>Saiu p/ entrega</span>
      </div>
      <div v-if="positions.length === 0 && deliveries.length === 0 && !loadingPositions" class="text-muted small text-center py-2">
        Nenhum entregador ou entrega ativa no momento.
      </div>
      <div v-else class="row g-2">
        <div v-for="pos in positions" :key="pos.riderId" class="col-auto">
          <div class="badge bg-light text-dark border d-flex align-items-center gap-1 px-2 py-1">
            <i class="bi bi-person-fill text-primary"></i>
            <span>{{ pos.rider?.name || pos.riderName || 'Entregador' }}</span>
            <span class="text-muted small ms-1">{{ formatTime(pos.updatedAt) }}</span>
          </div>
        </div>
        <div v-for="order in deliveries" :key="order.id" class="col-auto">
          <div class="badge bg-light text-dark border d-flex align-items-center gap-1 px-2 py-1">
            <i class="bi bi-geo-alt-fill" :class="order.status === 'SAIU_PARA_ENTREGA' ? 'text-danger' : 'text-warning'"></i>
            <span>#{{ order.displayId || order.id.slice(0,6) }} {{ order.customerName || '' }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import api from '../api'
import { io } from 'socket.io-client'
import { SOCKET_URL } from '@/config'

const trackingEnabled = ref(false)
const positions = ref([])
const deliveries = ref([])
const loadingPositions = ref(false)
const leafletError = ref('')

let map = null
let markersMap = {} // riderId -> L.marker
let circlesMap = {} // riderId -> L.circle (accuracy radius)
let deliveryMarkersMap = {} // orderId -> L.marker
let staleCheckInterval = null
let socket = null
let pollInterval = null
let L = null

// Load Leaflet CSS + JS from CDN dynamically
function loadLeaflet() {
  return new Promise((resolve, reject) => {
    if (window.L) { L = window.L; return resolve(); }

    // CSS
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link')
      link.id = 'leaflet-css'
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      document.head.appendChild(link)
    }

    // JS
    const script = document.createElement('script')
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.onload = () => { L = window.L; resolve(); }
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

function riderIcon() {
  return L.divIcon({
    className: '',
    html: pinSvg('#0d6efd', '🛵'),
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
  const popupHtml = `
    <div style="min-width:160px">
      <strong>#${display}</strong> — ${statusLabel}<br>
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

let companyCenter = null // [lat, lng] resolved from company address

function initMap(center) {
  try {
    const startCenter = center || [-12.9714, -38.5014]
    map = L.map('rider-map').setView(startCenter, 14)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map)
    // Mark company location
    if (center) {
      L.marker(center, {
        icon: L.divIcon({
          className: '',
          html: '<div style="background:#198754;color:white;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 2px 6px rgba(0,0,0,0.35)">🏪</div>',
          iconSize: [32, 32],
          iconAnchor: [16, 16],
          popupAnchor: [0, -18],
        }),
      }).bindPopup('<strong>Sua empresa</strong>').addTo(map)
    }
  } catch (e) {
    leafletError.value = e?.message || 'Erro ao inicializar mapa'
  }
}

async function resolveCompanyCenter() {
  try {
    const { data } = await api.get('/settings/company')
    const parts = [data.street, data.addressNumber, data.addressNeighborhood, data.city, data.state].filter(Boolean)
    if (parts.length < 2) return null
    const query = parts.join(', ')
    const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`)
    const results = await resp.json()
    if (results && results.length > 0) {
      return [parseFloat(results[0].lat), parseFloat(results[0].lon)]
    }
  } catch (e) {
    console.warn('resolveCompanyCenter error:', e)
  }
  return null
}

function updateMarker(pos) {
  if (!map || !L) return
  const riderId = pos.riderId || pos.rider?.id
  const name = pos.rider?.name || pos.riderName || 'Entregador'
  const lat = Number(pos.lat)
  const lng = Number(pos.lng)
  if (isNaN(lat) || isNaN(lng)) return

  const accuracy = pos.accuracy ? Number(pos.accuracy) : null
  const popupHtml = `
    <div style="min-width:140px">
      <strong>${name}</strong><br>
      <small class="text-muted">Atualizado: ${formatTime(pos.updatedAt)}</small>
      ${pos.orderId ? `<br><small>Pedido: ${pos.orderId.slice(0,8)}...</small>` : ''}
      ${accuracy ? `<br><small>Precisão: ~${Math.round(accuracy)}m</small>` : ''}
      <hr style="margin:4px 0">
      <button onclick="window.__hideRider__('${riderId}')" class="btn btn-sm btn-outline-danger w-100">
        <i class="bi bi-eye-slash me-1"></i>Ocultar do mapa
      </button>
    </div>`

  if (markersMap[riderId]) {
    markersMap[riderId].setLatLng([lat, lng])
    markersMap[riderId].getPopup()?.setContent(popupHtml)
    markersMap[riderId].setOpacity(1) // reset stale opacity
  } else {
    markersMap[riderId] = L.marker([lat, lng], { icon: riderIcon() })
      .bindPopup(popupHtml)
      .addTo(map)
  }

  // Store last update timestamp for stale detection
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
    if (ageMs > 5 * 60 * 1000) {
      // 5+ minutes: remove from map
      removeMarker(riderId)
    } else if (ageMs > 2 * 60 * 1000) {
      // 2+ minutes: reduce opacity
      marker.setOpacity(0.5)
      if (circlesMap[riderId]) {
        circlesMap[riderId].setStyle({ fillOpacity: 0.05, opacity: 0.15 })
      }
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
      removeStaleMarkers(posRes.data.map(p => p.riderId || p.rider?.id).filter(Boolean))
      delRes.data.forEach(updateDeliveryMarker)
      removeStaleDeliveryMarkers(delRes.data.map(o => o.id))
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
      // Update or add position in the list
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
        if (deliveryMarkersMap[payload.id] && map) {
          map.removeLayer(deliveryMarkersMap[payload.id])
          delete deliveryMarkersMap[payload.id]
        }
        deliveries.value = deliveries.value.filter(d => d.id !== payload.id)
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

onMounted(async () => {
  // Check tracking status
  try {
    const { data } = await api.get('/riders/tracking-status')
    trackingEnabled.value = data.enabled ?? false
  } catch (e) { /* non-blocking */ }

  // Resolve company center and load Leaflet in parallel
  try {
    const [center] = await Promise.all([resolveCompanyCenter(), loadLeaflet()])
    companyCenter = center
    await nextTick()
    initMap(companyCenter)
    await loadPositions()
  } catch (e) {
    leafletError.value = e?.message || 'Erro ao inicializar mapa'
    console.error('RiderMap init error:', e)
  }

  ensureSocket()

  // Global handler for hide button in popup
  window.__hideRider__ = async (riderId) => {
    try {
      await api.put(`/riders/${riderId}/position/hide`, { hidden: true })
      removeMarker(riderId)
    } catch (e) {
      console.warn('Failed to hide rider:', e)
    }
  }

  // Polling fallback every 15s
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
  delete window.__hideRider__
})
</script>
