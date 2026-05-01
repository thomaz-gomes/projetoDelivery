<template>
  <div class="rider-map-wrapper">
   
    <div v-if="!trackingEnabled" class="alert alert-warning mb-0 rounded-0 py-2 px-3" style="flex-shrink:0">
      <i class="bi bi-exclamation-triangle me-1"></i>
      Rastreamento em tempo real <strong>desligado</strong>.
      <router-link to="/settings/rider-tracking" class="alert-link ms-1">Ativar →</router-link>
    </div>

    <!-- MAIN CONTENT: map + sidebar -->
    <div class="rider-map-body mt-3">
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
        <!-- Controls -->
        <div class="sidebar-section">
          
          <select
            v-model="selectedStoreId"
            class="form-select form-select-sm mb-2"
            @change="onStoreFilterChange"
          >
            <option value="">Todas as lojas</option>
            <option v-for="s in storeOptions" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
          <div class="d-flex gap-1">
            <button class="btn btn-outline-secondary btn-sm flex-grow-1" @click="loadPositions" :disabled="loadingPositions">
              <span v-if="loadingPositions" class="spinner-border spinner-border-sm me-1"></span>
              <i v-else class="bi bi-arrow-clockwise me-1"></i>Atualizar
            </button>
            <router-link to="/settings/rider-tracking" class="btn btn-outline-primary btn-sm flex-grow-1">
              <i class="bi bi-gear me-1"></i>Config
            </router-link>
            <span v-if="trackingEnabled" class="btn btn-primary bg-success w-100 d-block mb-2">
            <i class="bi bi-broadcast me-1"></i>GPS
          </span>
          <span v-else class="btn btn-secondary bg-danger w-100 d-block mb-2">
            <i class="bi bi-broadcast-pin me-1"></i>GPS
          </span>
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
          <div v-for="pos in filteredPositions" :key="pos.riderId" class="sidebar-item">
            <div class="d-flex align-items-center gap-2" style="cursor:pointer" @click="flyToRider(pos)">
              <i class="bi bi-person-fill" :style="{ color: getRiderColor(pos.riderId || pos.rider?.id) }"></i>
              <div class="flex-grow-1">
                <div class="small fw-medium">{{ pos.rider?.name || pos.riderName || 'Entregador' }}</div>
                <div class="text-muted" style="font-size:0.72rem">{{ formatTime(pos.updatedAt) }}</div>
              </div>
              <span v-if="riderPendingCount(pos.riderId || pos.rider?.id) > 0" class="badge bg-primary" style="font-size:0.72rem" :title="riderPendingCount(pos.riderId || pos.rider?.id) + ' pedidos pendentes'">
                {{ riderPendingCount(pos.riderId || pos.rider?.id) }}
              </span>
              <i
                v-if="riderOrders(pos.riderId || pos.rider?.id).length > 0"
                class="bi"
                :class="collapsedRiders[pos.riderId || pos.rider?.id] ? 'bi-chevron-right' : 'bi-chevron-down'"
                style="font-size:0.7rem;cursor:pointer"
                @click.stop="toggleRiderGroup(pos.riderId || pos.rider?.id)"
              ></i>
            </div>
            <!-- Assigned orders for this rider -->
            <div v-if="!collapsedRiders[pos.riderId || pos.rider?.id]">
              <div
                v-for="order in riderOrders(pos.riderId || pos.rider?.id)"
                :key="order.id"
                class="d-flex align-items-center gap-2 ps-3 py-1"
                style="cursor:pointer;border-top:1px solid rgba(0,0,0,0.05)"
                @click="flyToDelivery(order)"
              >
                <i class="bi bi-geo-alt-fill" :style="{ color: order.status === 'SAIU_PARA_ENTREGA' ? '#dc3545' : '#fd7e14' }" style="font-size:0.8rem"></i>
                <div style="min-width:0;flex:1">
                  <div class="small fw-medium">#{{ formatDisplay(order) }} — {{ order.customerName || '' }}</div>
                  <div v-if="order.deliveryNeighborhood" class="text-muted" style="font-size:0.7rem">{{ order.deliveryNeighborhood }}</div>
                  <span class="badge" :class="order.status === 'SAIU_PARA_ENTREGA' ? 'bg-danger' : 'bg-warning text-dark'" style="font-size:0.6rem">
                    {{ order.status === 'SAIU_PARA_ENTREGA' ? 'Saiu p/ entrega' : 'Em preparo' }}
                  </span>
                </div>
              </div>
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
          <div v-for="order in filteredDeliveries" :key="order.id" class="sidebar-item">
            <div class="d-flex align-items-center gap-2">
              <i class="bi bi-geo-alt-fill" :style="{ color: order.status === 'SAIU_PARA_ENTREGA' ? '#dc3545' : '#fd7e14' }" style="cursor:pointer" @click="flyToDelivery(order)"></i>
              <div style="min-width:0;flex:1;cursor:pointer" @click="flyToDelivery(order)">
                <div class="small fw-medium">
                  <strong>#{{ formatDisplay(order) }} - {{ order.customerName || '' }} </strong> 
                </div>
                <div class="small fw-medium">
                  {{ order.address ? '' + order.address : '' }}
                </div>
                <div class="text-muted text-truncate" style="font-size:0.72rem">
                  <span v-if="order.store" class="text-muted fw-normal"> · {{ order.store.name }}</span>
                </div>
                <span class="badge" :class="order.status === 'SAIU_PARA_ENTREGA' ? 'bg-danger' : 'bg-warning text-dark'" style="font-size:0.65rem">
                  {{ order.status === 'SAIU_PARA_ENTREGA' ? 'Saiu p/ entrega' : 'Em preparo' }}
                </span>
              </div>
              <!-- Actions dropdown -->
              <div class="position-relative" @click.stop>
                <button class="btn btn-sm btn-link text-secondary p-0" @click.stop="toggleDropdown($event, order.id)">
                  <i class="bi bi-three-dots-vertical"></i>
                </button>
                <ul v-if="openDropdownId === order.id" class="dropdown-menu dropdown-menu-end show" style="position:absolute;right:0;top:100%;z-index:1050">
                  <li><a class="dropdown-item small" href="#" @click.prevent="openOrderDetails(order)"><i class="bi bi-list-ul me-2"></i>Ver detalhes</a></li>
                  <li v-if="order.status !== 'SAIU_PARA_ENTREGA'"><a class="dropdown-item small" href="#" @click.prevent="openAssignModal(order)"><i class="bi bi-person-plus me-2"></i>Despachar</a></li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Order Detail Modal -->
    <div v-if="detailModalVisible" class="modal fade show" style="display:block; background: rgba(0,0,0,0.45); z-index:10000;" @click.self="detailModalVisible = false">
      <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content od-modal">
          <div class="od-modal-header">
            <div class="d-flex align-items-center gap-3">
              <div class="od-order-badge">#{{ detailOrder ? formatDisplay(detailOrder) : '' }}</div>
              <div>
                <div class="od-customer-name">{{ detailOrder?.customerName || '—' }}</div>
                <div class="od-customer-phone">{{ detailOrder?.customerPhone || '' }}</div>
              </div>
            </div>
            <button type="button" class="btn-close" aria-label="Fechar" @click="detailModalVisible = false"></button>
          </div>
          <div class="modal-body p-0">
            <div v-if="detailLoading" class="text-center py-5">
              <span class="spinner-border text-primary"></span>
            </div>
            <template v-else-if="detailOrder">
              <!-- Info bar -->
              <div class="od-info-bar">
                <div class="od-info-item">
                  <i class="bi bi-shop"></i>
                  <span>{{ detailOrder.store?.name || '—' }}</span>
                </div>
                <div class="od-info-item">
                  <i class="bi bi-clock"></i>
                  <span>{{ formatTime(detailOrder.createdAt) }}</span>
                </div>
                <div class="od-info-item">
                  <span class="badge" :class="{
                    'bg-warning text-dark': detailOrder.status === 'EM_PREPARO',
                    'bg-primary': detailOrder.status === 'SAIU_PARA_ENTREGA',
                    'bg-info': detailOrder.status === 'CONFIRMACAO_PAGAMENTO',
                    'bg-success': detailOrder.status === 'CONCLUIDO',
                    'bg-danger': detailOrder.status === 'CANCELADO'
                  }">{{ statusLabel(detailOrder.status) }}</span>
                </div>
                <div class="od-info-item">
                  <i class="bi bi-bicycle"></i>
                  <span>Entrega</span>
                </div>
              </div>

              <!-- Address -->
              <div class="od-section">
                <div class="od-section-title"><i class="bi bi-geo-alt"></i> Endereço</div>
                <div>{{ detailOrder.address || '—' }}</div>
              </div>

              <!-- Items -->
              <div class="od-section">
                <div class="od-section-title"><i class="bi bi-bag"></i> Itens do pedido</div>
                <div class="od-items-list">
                  <div v-for="(it, idx) in detailItems" :key="idx" class="od-item">
                    <div class="od-item-main">
                      <span class="od-item-qty">{{ it.quantity }}x</span>
                      <span class="od-item-name">{{ it.name }}</span>
                      <span class="od-item-price">{{ formatCurrency(it.unitPrice * it.quantity) }}</span>
                    </div>
                    <div v-if="it.options && it.options.length" class="od-item-options">
                      <div v-for="(opt, oi) in it.options" :key="oi" class="od-item-option">
                        <i class="bi bi-plus-circle od-opt-icon"></i>
                        <span>{{ opt.quantity || 1 }}x {{ opt.name }}</span>
                        <span v-if="opt.price" class="od-opt-price">{{ formatCurrency(opt.price) }}</span>
                      </div>
                    </div>
                    <div v-if="it.notes" class="text-muted small fst-italic ps-3">
                      <i class="bi bi-chat-left-dots"></i> {{ it.notes }}
                    </div>
                  </div>
                </div>
              </div>

              <!-- Payment -->
              <div class="od-section">
                <div class="od-section-title"><i class="bi bi-credit-card"></i> Pagamento</div>
                <div class="od-payment-grid">
                  <div class="od-pay-row" v-if="detailOrder.payment?.methodCode || detailOrder.payment?.method">
                    <span class="od-pay-label">Forma</span>
                    <span class="od-pay-value">{{ detailOrder.payment?.methodCode || detailOrder.payment?.method || '—' }}</span>
                  </div>
                  <div class="od-pay-row" v-if="detailOrder.deliveryFee > 0">
                    <span class="od-pay-label">Taxa de entrega</span>
                    <span class="od-pay-value">{{ formatCurrency(detailOrder.deliveryFee) }}</span>
                  </div>
                  <div class="od-pay-row od-pay-total">
                    <span class="od-pay-label">Total</span>
                    <span class="od-pay-value">{{ formatCurrency(detailOrder.total || 0) }}</span>
                  </div>
                </div>
              </div>

              <!-- Rider -->
              <div class="od-section">
                <div class="od-section-title"><i class="bi bi-person-badge"></i> Entregador</div>
                <div v-if="detailOrder.rider" class="d-flex align-items-center gap-2">
                  <span>{{ detailOrder.rider.name }}</span>
                </div>
                <div v-else class="text-muted">Nenhum entregador atribuído
                  <a href="#" class="ms-2" @click.prevent="detailModalVisible = false; openAssignModal(detailOrder)">Atribuir →</a>
                </div>
              </div>
            </template>
          </div>
          <div class="od-modal-footer">
            <div></div>
            <div class="d-flex gap-2">
              <button v-if="detailOrder && !detailOrder.riderId" type="button" class="btn btn-primary btn-sm" @click="detailModalVisible = false; openAssignModal(detailOrder)">
                <i class="bi bi-person-plus me-1"></i>Despachar
              </button>
              <button type="button" class="btn btn-secondary btn-sm" @click="detailModalVisible = false">Fechar</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Assign Rider Modal -->
    <div v-if="assignModalVisible" class="modal fade show" style="display:block; background: rgba(0,0,0,0.45); z-index:20000;" @click.self="assignModalVisible = false">
      <div class="modal-dialog modal-md modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Escolher entregador</h5>
            <button type="button" class="btn-close" aria-label="Fechar" @click="assignModalVisible = false"></button>
          </div>
          <div class="modal-body">
            <div v-if="assignRiders.length">
              <ListGroup :items="assignRiders" itemKey="id" :selectedId="assignSelectedRider" :showActions="false" @select="assignSelectedRider = $event">
                <template #primary="{ item }">
                  <div><strong>{{ item.name }}</strong></div>
                  <div v-if="item.description" class="small text-muted">{{ item.description }}</div>
                </template>
              </ListGroup>
            </div>
            <div v-else class="text-muted">Nenhum entregador disponível.</div>
          </div>
          <div class="modal-footer d-flex justify-content-between">
            <div>
              <button class="btn btn-outline-secondary" type="button" @click="assignModalVisible = false">Cancelar</button>
              <button class="btn btn-outline-danger ms-2" type="button" @click="dispatchWithoutRider">Despachar sem entregador</button>
            </div>
            <button class="btn btn-primary" type="button" :disabled="!assignSelectedRider" @click="assignRiderToOrder">Atribuir</button>
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
import { useOrdersStore } from '@/stores/orders'
import { normalizeOrderItems } from '@/utils/orderUtils'
import ListGroup from '@/components/form/list-group/ListGroup.vue'
import Swal from 'sweetalert2'

const ordersStore = useOrdersStore()

const trackingEnabled = ref(false)
const positions = ref([])
const deliveries = ref([])
const loadingPositions = ref(false)
const leafletError = ref('')
const selectedStoreId = ref('')

// Detail modal state
const detailModalVisible = ref(false)
const detailOrder = ref(null)
const detailItems = ref([])
const detailLoading = ref(false)

// Assign modal state
const assignModalVisible = ref(false)
const assignModalOrderId = ref(null)
const assignRiders = ref([])
const assignSelectedRider = ref(null)

// Dropdown state
const openDropdownId = ref(null)

// Collapsible rider groups
const collapsedRiders = ref({})

function toggleRiderGroup(riderId) {
  collapsedRiders.value = { ...collapsedRiders.value, [riderId]: !collapsedRiders.value[riderId] }
}

function riderOrders(riderId) {
  return deliveries.value.filter(d =>
    d.riderId === riderId &&
    (!selectedStoreId.value || d.storeId === selectedStoreId.value)
  )
}

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
  return deliveries.value.filter(d =>
    !d.riderId &&
    d.status === 'EM_PREPARO' &&
    (!selectedStoreId.value || d.storeId === selectedStoreId.value)
  )
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

const RIDER_COLORS = [
  '#0d6efd', '#e6339a', '#6f42c1', '#20c997', '#e65100',
  '#0dcaf0', '#6610f2', '#d63384', '#198754', '#fd7e14',
  '#0b5ed7', '#ab47bc', '#00897b', '#e53935', '#ffc107',
]
const riderColorMap = {}
let riderColorIdx = 0

function getRiderColor(riderId) {
  if (!riderColorMap[riderId]) {
    riderColorMap[riderId] = RIDER_COLORS[riderColorIdx % RIDER_COLORS.length]
    riderColorIdx++
  }
  return riderColorMap[riderId]
}

function riderPendingCount(riderId) {
  return deliveries.value.filter(d => d.riderId === riderId).length
}

function riderIcon(riderId, count) {
  const color = getRiderColor(riderId)
  const label = count > 0 ? String(count) : '🛵'
  return L.divIcon({
    className: '',
    html: pinSvg(color, label),
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
  // Try top-level coordinates first, then fall back to payload delivery address
  let lat = Number(order.latitude)
  let lng = Number(order.longitude)
  if (!lat || !lng) {
    const da = order.payload?.order?.delivery?.deliveryAddress || order.payload?.delivery?.deliveryAddress || {}
    const coords = da.coordinates || da
    lat = Number(coords.latitude || coords.lat || 0)
    lng = Number(coords.longitude || coords.lng || coords.lon || 0)
  }
  if (!lat || !lng || isNaN(lat) || isNaN(lng)) return

  const display = order.displaySimple ? String(order.displaySimple).padStart(2, '0') : (order.displayId || '')
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

function resolveStoreCenter(store) {
  if (!store) return null
  if (store.latitude && store.longitude) {
    const coords = [store.latitude, store.longitude]
    addStoreMarker(store.id, store.name, coords)
    return coords
  }
  return null
}

function onStoreFilterChange() {
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
    const coords = resolveStoreCenter(store)
    if (coords) map.setView(coords, 15)
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

  const icon = riderIcon(riderId, pending)
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
          resolveStoreCenter(order.store)
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

const STATUS_LABEL = {
  EM_PREPARO: 'Em preparo',
  PRONTO: 'Pronto',
  SAIU_PARA_ENTREGA: 'Saiu p/ entrega',
  CONFIRMACAO_PAGAMENTO: 'Confirmação pgto',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado',
}

function statusLabel(s) { return STATUS_LABEL[s] || s }

function formatDisplay(order) {
  if (order.displaySimple) return String(order.displaySimple).padStart(2, '0')
  return order.displayId || ''
}

function formatCurrency(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// Dropdown management
function toggleDropdown(event, orderId) {
  if (openDropdownId.value === orderId) {
    openDropdownId.value = null
    return
  }
  openDropdownId.value = orderId
  // Close when clicking outside
  const close = () => { openDropdownId.value = null; document.removeEventListener('click', close) }
  setTimeout(() => document.addEventListener('click', close), 0)
}

// Order detail modal
async function openOrderDetails(order) {
  openDropdownId.value = null
  detailLoading.value = true
  detailModalVisible.value = true
  detailOrder.value = order
  detailItems.value = []
  try {
    const full = await ordersStore.fetchOne(order.id)
    detailOrder.value = full
    detailItems.value = normalizeOrderItems(full)
  } catch (e) {
    console.warn('Failed to load order details:', e)
  } finally {
    detailLoading.value = false
  }
}

// Assign rider modal
async function openAssignModal(order) {
  openDropdownId.value = null
  assignModalOrderId.value = order.id
  assignSelectedRider.value = null
  try {
    const riders = (await ordersStore.fetchRiders()) || []
    assignRiders.value = riders.map(r => ({ id: r.id, name: r.name, description: r.whatsapp || 'sem WhatsApp' }))
  } catch (e) {
    assignRiders.value = []
  }
  assignModalVisible.value = true
}

async function assignRiderToOrder() {
  if (!assignSelectedRider.value || !assignModalOrderId.value) return
  try {
    await ordersStore.assignOrder(assignModalOrderId.value, { riderId: assignSelectedRider.value, alsoSetStatus: true })
    assignModalVisible.value = false
    Swal.fire({ icon: 'success', text: 'Pedido atribuído ao entregador.', timer: 2000, showConfirmButton: false })
    await loadPositions()
  } catch (e) {
    console.error(e)
    Swal.fire({ icon: 'error', text: e.response?.data?.message || 'Falha ao atribuir entregador.' })
  }
}

async function dispatchWithoutRider() {
  if (!assignModalOrderId.value) return
  try {
    await ordersStore.updateStatus(assignModalOrderId.value, 'SAIU_PARA_ENTREGA')
    assignModalVisible.value = false
    Swal.fire({ icon: 'success', text: 'Pedido despachado sem entregador.', timer: 2000, showConfirmButton: false })
    await loadPositions()
  } catch (e) {
    console.error(e)
    Swal.fire({ icon: 'error', text: e.response?.data?.message || 'Falha ao despachar pedido.' })
  }
}

onMounted(async () => {
  try {
    const { data } = await api.get('/riders/tracking-status')
    trackingEnabled.value = data.enabled ?? false
  } catch (e) { /* non-blocking */ }

  try {
    // Load stores with coordinates and Leaflet in parallel
    const [storesRes] = await Promise.all([
      api.get('/stores').catch(() => ({ data: [] })),
      loadLeaflet(),
    ])
    const stores = storesRes.data || []
    // Find first store with coordinates as initial center
    const storeWithCoords = stores.find(s => s.latitude && s.longitude)
    if (storeWithCoords) {
      companyCenter = [storeWithCoords.latitude, storeWithCoords.longitude]
    }

    await nextTick()
    initMap(companyCenter)
    await loadPositions()

    // Add markers for all stores that have coordinates
    for (const s of stores) {
      if (s.latitude && s.longitude) {
        addStoreMarker(s.id, s.name, [s.latitude, s.longitude])
      }
    }

    // Center on single active store if only one has orders
    if (storeOptions.value.length === 1) {
      const store = storeOptions.value[0]
      const coords = resolveStoreCenter(store)
      if (coords) map.setView(coords, 15)
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
  margin: -1.5rem auto 0px auto;
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

/* Order detail modal styles */
.od-modal { border-radius: var(--border-radius, 0.75rem); overflow: hidden; }
.od-modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px;
  background: linear-gradient(135deg, var(--bg-app, #EEFFED), #e0f0de);
  border-bottom: 1px solid var(--border-color, #E6E6E6);
}
.od-order-badge {
  background: var(--primary, #105784); color: #fff; font-weight: 700; font-size: 1.1rem;
  padding: 6px 14px; border-radius: var(--border-radius-sm, 0.5rem); white-space: nowrap;
}
.od-customer-name { font-weight: 600; font-size: 1rem; color: #212529; }
.od-customer-phone { font-size: 0.82rem; color: #6c757d; }
.od-info-bar {
  display: flex; flex-wrap: wrap; gap: 6px 16px; padding: 10px 20px;
  background: var(--bg-zebra, #FAFAFA); border-bottom: 1px solid var(--border-color, #E6E6E6);
}
.od-info-item { display: inline-flex; align-items: center; gap: 5px; font-size: 0.8rem; color: #555; }
.od-info-item i { color: #888; }
.od-section { padding: 14px 20px; border-bottom: 1px solid #f0f0f0; }
.od-section:last-child { border-bottom: none; }
.od-section-title {
  font-weight: 600; font-size: 0.82rem; color: #495057; margin-bottom: 8px;
  text-transform: uppercase; letter-spacing: 0.3px;
}
.od-section-title i { margin-right: 4px; color: #888; }
.od-items-list { display: flex; flex-direction: column; gap: 6px; }
.od-item { background: #fafbfc; border-radius: 8px; padding: 8px 12px; }
.od-item-main { display: flex; align-items: center; gap: 8px; }
.od-item-qty { font-weight: 600; font-size: 0.82rem; color: #495057; min-width: 28px; }
.od-item-name { flex: 1; font-size: 0.88rem; color: #212529; }
.od-item-price { font-weight: 600; font-size: 0.85rem; color: #198754; white-space: nowrap; }
.od-item-options { margin-top: 6px; padding-left: 28px; display: flex; flex-direction: column; gap: 3px; }
.od-item-option { font-size: 0.8rem; color: #495057; display: flex; align-items: baseline; gap: 5px; }
.od-opt-icon { font-size: 0.65rem; color: var(--text-muted, #adb5bd); flex-shrink: 0; }
.od-opt-price { color: #198754; font-size: 0.78rem; white-space: nowrap; }
.od-payment-grid { display: flex; flex-direction: column; gap: 4px; }
.od-pay-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 0.88rem; }
.od-pay-label { color: #6c757d; }
.od-pay-value { font-weight: 500; color: #212529; }
.od-pay-total { border-top: 2px solid #e9ecef; margin-top: 4px; padding-top: 8px; }
.od-pay-total .od-pay-label { font-weight: 600; color: #212529; font-size: 0.95rem; }
.od-pay-total .od-pay-value { font-weight: 700; color: #198754; font-size: 1.1rem; }
.od-modal-footer {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 20px; border-top: 1px solid #eee;
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
