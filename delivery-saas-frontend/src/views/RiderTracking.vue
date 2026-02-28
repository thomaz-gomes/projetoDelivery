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
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../api'

const loading = ref(true)
const saving = ref(false)
const saved = ref(false)
const error = ref('')
const trackingEnabled = ref(false)

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

onMounted(load)
</script>
