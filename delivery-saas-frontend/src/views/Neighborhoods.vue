<template>
  <div>
    <ListCard title="Bairros" icon="bi bi-geo-alt" :subtitle="list.length ? `${list.length} bairros` : ''" :quickSearch="true" quickSearchPlaceholder="Buscar por nome ou apelido" @quick-search="onQuickSearch" @quick-clear="onQuickClear">
      <template #actions>
        <div class="d-flex align-items-center gap-2">
          <button class="btn btn-outline-secondary" @click="openTestModal"><i class="bi bi-search me-1"></i> Testar detecção</button>
          <label class="btn btn-outline-secondary mb-0" style="cursor:pointer;">
            <i class="bi bi-upload me-1"></i> Importar CSV
            <input type="file" accept=".csv" style="display:none" @change="e => handleFileImport(e.target.files[0])" />
          </label>
          <button class="btn btn-primary" @click="openNew"><i class="bi bi-plus-lg me-1"></i> Novo bairro</button>
        </div>
      </template>

      <template #default>
        <div v-if="loading" class="text-center py-4">Carregando...</div>
        <div v-else-if="displayed.length === 0" class="alert alert-info">Nenhum bairro cadastrado</div>
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
                    <button class="btn btn-sm btn-light" @click="edit(n)" title="Editar"><i class="bi bi-pencil-square"></i></button>
                    <button class="btn btn-sm btn-outline-danger" @click="removeNeighborhood(n)" title="Remover"><i class="bi bi-trash"></i></button>
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
    <div v-if="showForm" class="modal-backdrop d-block" style="background:rgba(0,0,0,0.4);" @click.self="closeForm">
      <div class="modal d-block" tabindex="-1" style="max-width:550px;margin:80px auto;">
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
              <button class="btn btn-outline-secondary" @click="closeForm">Cancelar</button>
              <button class="btn btn-primary" @click="save" :disabled="saving">{{ saving ? 'Salvando...' : 'Salvar' }}</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Test Match Modal -->
    <div v-if="showTest" class="modal-backdrop d-block" style="background:rgba(0,0,0,0.4);" @click.self="closeTest">
      <div class="modal d-block" tabindex="-1" style="max-width:550px;margin:80px auto;">
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
              <button class="btn btn-outline-secondary" @click="closeTest">Fechar</button>
              <button class="btn btn-primary" @click="testMatch" :disabled="testing">{{ testing ? 'Testando...' : 'Testar' }}</button>
            </div>
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

// Import
const importing = ref(false)
const importProgress = ref({ total: 0, done: 0, errors: [] })

async function fetchList() {
  loading.value = true
  try {
    const { data } = await api.get('/neighborhoods')
    list.value = data
  } catch (e) {
    console.error(e)
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
    riderFee: (n.riderFee || 0).toString()
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
    console.error(e)
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
    console.error(e)
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
    console.error('Match test failed', e)
    matchResult.value = null
  } finally {
    testing.value = false
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
  const rows = nonEmpty.map(line => {
    const cols = parseLine(line)
    const obj = {}
    header.forEach((h, i) => { obj[h] = (cols[i] ?? '').replace(/^"|"$/g, '') })
    return obj
  })
  return rows
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

onMounted(fetchList)
</script>

<style scoped>
.modal-backdrop { position: fixed; inset: 0; display: flex; align-items: flex-start; justify-content: center; z-index: 1050; }
</style>
