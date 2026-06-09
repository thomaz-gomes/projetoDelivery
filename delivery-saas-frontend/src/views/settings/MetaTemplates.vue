<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Swal from 'sweetalert2'
import api from '../../api'
import BaseButton from '../../components/BaseButton.vue'

const router = useRouter()
const loading = ref(false)
const syncing = ref(false)
const accounts = ref([])
const templates = ref([])
const selectedAccountId = ref(null)
const statusFilter = ref('')

const filteredTemplates = computed(() => {
  let list = templates.value
  if (selectedAccountId.value) {
    list = list.filter(t => t.metaWaAccountId === selectedAccountId.value)
  }
  if (statusFilter.value) {
    list = list.filter(t => t.status === statusFilter.value)
  }
  return list
})

const statusBadge = (status) => {
  const map = {
    APPROVED: 'bg-success',
    PENDING: 'bg-warning text-dark',
    REJECTED: 'bg-danger',
    PAUSED: 'bg-secondary',
    DISABLED: 'bg-secondary',
    DELETED: 'bg-dark',
  }
  return map[status] || 'bg-light text-dark'
}

const categoryLabel = (cat) => {
  const map = {
    UTILITY: 'Utilidade',
    MARKETING: 'Marketing',
    AUTHENTICATION: 'Autenticação',
  }
  return map[cat] || cat
}

const bodyText = (components) => {
  if (!Array.isArray(components)) return ''
  const body = components.find(c => String(c.type).toUpperCase() === 'BODY')
  return body?.text || ''
}

const placeholderCount = (components) => {
  const text = JSON.stringify(components || [])
  const matches = text.match(/\{\{\d+\}\}/g) || []
  const ids = new Set(matches.map(m => m.replace(/[{}]/g, '')))
  return ids.size
}

async function load() {
  loading.value = true
  try {
    // Conta de canais conectadas (apenas META_WA).
    // O endpoint retorna { accounts: [...] }, não um array puro.
    const accResp = await api.get('/auth/meta/connected')
    const allConnected = Array.isArray(accResp.data?.accounts) ? accResp.data.accounts : []
    accounts.value = allConnected.filter(a => a.provider === 'META_WA')
    if (accounts.value.length && !selectedAccountId.value) {
      selectedAccountId.value = accounts.value[0].id
    }
    // Templates cacheados
    const tplResp = await api.get('/meta/templates')
    templates.value = Array.isArray(tplResp.data) ? tplResp.data : []
  } catch (err) {
    console.error('[MetaTemplates] load failed:', err)
    await Swal.fire({ icon: 'error', title: 'Erro ao carregar', text: err?.response?.data?.message || err.message })
  } finally {
    loading.value = false
  }
}

async function syncTemplates() {
  if (!selectedAccountId.value) {
    await Swal.fire({ icon: 'warning', title: 'Selecione um número', text: 'Escolha qual número WhatsApp sincronizar.' })
    return
  }
  syncing.value = true
  try {
    const resp = await api.post('/meta/templates/sync', { accountId: selectedAccountId.value })
    const { synced, markedDeleted } = resp.data || {}
    await Swal.fire({
      icon: 'success',
      title: 'Sincronizado',
      text: `${synced || 0} templates atualizados, ${markedDeleted || 0} marcados como removidos.`,
      timer: 3000,
      showConfirmButton: false,
    })
    await load()
    await loadMappings()
  } catch (err) {
    console.error('[MetaTemplates] sync failed:', err)
    const metaErr = err?.response?.data?.meta
    const msg = metaErr?.message || err?.response?.data?.message || err.message
    await Swal.fire({ icon: 'error', title: 'Falha na sincronização', text: msg })
  } finally {
    syncing.value = false
  }
}

// ─── Gerar templates padrão ────────────────────────────────────────────────
// Submete em lote os 8 templates do sistema (ORDER_SUMMARY, EM_PREPARO,
// SAIU_PARA_ENTREGA, CONCLUIDO, CANCELADO, CONFIRMACAO_PAGAMENTO,
// RIDER_ASSIGNED, CASHBACK_CREDIT) já formatados com as variáveis na ordem
// que o notify.js espera, e cria os NotificationTemplateMapping automatica-
// mente. Idempotente: re-rodar não duplica.
const seeding = ref(false)
async function seedDefaults() {
  if (!selectedAccountId.value) {
    await Swal.fire({ icon: 'warning', title: 'Selecione um número', text: 'Escolha qual número WhatsApp.' })
    return
  }
  const confirm = await Swal.fire({
    icon: 'question',
    title: 'Gerar templates padrão?',
    html: `Vai submeter na Meta os <strong>8 templates do sistema</strong> (status de pedido, cashback, etc.) já alinhados com as notificações automáticas.<br><br>Templates já existentes são ignorados — é seguro rodar várias vezes.`,
    showCancelButton: true,
    confirmButtonText: 'Gerar agora',
    cancelButtonText: 'Cancelar',
  })
  if (!confirm.isConfirmed) return
  seeding.value = true
  try {
    const resp = await api.post('/meta/templates/seed-defaults', { accountId: selectedAccountId.value }, { timeout: 60000 })
    const { submitted = 0, skipped = 0, failed = 0, results = [] } = resp.data || {}
    const errorList = results.filter(r => r.error)
    const summaryHtml = `
      <div class="text-start">
        <p><strong>${submitted}</strong> submetidos · <strong>${skipped}</strong> já existiam · <strong>${failed}</strong> falharam</p>
        ${errorList.length ? `<hr><div class="small text-danger">${errorList.map(r => `<div><strong>${r.notificationType}:</strong> ${r.error}</div>`).join('')}</div>` : ''}
        ${submitted > 0 ? `<hr><div class="small text-muted">Templates submetidos ficam em <strong>PENDING</strong>. A Meta costuma aprovar UTILITY em minutos — quando ficarem APPROVED, o sistema passa a usá-los automaticamente fora da janela 24h.</div>` : ''}
      </div>
    `
    await Swal.fire({
      icon: failed > 0 ? 'warning' : 'success',
      title: failed > 0 ? 'Concluído com avisos' : 'Templates gerados',
      html: summaryHtml,
    })
    await load()
    await loadMappings()
  } catch (err) {
    console.error('[MetaTemplates] seed-defaults failed:', err)
    const msg = err?.response?.data?.message || err.message
    await Swal.fire({ icon: 'error', title: 'Falha ao gerar templates', text: msg })
  } finally {
    seeding.value = false
  }
}

// ─── Mapeamento de notificações → templates ────────────────────────────────
//
// Cada tipo de notificação transacional (status de pedido, cashback, etc.)
// pode receber um template aprovado como fallback. Quando o Meta WA rejeita
// um envio de texto livre por janela 24h expirada (erro 131047), o notify.js
// busca o template mapeado aqui e envia via sendTemplate em vez de cair pra
// Evolution. Mapeamento por empresa (compartilhado entre cardápios).
const NOTIFICATION_LABELS = {
  EM_PREPARO: 'Pedido em preparo',
  SAIU_PARA_ENTREGA: 'Saiu para entrega',
  CONCLUIDO: 'Pedido concluído',
  CANCELADO: 'Pedido cancelado',
  CONFIRMACAO_PAGAMENTO: 'Confirmação de pagamento',
  ORDER_SUMMARY: 'Resumo do pedido (criação)',
  RIDER_ASSIGNED: 'Motoboy atribuído (mensagem ao entregador)',
  CASHBACK_CREDIT: 'Cashback creditado',
}

// Placeholders esperados em cada template (ordem importa — combinam com
// TEMPLATE_PARAM_BUILDERS em notify.js). Mostrado na UI como dica pra quem
// criar/aprovar o template no Meta Business Manager.
const NOTIFICATION_PLACEHOLDERS = {
  EM_PREPARO: '{{1}} nome  ·  {{2}} nº do pedido  ·  {{3}} loja',
  SAIU_PARA_ENTREGA: '{{1}} nome  ·  {{2}} nº do pedido  ·  {{3}} loja',
  CONCLUIDO: '{{1}} nome  ·  {{2}} nº do pedido  ·  {{3}} loja',
  CANCELADO: '{{1}} nome  ·  {{2}} nº do pedido  ·  {{3}} loja',
  CONFIRMACAO_PAGAMENTO: '{{1}} nome  ·  {{2}} nº do pedido  ·  {{3}} loja',
  ORDER_SUMMARY: '{{1}} nome  ·  {{2}} nº do pedido  ·  {{3}} loja',
  RIDER_ASSIGNED: '{{1}} pedido  ·  {{2}} cliente  ·  {{3}} endereço  ·  {{4}} mapa',
  CASHBACK_CREDIT: '{{1}} nome  ·  {{2}} valor ganho  ·  {{3}} saldo',
}

const supportedTypes = ref([])
const mappings = ref([]) // [{ notificationType, metaTemplateId }, ...]
const savingMappings = ref(false)

// Lista de templates APPROVED da conta selecionada — só esses podem ser usados.
const approvedTemplates = computed(() =>
  templates.value.filter(t =>
    t.status === 'APPROVED' &&
    (!selectedAccountId.value || t.metaWaAccountId === selectedAccountId.value)
  )
)

async function loadMappings() {
  try {
    const { data } = await api.get('/meta/notification-mappings')
    supportedTypes.value = data?.supportedTypes || []
    const dict = {}
    for (const m of (data?.mappings || [])) {
      dict[m.notificationType] = m.metaTemplateId
    }
    // Garante uma linha pra cada tipo suportado, mesmo sem mapping ainda.
    mappings.value = (data?.supportedTypes || []).map(t => ({
      notificationType: t,
      metaTemplateId: dict[t] || '',
    }))
  } catch (err) {
    console.error('[MetaTemplates] loadMappings failed:', err)
  }
}

async function saveMappings() {
  savingMappings.value = true
  try {
    // Envia tudo (entradas vazias removem o mapping no backend)
    const payload = {
      mappings: mappings.value.map(m => ({
        notificationType: m.notificationType,
        metaTemplateId: m.metaTemplateId || null,
      })),
    }
    await api.put('/meta/notification-mappings', payload)
    await Swal.fire({
      icon: 'success',
      title: 'Mapeamentos salvos',
      timer: 1500,
      showConfirmButton: false,
    })
    await loadMappings()
  } catch (err) {
    console.error('[MetaTemplates] saveMappings failed:', err)
    await Swal.fire({
      icon: 'error',
      title: 'Erro ao salvar mapeamentos',
      text: err?.response?.data?.message || err.message,
    })
  } finally {
    savingMappings.value = false
  }
}

onMounted(async () => {
  await load()
  await loadMappings()
})
</script>

<template>
  <div class="container py-4">
    <div class="d-flex align-items-center justify-content-between mb-3">
      <h2 class="mb-0">Templates WhatsApp</h2>
      <div class="d-flex gap-2">
        <BaseButton variant="outline" @click="seedDefaults" :loading="seeding" :disabled="loading || !selectedAccountId" title="Submete na Meta os templates padrão do sistema (status de pedido, cashback, etc.)">
          <i class="bi bi-magic me-1"></i> Gerar padrão
        </BaseButton>
        <BaseButton variant="outline" @click="syncTemplates" :loading="syncing" :disabled="loading || !selectedAccountId">
          <i class="bi bi-arrow-repeat me-1"></i> Sincronizar
        </BaseButton>
        <BaseButton variant="primary" @click="router.push('/settings/whatsapp-templates/new')" :disabled="!accounts.length">
          <i class="bi bi-plus-lg me-1"></i> Novo template
        </BaseButton>
      </div>
    </div>

    <div class="alert alert-info small mb-3">
      <i class="bi bi-info-circle me-1"></i>
      Templates Meta WhatsApp passam por aprovação da Meta antes de poderem ser usados em campanhas. Você pode criar
      direto aqui ("Novo template") ou cadastrar no <a href="https://business.facebook.com" target="_blank" rel="noopener">Meta Business Manager</a> e depois sincronizar.
    </div>

    <div class="card p-3 mb-3" v-if="accounts.length">
      <div class="row g-3">
        <div class="col-md-6">
          <label class="form-label">Número WhatsApp</label>
          <select class="form-select" v-model="selectedAccountId">
            <option v-for="acc in accounts" :key="acc.id" :value="acc.id">
              {{ acc.displayName || acc.externalId }}
            </option>
          </select>
        </div>
        <div class="col-md-6">
          <label class="form-label">Status</label>
          <select class="form-select" v-model="statusFilter">
            <option value="">Todos</option>
            <option value="APPROVED">Aprovados</option>
            <option value="PENDING">Pendentes</option>
            <option value="REJECTED">Rejeitados</option>
            <option value="PAUSED">Pausados</option>
            <option value="DISABLED">Desativados</option>
            <option value="DELETED">Removidos</option>
          </select>
        </div>
      </div>
    </div>

    <div v-if="loading" class="text-center py-5 text-muted">
      <div class="spinner-border" role="status"></div>
      <div class="mt-2">Carregando...</div>
    </div>

    <div v-else-if="!accounts.length" class="alert alert-warning">
      Nenhum número WhatsApp Cloud conectado. Conecte um em
      <router-link to="/settings/whatsapp-cloud">WhatsApp Cloud API</router-link> antes.
    </div>

    <div v-else-if="!filteredTemplates.length" class="alert alert-light border text-center py-4">
      <i class="bi bi-inbox" style="font-size: 2rem;"></i>
      <div class="mt-2">Nenhum template encontrado para este número.</div>
      <div class="small text-muted mt-1">Clique em "Sincronizar" para puxar os templates aprovados do Meta Business Manager.</div>
    </div>

    <div v-else class="table-responsive">
      <table class="table table-hover align-middle">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Idioma</th>
            <th>Categoria</th>
            <th>Status</th>
            <th>Placeholders</th>
            <th>Texto do corpo</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in filteredTemplates" :key="t.id">
            <td>
              <code>{{ t.name }}</code>
              <span v-if="t.createdViaApp" class="badge bg-light text-muted ms-1" title="Criado pelo painel">
                <i class="bi bi-cloud-arrow-up" style="font-size:0.7rem"></i>
              </span>
            </td>
            <td><span class="badge bg-light text-dark">{{ t.language }}</span></td>
            <td>{{ categoryLabel(t.category) }}</td>
            <td>
              <span class="badge" :class="statusBadge(t.status)">
                <span v-if="t.status === 'PENDING'" class="spinner-grow spinner-grow-sm me-1" style="width:0.5rem;height:0.5rem"></span>
                {{ t.status }}
              </span>
              <div v-if="t.status === 'REJECTED' && t.rejectionReason" class="small text-danger mt-1" :title="t.rejectionReason">
                <i class="bi bi-exclamation-circle me-1"></i>{{ t.rejectionReason }}
              </div>
            </td>
            <td class="text-center">{{ placeholderCount(t.components) }}</td>
            <td class="text-muted small" style="max-width: 400px;">
              <div class="text-truncate" :title="bodyText(t.components)">{{ bodyText(t.components) }}</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Mapeamento de notificações → template aprovado -->
    <div v-if="accounts.length" class="card p-3 mt-4">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h5 class="mb-0">Mapear notificações para templates</h5>
        <BaseButton @click="saveMappings" :loading="savingMappings" :disabled="loading || !mappings.length">
          <i class="bi bi-save me-1"></i> Salvar mapeamentos
        </BaseButton>
      </div>
      <p class="small text-muted mb-3">
        Quando uma notificação transacional for rejeitada pela Meta por janela de 24h expirada
        (erro <code>131047</code>), o sistema envia automaticamente o template aprovado abaixo no
        lugar do texto livre. Os placeholders precisam estar na ordem indicada.
      </p>

      <div v-if="!approvedTemplates.length" class="alert alert-warning small mb-0">
        Nenhum template <strong>APPROVED</strong> nesta conta ainda. Sincronize acima e/ou crie/aprove
        templates no <a href="https://business.facebook.com" target="_blank" rel="noopener">Meta Business Manager</a>.
      </div>

      <div v-else class="table-responsive">
        <table class="table table-sm align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th style="width: 28%">Notificação</th>
              <th style="width: 32%">Placeholders esperados</th>
              <th>Template aprovado</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in mappings" :key="m.notificationType">
              <td>
                <strong>{{ NOTIFICATION_LABELS[m.notificationType] || m.notificationType }}</strong>
                <div class="small text-muted"><code>{{ m.notificationType }}</code></div>
              </td>
              <td class="small text-muted">
                <code>{{ NOTIFICATION_PLACEHOLDERS[m.notificationType] || '—' }}</code>
              </td>
              <td>
                <select class="form-select form-select-sm" v-model="m.metaTemplateId">
                  <option value="">— Não mapear (cai para Evolution se houver) —</option>
                  <option v-for="t in approvedTemplates" :key="t.id" :value="t.id">
                    {{ t.name }} ({{ t.language }})
                  </option>
                </select>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
