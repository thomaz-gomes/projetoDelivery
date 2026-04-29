<template>
  <div>
    <!-- Free Delivery Settings -->
    <div class="card mb-4">
      <div class="card-body">
        <h6 class="fw-semibold mb-3"><i class="bi bi-truck me-2 text-primary"></i>Entrega Grátis</h6>
        <div class="form-check form-switch mb-3">
          <input class="form-check-input" type="checkbox" id="freeDeliveryToggle" v-model="freeSettings.enabled" />
          <label class="form-check-label fw-semibold" for="freeDeliveryToggle">Ativar entrega grátis</label>
        </div>
        <div v-if="freeSettings.enabled" class="mb-3" style="max-width:280px">
          <CurrencyInput label="Pedido mínimo para entrega grátis" v-model="freeSettings.minOrder" placeholder="0,00" />
          <div class="form-text">Pedidos com subtotal igual ou acima desse valor terão entrega grátis.</div>
        </div>
        <BaseButton variant="primary" size="sm" :loading="savingSettings" @click="saveSettings">
          <i class="bi bi-check-lg me-1"></i>Salvar configuração
        </BaseButton>
      </div>
    </div>

    <ListCard
      title="Bairros"
      icon="bi bi-geo-alt"
      :subtitle="list.length ? `${list.length} bairros` : ''"
      :quickSearch="true"
      quickSearchPlaceholder="Buscar por nome ou apelido"
      @quick-search="onQuickSearch"
      @quick-clear="onQuickClear"
    >
      <template #actions>
        <div class="d-flex align-items-center gap-2">
          <BaseButton variant="outline" size="sm" @click="openTestModal">
            <i class="bi bi-search me-1"></i>Testar detecção
          </BaseButton>
          <BaseButton variant="outline" size="sm" @click="openRetroModal">
            <i class="bi bi-arrow-clockwise me-1"></i>Taxas retroativas
          </BaseButton>
          <label class="btn btn-sm btn-outline-secondary mb-0" style="cursor:pointer;">
            <i class="bi bi-upload me-1"></i> Importar CSV
            <input type="file" accept=".csv" style="display:none" @change="e => handleFileImport(e.target.files[0])" />
          </label>
          <BaseButton variant="primary" size="sm" @click="openNew">
            <i class="bi bi-plus-lg me-1"></i>Novo bairro
          </BaseButton>
        </div>
      </template>

      <template #default>
        <div v-if="loading" class="text-center py-4 text-muted">Carregando...</div>
        <div v-else-if="displayed.length === 0" class="alert alert-info m-3">Nenhum bairro cadastrado</div>
        <div v-else class="table-responsive">
          <table class="table table-hover align-middle">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Apelidos</th>
                <th>Taxa entrega</th>
                <th>Taxa motoboy</th>
                <th style="width:100px">Ações</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="n in displayed" :key="n.id">
                <td><strong>{{ n.name }}</strong></td>
                <td><span class="text-muted small">{{ Array.isArray(n.aliases) ? n.aliases.join(', ') : (n.aliases || '—') }}</span></td>
                <td>{{ formatCurrency(n.deliveryFee) }}</td>
                <td>{{ formatCurrency(n.riderFee) }}</td>
                <td>
                  <div class="d-flex gap-1">
                    <BaseIconButton color="primary" title="Editar" @click="edit(n)">
                      <i class="bi bi-pencil-square"></i>
                    </BaseIconButton>
                    <BaseIconButton color="danger" title="Remover" @click="removeNeighborhood(n)">
                      <i class="bi bi-trash"></i>
                    </BaseIconButton>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="importing" class="px-3 pb-3">
          <div class="small text-muted">Importando... {{ importProgress.done }} / {{ importProgress.total }} processados</div>
          <div v-if="importProgress.errors.length" class="mt-2">
            <div class="small text-danger">Erros durante importação:</div>
            <ul class="small text-danger mb-0">
              <li v-for="(er, idx) in importProgress.errors" :key="idx">Linha {{ er.row }}: {{ er.message }}</li>
            </ul>
          </div>
        </div>
      </template>
    </ListCard>

    <!-- Form Modal -->
    <div v-if="showForm" class="modal-backdrop" @click.self="closeForm">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">{{ form.id ? 'Editar bairro' : 'Novo bairro' }}</h5>
            <button type="button" class="btn-close" @click="closeForm"></button>
          </div>
          <div class="modal-body">
            <form @submit.prevent="save">
              <div class="mb-3">
                <TextInput label="Nome" v-model="form.name" placeholder="Nome do bairro" required />
              </div>
              <div class="mb-3">
                <TextInput label="Apelidos" v-model="form.aliases" placeholder="Separados por vírgula" />
                <div class="form-text">Nomes alternativos para detecção automática</div>
              </div>
              <div class="row g-3">
                <div class="col-6">
                  <CurrencyInput label="Taxa entrega" v-model="form.deliveryFee" placeholder="0,00" />
                </div>
                <div class="col-6">
                  <CurrencyInput label="Taxa motoboy" v-model="form.riderFee" placeholder="0,00" />
                </div>
              </div>
            </form>
          </div>
          <div class="modal-footer">
            <BaseButton variant="outline" @click="closeForm">Cancelar</BaseButton>
            <BaseButton variant="primary" :loading="saving" @click="save">Salvar</BaseButton>
          </div>
        </div>
      </div>
    </div>

    <!-- Test Match Modal -->
    <div v-if="showTest" class="modal-backdrop" @click.self="closeTest">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Testar detecção de bairro</h5>
            <button type="button" class="btn-close" @click="closeTest"></button>
          </div>
          <div class="modal-body">
            <p class="small text-muted mb-2">Cole um texto de endereço e verifique qual bairro é detectado pelo sistema.</p>
            <textarea v-model="testText" class="form-control mb-3" rows="3" placeholder="Ex: Rua das Flores, Centro, São Paulo"></textarea>
            <div v-if="matchResult !== null" class="alert mb-0" :class="matchResult ? 'alert-success' : 'alert-warning'">
              <strong>Resultado:</strong> {{ matchResult || 'Nenhum bairro detectado' }}
            </div>
          </div>
          <div class="modal-footer">
            <BaseButton variant="outline" @click="closeTest">Fechar</BaseButton>
            <BaseButton variant="primary" :loading="testing" @click="testMatch">Testar</BaseButton>
          </div>
        </div>
      </div>
    </div>

    <!-- Retroactive Rider Fees Modal -->
    <div v-if="showRetro" class="modal-backdrop" @click.self="closeRetroModal">
      <div class="modal-dialog modal-dialog--wide">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title"><i class="bi bi-arrow-clockwise me-2"></i>Taxas retroativas de motoboys</h5>
            <button type="button" class="btn-close" @click="closeRetroModal"></button>
          </div>
          <div class="modal-body">
            <p class="small text-muted mb-3">
              Recalcula a taxa de entrega dos motoboys para pedidos concluídos cujo bairro não foi detectado no momento da conclusão.
              Use <strong>Pré-visualizar</strong> antes de aplicar.
            </p>

            <div class="row g-3 mb-4">
              <div class="col-6">
                <TextInput label="De (opcional)" v-model="retro.startDate" type="date" />
              </div>
              <div class="col-6">
                <TextInput label="Até (opcional)" v-model="retro.endDate" type="date" />
              </div>
            </div>

            <!-- Preview results -->
            <div v-if="retro.preview" class="retro-preview">
              <div class="d-flex gap-3 mb-3">
                <div class="retro-stat">
                  <div class="retro-stat__value">{{ retro.preview.checked }}</div>
                  <div class="retro-stat__label">Verificados</div>
                </div>
                <div class="retro-stat retro-stat--success">
                  <div class="retro-stat__value">{{ retro.preview.corrected }}</div>
                  <div class="retro-stat__label">Serão corrigidos</div>
                </div>
                <div class="retro-stat">
                  <div class="retro-stat__value">{{ retro.preview.skipped }}</div>
                  <div class="retro-stat__label">Sem match</div>
                </div>
                <div class="retro-stat retro-stat--primary">
                  <div class="retro-stat__value">{{ formatCurrency(retro.preview.totalCredited) }}</div>
                  <div class="retro-stat__label">Total a creditar</div>
                </div>
              </div>

              <div v-if="retro.preview.results.length" class="table-responsive" style="max-height:240px;overflow-y:auto;">
                <table class="table table-hover align-middle mb-0" style="font-size:0.8rem;">
                  <thead>
                    <tr>
                      <th>Bairro do pedido</th>
                      <th>Bairro detectado</th>
                      <th class="text-end">Taxa</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="r in retro.preview.results" :key="r.orderId">
                      <td>{{ r.deliveryNeighborhood || '—' }}</td>
                      <td>{{ r.matchedNeighborhood || '—' }}</td>
                      <td class="text-end">{{ formatCurrency(r.riderFee) }}</td>
                      <td>
                        <span v-if="r.willCredit" class="badge bg-success">Corrigir</span>
                        <span v-else class="badge bg-light text-dark">Sem match</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div v-if="retro.applied" class="alert alert-success mb-0">
              <i class="bi bi-check-circle me-2"></i>
              <strong>{{ retro.applied.corrected }}</strong> pedidos corrigidos — total creditado: <strong>{{ formatCurrency(retro.applied.totalCredited) }}</strong>
            </div>
          </div>
          <div class="modal-footer">
            <BaseButton variant="outline" @click="closeRetroModal">Fechar</BaseButton>
            <BaseButton variant="outline" :loading="retro.previewing" @click="runRetro(true)">
              <i class="bi bi-eye me-1"></i>Pré-visualizar
            </BaseButton>
            <BaseButton
              variant="secondary"
              :loading="retro.applying"
              :disabled="!retro.preview || retro.preview.corrected === 0"
              @click="runRetro(false)"
            >
              <i class="bi bi-check-lg me-1"></i>Aplicar
            </BaseButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import api from '../api'
import { formatCurrency } from '../utils/formatters.js'
import ListCard from '@/components/ListCard.vue'
import { bindLoading } from '../state/globalLoading.js'
import Swal from 'sweetalert2'

const list = ref([])
const q = ref('')
const loading = ref(false)
bindLoading(loading)

// Free delivery settings
const freeSettings = ref({ enabled: false, minOrder: '0,00' })
const savingSettings = ref(false)

async function fetchSettings() {
  try {
    const { data } = await api.get('/neighborhoods/settings')
    freeSettings.value = {
      enabled: data.freeDeliveryEnabled ?? false,
      minOrder: data.freeDeliveryMinOrder != null ? String(data.freeDeliveryMinOrder) : '0,00',
    }
  } catch (e) { console.warn('Falha ao carregar configuração de entrega grátis', e) }
}

async function saveSettings() {
  savingSettings.value = true
  try {
    await api.patch('/neighborhoods/settings', {
      freeDeliveryEnabled: freeSettings.value.enabled,
      freeDeliveryMinOrder: freeSettings.value.enabled
        ? parseFloat(String(freeSettings.value.minOrder || 0).replace(',', '.')) || 0
        : null,
    })
    Swal.fire({ icon: 'success', text: 'Configuração salva', timer: 1500, showConfirmButton: false })
  } catch (e) {
    Swal.fire({ icon: 'error', text: e.response?.data?.message || 'Erro ao salvar configuração' })
  } finally {
    savingSettings.value = false
  }
}

const displayed = computed(() => {
  if (!q.value) return list.value || []
  const term = q.value.toLowerCase()
  return (list.value || []).filter(n => {
    const aliases = Array.isArray(n.aliases) ? n.aliases.join(' ') : (n.aliases || '')
    return ((n.name || '') + ' ' + aliases).toLowerCase().includes(term)
  })
})

// Form
const showForm = ref(false)
const form = ref({ id: null, name: '', aliases: '', deliveryFee: '0,00', riderFee: '0,00' })
const saving = ref(false)

// Test match
const showTest = ref(false)
const testText = ref('')
const testing = ref(false)
const matchResult = ref(null)

// Retroactive fees
const showRetro = ref(false)
const retro = ref({
  startDate: '',
  endDate: '',
  previewing: false,
  applying: false,
  preview: null,
  applied: null,
})

// Import
const importing = ref(false)
const importProgress = ref({ total: 0, done: 0, errors: [] })

async function fetchList() {
  loading.value = true
  try {
    const { data } = await api.get('/neighborhoods')
    list.value = data
  } catch (e) {
    Swal.fire({ icon: 'error', text: 'Falha ao carregar bairros' })
  } finally {
    loading.value = false
  }
}

function openNew() {
  form.value = { id: null, name: '', aliases: '', deliveryFee: '0,00', riderFee: '0,00' }
  showForm.value = true
}
function closeForm() { showForm.value = false }

function edit(n) {
  form.value = {
    id: n.id,
    name: n.name,
    aliases: Array.isArray(n.aliases) ? n.aliases.join(', ') : (n.aliases || '').toString(),
    deliveryFee: (n.deliveryFee || 0).toString(),
    riderFee: (n.riderFee || 0).toString(),
  }
  showForm.value = true
}

async function save() {
  if (!form.value.name) return
  saving.value = true
  try {
    const payload = {
      name: form.value.name,
      aliases: form.value.aliases ? form.value.aliases.split(',').map(s => s.trim()).filter(Boolean) : [],
      deliveryFee: parseFloat(form.value.deliveryFee || 0),
      riderFee: parseFloat(form.value.riderFee || 0),
    }
    if (form.value.id) {
      await api.patch(`/neighborhoods/${form.value.id}`, payload)
    } else {
      await api.post('/neighborhoods', payload)
    }
    await fetchList()
    closeForm()
    Swal.fire({ icon: 'success', text: 'Bairro salvo com sucesso', timer: 1500, showConfirmButton: false })
  } catch (e) {
    Swal.fire({ icon: 'error', text: e.response?.data?.message || 'Erro ao salvar bairro' })
  } finally {
    saving.value = false
  }
}

async function removeNeighborhood(n) {
  const result = await Swal.fire({
    title: 'Remover bairro?',
    text: `Remover "${n.name}"? Esta ação não pode ser desfeita.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Remover',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc3545',
  })
  if (!result.isConfirmed) return
  try {
    await api.delete(`/neighborhoods/${n.id}`)
    await fetchList()
    Swal.fire({ icon: 'success', text: 'Bairro removido', timer: 1500, showConfirmButton: false })
  } catch (e) {
    Swal.fire({ icon: 'error', text: e.response?.data?.message || 'Erro ao remover bairro' })
  }
}

// Test match
function openTestModal() { showTest.value = true; testText.value = ''; matchResult.value = null }
function closeTest() { showTest.value = false }

async function testMatch() {
  if (!testText.value) return (matchResult.value = null)
  testing.value = true
  matchResult.value = null
  try {
    const { data } = await api.post('/neighborhoods/match', { text: testText.value })
    matchResult.value = data?.match ?? null
  } catch (e) {
    matchResult.value = null
  } finally {
    testing.value = false
  }
}

// Retroactive fees
function openRetroModal() {
  retro.value = { startDate: '', endDate: '', previewing: false, applying: false, preview: null, applied: null }
  showRetro.value = true
}
function closeRetroModal() { showRetro.value = false }

async function runRetro(dryRun) {
  if (dryRun) {
    retro.value.previewing = true
    retro.value.preview = null
  } else {
    const confirm = await Swal.fire({
      title: 'Aplicar taxas retroativas?',
      text: `Serão creditados ${retro.value.preview.corrected} pedidos (${formatCurrency(retro.value.preview.totalCredited)}). Esta ação não pode ser desfeita.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Aplicar',
      cancelButtonText: 'Cancelar',
    })
    if (!confirm.isConfirmed) return
    retro.value.applying = true
  }

  try {
    const body = { dryRun }
    if (retro.value.startDate) body.startDate = retro.value.startDate
    if (retro.value.endDate) body.endDate = retro.value.endDate

    const { data } = await api.post('/orders/retroactive-rider-fees', body)

    if (dryRun) {
      retro.value.preview = data
    } else {
      retro.value.applied = data
      retro.value.preview = null
    }
  } catch (e) {
    Swal.fire({ icon: 'error', text: e.response?.data?.message || 'Erro ao processar taxas retroativas' })
  } finally {
    retro.value.previewing = false
    retro.value.applying = false
  }
}

// Search
function onQuickSearch(val) { q.value = val }
function onQuickClear() { q.value = '' }

// CSV Import
function parseCsv(text) {
  if (!text) return []
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  const lines = text.split(/\r?\n/)
  const nonEmpty = lines.filter(l => l.trim() !== '')
  if (!nonEmpty.length) return []

  const first = nonEmpty[0]
  const candidates = [',', ';', '\t', '|']
  let sep = ','
  let maxCount = -1
  for (const s of candidates) {
    const cnt = first.split(s).length - 1
    if (cnt > maxCount) { maxCount = cnt; sep = s }
  }

  const parseLine = (line) => {
    const res = []
    let cur = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; continue }
        inQuotes = !inQuotes
        continue
      }
      if (!inQuotes && ch === sep) { res.push(cur); cur = ''; continue }
      cur += ch
    }
    res.push(cur)
    return res.map(c => c.trim())
  }

  const header = parseLine(nonEmpty.shift()).map(h => h.replace(/^"|"$/g, ''))
  return nonEmpty.map(line => {
    const cols = parseLine(line)
    const obj = {}
    header.forEach((h, i) => { obj[h] = (cols[i] ?? '').replace(/^"|"$/g, '') })
    return obj
  })
}

async function handleFileImport(file) {
  if (!file) return
  importing.value = true
  importProgress.value = { total: 0, done: 0, errors: [] }
  try {
    const txt = await file.text()
    const rows = parseCsv(txt)
    importProgress.value.total = rows.length
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const payload = {
        name: (r.name || '').trim(),
        aliases: (r.aliases || '').split(',').map(s => s.trim()).filter(Boolean),
        deliveryFee: parseFloat((r.deliveryFee || '0').replace(/[,]/g, '.')) || 0,
        riderFee: parseFloat((r.riderFee || '0').replace(/[,]/g, '.')) || 0,
      }
      if (!payload.name) {
        importProgress.value.errors.push({ row: i + 1, message: 'Nome vazio' })
        continue
      }
      try {
        await api.post('/neighborhoods', payload)
        importProgress.value.done++
      } catch (e) {
        importProgress.value.errors.push({ row: i + 1, message: e?.response?.data?.message || String(e) })
      }
    }
    await fetchList()
    if (!importProgress.value.errors.length) {
      Swal.fire({ icon: 'success', text: `${importProgress.value.done} bairros importados`, timer: 2000, showConfirmButton: false })
      importing.value = false
    }
  } catch (e) {
    importProgress.value.errors.push({ row: 0, message: String(e) })
  }
}

onMounted(() => { fetchList(); fetchSettings() })
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 80px;
  z-index: 1050;
}

.modal-dialog {
  width: 100%;
  max-width: 550px;
}

.modal-dialog--wide {
  max-width: 720px;
}

/* Retroactive preview stats */
.retro-preview {
  background: var(--bg-input);
  border-radius: var(--border-radius-sm);
  padding: 1rem;
  margin-bottom: 1rem;
}

.retro-stat {
  flex: 1;
  text-align: center;
  padding: 0.625rem;
  background: var(--bg-card);
  border-radius: var(--border-radius-sm);
  border: 1px solid var(--border-color);
}

.retro-stat--success { border-color: var(--success-light); }
.retro-stat--primary { border-color: var(--primary-light); }

.retro-stat__value {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
}

.retro-stat--success .retro-stat__value { color: var(--success-dark); }
.retro-stat--primary .retro-stat__value { color: var(--primary); }

.retro-stat__label {
  font-size: 0.72rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  margin-top: 0.25rem;
}
</style>
