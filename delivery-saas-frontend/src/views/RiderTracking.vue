<template>
  <div class="container py-4" style="max-width: 640px">
    <div class="d-flex align-items-center mb-4 gap-2">
      <i class="bi bi-bicycle fs-4 text-primary"></i>
      <h4 class="mb-0">Configurações de Entregadores</h4>
    </div>

    <div v-if="loading" class="text-center py-5 text-muted">
      <div class="spinner-border spinner-border-sm me-2"></div>
      Carregando...
    </div>

    <div v-else>
      <div class="card shadow-sm">
        <div class="card-header fw-semibold">
          <i class="bi bi-geo-alt-fill me-1 text-success"></i>
          Rastreamento em Tempo Real
        </div>
        <div class="card-body">
          <div class="d-flex align-items-start justify-content-between gap-3">
            <div>
              <div class="fw-semibold mb-1">Ativar Rastreamento GPS</div>
              <div class="text-muted small">
                Quando ativo, entregadores com pedidos no status <strong>"Saiu para Entrega"</strong>
                compartilham automaticamente sua localização GPS via browser.
                O administrador pode acompanhar as posições em tempo real no
                <router-link to="/riders/map">Mapa de Entregas</router-link>.
              </div>
              <div class="mt-2 small text-muted">
                <i class="bi bi-info-circle me-1"></i>
                O entregador verá um indicador "📡 GPS Ativo" enquanto for rastreado.
                Nenhum dado de localização é coletado fora do horário de entrega.
              </div>
            </div>
            <div class="form-check form-switch pt-1" style="min-width: 52px">
              <input
                class="form-check-input"
                type="checkbox"
                role="switch"
                id="trackingSwitch"
                v-model="trackingEnabled"
                style="width: 48px; height: 24px; cursor: pointer"
              />
            </div>
          </div>
        </div>
        <div class="card-footer d-flex justify-content-between align-items-center">
          <span class="small text-muted">
            Status atual:
            <span :class="trackingEnabled ? 'text-success fw-semibold' : 'text-secondary'">
              {{ trackingEnabled ? 'Ativo' : 'Inativo' }}
            </span>
          </span>
          <button class="btn btn-primary btn-sm px-3" @click="save" :disabled="saving">
            <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
            Salvar
          </button>
        </div>
      </div>

      <div v-if="saved" class="alert alert-success mt-3 py-2">
        <i class="bi bi-check-circle me-1"></i>
        Configuração salva com sucesso.
      </div>
      <div v-if="error" class="alert alert-danger mt-3 py-2">
        <i class="bi bi-exclamation-triangle me-1"></i>
        {{ error }}
      </div>

      <!-- Locais de Check-in -->
      <div class="card mt-3 shadow-sm">
        <div class="card-header d-flex justify-content-between align-items-center fw-semibold">
          <span><i class="bi bi-geo-alt me-1 text-primary"></i> Locais de Check-in</span>
          <button class="btn btn-sm btn-primary" @click="openLocationModal()">
            <i class="bi bi-plus-lg me-1"></i> Adicionar
          </button>
        </div>
        <div class="card-body p-0">
          <div v-if="locationsLoading" class="text-center text-muted py-4">
            <div class="spinner-border spinner-border-sm me-2"></div>
            Carregando locais...
          </div>
          <div v-else-if="locations.length === 0" class="text-center text-muted py-4">
            Nenhum local cadastrado. Adicione um local para habilitar o check-in.
          </div>
          <div v-else class="list-group list-group-flush">
            <div v-for="loc in locations" :key="loc.id" class="list-group-item d-flex justify-content-between align-items-center">
              <div>
                <div class="fw-semibold">{{ loc.name }}</div>
                <div class="small text-muted">{{ loc.address || 'Sem endereço' }}</div>
                <div class="small text-muted">{{ loc.latitude.toFixed(6) }}, {{ loc.longitude.toFixed(6) }} &bull; Raio: {{ loc.radius }}m</div>
              </div>
              <div class="d-flex gap-1">
                <button class="btn btn-sm btn-outline-secondary" @click="openLocationModal(loc)"><i class="bi bi-pencil"></i></button>
                <button class="btn btn-sm btn-outline-danger" @click="removeLocation(loc)"><i class="bi bi-trash"></i></button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="card mt-3 shadow-sm">
        <div class="card-body py-3">
          <div class="d-flex align-items-center gap-2">
            <i class="bi bi-map text-primary fs-5"></i>
            <div>
              <div class="fw-semibold small">Mapa de Entregas</div>
              <div class="small text-muted">Visualize as posições dos entregadores em tempo real.</div>
            </div>
            <router-link to="/riders/map" class="btn btn-outline-primary btn-sm ms-auto">
              Abrir Mapa
            </router-link>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal de Local de Check-in -->
    <div class="modal" :class="{ show: showLocationModal, 'd-block': showLocationModal }" tabindex="-1" v-if="showLocationModal">
      <div class="modal-dialog modal-lg">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">{{ editingLocation ? 'Editar Local' : 'Novo Local de Check-in' }}</h5>
            <button type="button" class="btn-close" @click="showLocationModal = false"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <TextInput label="Nome do local" v-model="locationForm.name" placeholder="Ex: Loja Centro" inputClass="form-control" labelClass="form-label" />
            </div>
            <div class="mb-3">
              <label class="form-label">Endereço</label>
              <div class="input-group">
                <input type="text" class="form-control" v-model="locationForm.address" placeholder="Digite o endereço e clique em buscar" @keyup.enter="searchLocationAddress" />
                <button class="btn btn-outline-secondary" type="button" @click="searchLocationAddress" :disabled="searchingAddress">
                  <span v-if="searchingAddress" class="spinner-border spinner-border-sm"></span>
                  <i v-else class="bi bi-search"></i>
                </button>
              </div>
            </div>
            <div ref="mapContainer" style="height: 300px; border-radius: 8px; border: 1px solid #dee2e6;"></div>
            <div class="row mt-2">
              <div class="col-4">
                <label class="form-label small text-muted">Latitude</label>
                <input type="number" class="form-control form-control-sm" v-model.number="locationForm.latitude" step="any" readonly />
              </div>
              <div class="col-4">
                <label class="form-label small text-muted">Longitude</label>
                <input type="number" class="form-control form-control-sm" v-model.number="locationForm.longitude" step="any" readonly />
              </div>
              <div class="col-4">
                <label class="form-label small text-muted">Raio (metros)</label>
                <input type="number" class="form-control form-control-sm" v-model.number="locationForm.radius" min="50" max="5000" />
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" @click="showLocationModal = false">Cancelar</button>
            <button class="btn btn-primary" @click="saveLocation" :disabled="!locationForm.latitude || !locationForm.name || savingLocation">
              <span v-if="savingLocation" class="spinner-border spinner-border-sm me-1"></span>
              {{ editingLocation ? 'Salvar' : 'Criar' }}
            </button>
          </div>
        </div>
      </div>
    </div>
    <div v-if="showLocationModal" class="modal-backdrop show"></div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick, watch } from 'vue'
import api from '../api'

const loading = ref(true)
const saving = ref(false)
const saved = ref(false)
const error = ref('')
const trackingEnabled = ref(false)

// ── Check-in Locations ──
const locations = ref([])
const locationsLoading = ref(false)
const showLocationModal = ref(false)
const editingLocation = ref(null)
const searchingAddress = ref(false)
const savingLocation = ref(false)
const mapContainer = ref(null)
const locationForm = ref({ name: '', address: '', latitude: null, longitude: null, radius: 200 })

let mapInstance = null
let marker = null

// ── Leaflet loader ──
function loadLeaflet() {
  return new Promise((resolve) => {
    if (window.L) { resolve(window.L); return }
    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(css)
    const js = document.createElement('script')
    js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    js.onload = () => resolve(window.L)
    document.head.appendChild(js)
  })
}

// ── Tracking ──
async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/riders/tracking-status')
    trackingEnabled.value = data.enabled ?? false
  } catch (e) {
    error.value = e?.response?.data?.message || 'Erro ao carregar configurações'
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  saved.value = false
  error.value = ''
  try {
    await api.put('/riders/tracking-toggle', { enabled: trackingEnabled.value })
    saved.value = true
    setTimeout(() => { saved.value = false }, 3000)
  } catch (e) {
    error.value = e?.response?.data?.message || 'Erro ao salvar configuração'
  } finally {
    saving.value = false
  }
}

// ── Locations CRUD ──
async function loadLocations() {
  locationsLoading.value = true
  try {
    const { data } = await api.get('/riders/checkin-locations')
    locations.value = data
  } catch (e) {
    console.warn('Failed to load checkin locations:', e)
  } finally {
    locationsLoading.value = false
  }
}

async function openLocationModal(loc = null) {
  editingLocation.value = loc
  if (loc) {
    locationForm.value = { name: loc.name, address: loc.address || '', latitude: loc.latitude, longitude: loc.longitude, radius: loc.radius }
  } else {
    locationForm.value = { name: '', address: '', latitude: null, longitude: null, radius: 200 }
  }
  showLocationModal.value = true
  await nextTick()
  await initMap()
}

async function saveLocation() {
  savingLocation.value = true
  try {
    const payload = {
      name: locationForm.value.name,
      address: locationForm.value.address,
      latitude: locationForm.value.latitude,
      longitude: locationForm.value.longitude,
      radius: locationForm.value.radius
    }
    if (editingLocation.value) {
      await api.patch(`/riders/checkin-locations/${editingLocation.value.id}`, payload)
    } else {
      await api.post('/riders/checkin-locations', payload)
    }
    showLocationModal.value = false
    await loadLocations()
  } catch (e) {
    alert(e?.response?.data?.message || 'Erro ao salvar local')
  } finally {
    savingLocation.value = false
  }
}

async function removeLocation(loc) {
  if (!confirm(`Remover o local "${loc.name}"?`)) return
  try {
    await api.delete(`/riders/checkin-locations/${loc.id}`)
    await loadLocations()
  } catch (e) {
    alert(e?.response?.data?.message || 'Erro ao remover local')
  }
}

// ── Map ──
async function initMap() {
  const L = await loadLeaflet()
  await nextTick()

  const container = mapContainer.value
  if (!container) return

  if (mapInstance) { mapInstance.remove(); mapInstance = null }
  marker = null

  const lat = locationForm.value.latitude || -14.235
  const lng = locationForm.value.longitude || -51.925
  const zoom = locationForm.value.latitude ? 16 : 4

  mapInstance = L.map(container).setView([lat, lng], zoom)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
  }).addTo(mapInstance)

  if (locationForm.value.latitude) {
    placeMarker(lat, lng)
  }

  mapInstance.on('click', (e) => {
    placeMarker(e.latlng.lat, e.latlng.lng)
    locationForm.value.latitude = parseFloat(e.latlng.lat.toFixed(6))
    locationForm.value.longitude = parseFloat(e.latlng.lng.toFixed(6))
    reverseGeocode(e.latlng.lat, e.latlng.lng)
  })
}

function placeMarker(lat, lng) {
  const L = window.L
  if (marker) { marker.setLatLng([lat, lng]); return }
  marker = L.marker([lat, lng], { draggable: true }).addTo(mapInstance)
  marker.on('dragend', (e) => {
    const pos = e.target.getLatLng()
    locationForm.value.latitude = parseFloat(pos.lat.toFixed(6))
    locationForm.value.longitude = parseFloat(pos.lng.toFixed(6))
    reverseGeocode(pos.lat, pos.lng)
  })
}

async function reverseGeocode(lat, lng) {
  try {
    const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18`, {
      headers: { 'User-Agent': 'DeliveryWL/1.0' }
    })
    const data = await resp.json()
    if (data.display_name) locationForm.value.address = data.display_name
  } catch (e) { /* ignore */ }
}

async function searchLocationAddress() {
  if (!locationForm.value.address) return
  searchingAddress.value = true
  try {
    const q = encodeURIComponent(locationForm.value.address)
    const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${q}&limit=1`, {
      headers: { 'User-Agent': 'DeliveryWL/1.0' }
    })
    const data = await resp.json()
    if (data.length > 0) {
      const lat = parseFloat(data[0].lat)
      const lng = parseFloat(data[0].lon)
      locationForm.value.latitude = parseFloat(lat.toFixed(6))
      locationForm.value.longitude = parseFloat(lng.toFixed(6))
      if (mapInstance) {
        mapInstance.flyTo([lat, lng], 16)
        placeMarker(lat, lng)
      }
    } else {
      alert('Endereço não encontrado. Tente ser mais específico.')
    }
  } catch (e) {
    alert('Falha ao buscar endereço.')
  } finally {
    searchingAddress.value = false
  }
}

// Clean up map when modal closes
watch(showLocationModal, (v) => {
  if (!v && mapInstance) { mapInstance.remove(); mapInstance = null; marker = null }
})

onMounted(() => {
  load()
  loadLocations()
})
</script>
