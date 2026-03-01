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
      <div v-if="positions.length === 0 && !loadingPositions" class="text-muted small text-center py-2">
        Nenhum entregador com posição ativa no momento.
      </div>
      <div v-else class="row g-2">
        <div v-for="pos in positions" :key="pos.riderId" class="col-auto">
          <div class="badge bg-light text-dark border d-flex align-items-center gap-1 px-2 py-1">
            <i class="bi bi-person-fill text-primary"></i>
            <span>{{ pos.rider?.name || pos.riderName || 'Entregador' }}</span>
            <span class="text-muted small ms-1">{{ formatTime(pos.updatedAt) }}</span>
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
const loadingPositions = ref(false)
const leafletError = ref('')

let map = null
let markersMap = {} // riderId -> L.marker
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

function riderIcon() {
  return L.divIcon({
    className: '',
    html: '<div style="background:#0d6efd;color:white;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 2px 6px rgba(0,0,0,0.35)">🛵</div>',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  })
}

function initMap() {
  try {
    map = L.map('rider-map').setView([-12.9714, -38.5014], 13) // Salvador, BA — adjust as needed
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map)
  } catch (e) {
    leafletError.value = e?.message || 'Erro ao inicializar mapa'
  }
}

function updateMarker(pos) {
  if (!map || !L) return
  const riderId = pos.riderId || pos.rider?.id
  const name = pos.rider?.name || pos.riderName || 'Entregador'
  const lat = Number(pos.lat)
  const lng = Number(pos.lng)
  if (isNaN(lat) || isNaN(lng)) return

  const popupHtml = `
    <div style="min-width:120px">
      <strong>${name}</strong><br>
      <small class="text-muted">Atualizado: ${formatTime(pos.updatedAt)}</small>
      ${pos.orderId ? `<br><small>Pedido: ${pos.orderId.slice(0,8)}...</small>` : ''}
    </div>`

  if (markersMap[riderId]) {
    markersMap[riderId].setLatLng([lat, lng])
    markersMap[riderId].getPopup()?.setContent(popupHtml)
  } else {
    markersMap[riderId] = L.marker([lat, lng], { icon: riderIcon() })
      .bindPopup(popupHtml)
      .addTo(map)
  }
}

function removeStaleMarkers(activeIds) {
  for (const id of Object.keys(markersMap)) {
    if (!activeIds.includes(id)) {
      map.removeLayer(markersMap[id])
      delete markersMap[id]
    }
  }
}

async function loadPositions() {
  loadingPositions.value = true
  try {
    const { data } = await api.get('/riders/map/positions')
    positions.value = data
    if (map) {
      data.forEach(updateMarker)
      removeStaleMarkers(data.map(p => p.riderId || p.rider?.id).filter(Boolean))
      // Fit map to markers if any
      if (data.length > 0) {
        const group = L.featureGroup(Object.values(markersMap))
        map.fitBounds(group.getBounds().pad(0.3))
      }
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

  // Load Leaflet and initialize map
  try {
    await loadLeaflet()
    await nextTick()
    initMap()
    await loadPositions()
  } catch (e) {
    leafletError.value = e?.message || 'Erro ao inicializar mapa'
    console.error('RiderMap init error:', e)
  }

  ensureSocket()

  // Polling fallback every 15s
  pollInterval = setInterval(loadPositions, 15000)
})

onUnmounted(() => {
  try { socket?.disconnect() } catch (e) {}
  if (pollInterval) clearInterval(pollInterval)
  if (map) { map.remove(); map = null }
  markersMap = {}
})
</script>
