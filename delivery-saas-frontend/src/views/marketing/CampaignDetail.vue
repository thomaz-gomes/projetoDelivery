<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../../api'
import BaseButton from '../../components/BaseButton.vue'
import Swal from 'sweetalert2'

const route = useRoute()
const router = useRouter()
const id = route.params.id

const campaign = ref(null)
const stats = ref(null)
const messages = ref([])
const loading = ref(false)
const tab = ref('overview')

const STATUS_LABELS = {
  DRAFT:     { label: 'Rascunho',  class: 'bg-secondary' },
  SCHEDULED: { label: 'Agendada',  class: 'bg-info text-dark' },
  RUNNING:   { label: 'Rodando',   class: 'bg-success' },
  PAUSED:    { label: 'Pausada',   class: 'bg-warning text-dark' },
  COMPLETED: { label: 'Concluída', class: 'bg-dark' },
  FAILED:    { label: 'Falhou',    class: 'bg-danger' },
  CANCELLED: { label: 'Cancelada', class: 'bg-danger' },
}

const MSG_STATUS_LABELS = {
  QUEUED: 'Enfileirada',
  SCHEDULED: 'Agendada (quiet hours)',
  SENDING: 'Enviando',
  SENT: 'Enviada',
  DELIVERED: 'Entregue',
  READ: 'Lida',
  FAILED: 'Falhou',
  OPTED_OUT: 'Opt-out',
  SUPPRESSED_QUIET_HOURS: 'Suprimida (horário silencioso)',
}

const MSG_STATUS_BADGE_CLASS = {
  QUEUED: 'bg-secondary',
  SCHEDULED: 'bg-info text-dark',
  SENDING: 'bg-primary',
  SENT: 'bg-success',
  DELIVERED: 'bg-success',
  READ: 'bg-success',
  FAILED: 'bg-danger',
  OPTED_OUT: 'bg-warning text-dark',
  SUPPRESSED_QUIET_HOURS: 'bg-dark',
}

function msgStatusLabel(s) { return MSG_STATUS_LABELS[s] || s }
function msgStatusBadge(s) { return MSG_STATUS_BADGE_CLASS[s] || 'bg-secondary' }

async function load() {
  loading.value = true
  try {
    const [c, s, m] = await Promise.all([
      api.get(`/marketing/campaigns/${id}`),
      api.get(`/marketing/campaigns/${id}/stats`),
      api.get(`/marketing/campaigns/${id}/messages?limit=50`),
    ])
    campaign.value = c.data
    stats.value = s.data
    messages.value = m.data
  } finally { loading.value = false }
}
onMounted(load)

const funnel = computed(() => {
  if (!stats.value) return null
  const s = stats.value
  const pct = (n) => s.sent > 0 ? Math.round((n / s.sent) * 100) : 0
  return {
    ...s,
    weak: s.converted - s.convertedStrong,
    pctDelivered: pct(s.delivered),
    pctRead: pct(s.read),
    pctConverted: pct(s.converted),
  }
})

async function doAction(kind, confirmText) {
  const r = await Swal.fire({
    title: confirmText,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Confirmar',
    cancelButtonText: 'Cancelar',
  })
  if (!r.isConfirmed) return
  try {
    await api.post(`/marketing/campaigns/${id}/${kind}`)
    await load()
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Falha' })
  }
}

function fmtCurrency(v) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0))
}
function fmtDateTime(s) {
  if (!s) return '—'
  try { return new Date(s).toLocaleString('pt-BR') } catch { return '—' }
}
</script>

<template>
  <div class="container py-4">
    <div v-if="loading"><div class="spinner-border"></div></div>
    <div v-else-if="campaign">
      <div class="d-flex justify-content-between align-items-start mb-3">
        <div>
          <h2 class="h4 mb-1">{{ campaign.name }}</h2>
          <small class="text-muted">
            {{ campaign.segment?.name }} • {{ campaign.scheduleType }} • {{ campaign.channel }}
          </small>
          <div class="mt-1">
            <span class="badge" :class="STATUS_LABELS[campaign.status]?.class">{{ STATUS_LABELS[campaign.status]?.label }}</span>
          </div>
        </div>
        <div class="d-flex gap-2">
          <BaseButton v-if="campaign.status === 'RUNNING' || campaign.status === 'SCHEDULED'" variant="outline"
                      @click="doAction('pause', 'Pausar campanha?')">Pausar</BaseButton>
          <BaseButton v-if="campaign.status === 'PAUSED'" variant="primary"
                      @click="doAction('resume', 'Retomar campanha?')">Retomar</BaseButton>
          <BaseButton v-if="['DRAFT','SCHEDULED','RUNNING','PAUSED'].includes(campaign.status)" variant="danger"
                      @click="doAction('cancel', 'Cancelar campanha? Esta ação é irreversível.')">Cancelar</BaseButton>
        </div>
      </div>

      <ul class="nav nav-tabs mb-4">
        <li class="nav-item">
          <a class="nav-link" :class="{ active: tab === 'overview' }" href="#" @click.prevent="tab='overview'">Visão geral</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" :class="{ active: tab === 'messages' }" href="#" @click.prevent="tab='messages'">Mensagens</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" :class="{ active: tab === 'settings' }" href="#" @click.prevent="tab='settings'">Configurações</a>
        </li>
      </ul>

      <div v-show="tab === 'overview'" class="card">
        <div class="card-body">
          <div v-if="funnel">
            <div class="mb-2">Enviadas:    <strong>{{ funnel.sent }}</strong></div>
            <div class="mb-2">Entregues:   <strong>{{ funnel.delivered }}</strong> ({{ funnel.pctDelivered }}%)</div>
            <div class="mb-2">Lidas:       <strong>{{ funnel.read }}</strong> ({{ funnel.pctRead }}%)</div>
            <div class="mb-2">Convertidas: <strong>{{ funnel.converted }}</strong> ({{ funnel.pctConverted }}%)</div>
            <ul class="small ms-3">
              <li>Forte (cupom usado): {{ funnel.convertedStrong }}</li>
              <li>Fraca (só janela): {{ funnel.weak }}</li>
            </ul>
            <div class="mb-2">Falhas:   {{ funnel.failed }}</div>
            <div class="mb-2">Opt-outs: {{ funnel.optedOut }}</div>
            <div v-if="funnel.scheduled > 0" class="mb-2">
              <span class="badge bg-info text-dark me-1">{{ funnel.scheduled }}</span>
              <span class="small text-muted">aguardando horário (silencioso)</span>
            </div>
            <div v-if="funnel.suppressedQuietHours > 0" class="mb-2">
              <span class="badge bg-dark me-1">{{ funnel.suppressedQuietHours }}</span>
              <span class="small text-muted">suprimidas — janela 24h venceria fora do horário permitido</span>
            </div>
            <hr/>
            <div class="fw-bold">Receita atribuída: {{ fmtCurrency(funnel.revenue) }}</div>
          </div>
          <div v-else class="text-muted">Sem dados ainda — aguardando primeiro envio.</div>
        </div>
      </div>

      <div v-show="tab === 'messages'" class="card">
        <div class="card-body">
          <div class="table-responsive">
            <table class="table table-sm">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Telefone</th>
                  <th>Status</th>
                  <th>Enviada</th>
                  <th>Conversão</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="m in messages" :key="m.id">
                  <td>{{ m.customer?.fullName }}</td>
                  <td>{{ m.customer?.whatsapp }}</td>
                  <td>
                    <span class="badge" :class="msgStatusBadge(m.status)" style="font-size:0.7rem;">
                      {{ msgStatusLabel(m.status) }}
                    </span>
                    <div v-if="m.status === 'SCHEDULED' && m.scheduledFor" class="text-muted" style="font-size:0.65rem;">
                      para {{ fmtDateTime(m.scheduledFor) }}
                    </div>
                    <div v-else-if="m.status === 'SUPPRESSED_QUIET_HOURS' && m.errorMessage" class="text-muted" style="font-size:0.65rem;" :title="m.errorMessage">
                      janela 24h venceria
                    </div>
                  </td>
                  <td><small>{{ fmtDateTime(m.sentAt) }}</small></td>
                  <td><small>{{ m.convertedValue ? fmtCurrency(m.convertedValue) : '—' }}</small></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div v-show="tab === 'settings'" class="card">
        <div class="card-body small">
          <pre style="white-space:pre-wrap;font-family:inherit">{{ JSON.stringify(campaign, null, 2) }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>
