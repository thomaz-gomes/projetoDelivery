<template>
  <div class="container py-4">
    <div class="d-flex align-items-center justify-content-between mb-4 flex-wrap gap-2">
      <div>
        <h3 class="mb-1"><i class="bi bi-palette me-2"></i>Temas Visuais da Marca</h3>
        <p class="text-muted small mb-0">
          Configure o estilo que a IA aplica ao gerar imagens de produto.
        </p>
      </div>
      <button class="btn btn-primary" @click="openCreate">
        <i class="bi bi-plus-lg me-1"></i> Novo tema
      </button>
    </div>

    <div v-if="loading" class="text-muted">
      <span class="spinner-border spinner-border-sm me-2"></span> Carregando...
    </div>

    <div v-else-if="themes.length === 0" class="alert alert-info">
      Nenhum tema ainda. Crie um para que a IA gere imagens com a identidade da sua marca.
    </div>

    <div v-else class="row g-3">
      <div v-for="t in themes" :key="t.id" class="col-12 col-md-6 col-lg-4">
        <div class="card h-100">
          <div class="card-body">
            <div class="d-flex align-items-start justify-content-between mb-2">
              <div class="flex-grow-1 me-2">
                <h5 class="mb-1">
                  {{ t.name }}
                  <span v-if="t.isDefault" class="badge bg-primary ms-1">Padrão</span>
                </h5>
                <div class="small text-muted">
                  <i class="bi bi-shop me-1"></i>{{ t.store ? t.store.name : 'Todas as lojas' }}
                </div>
              </div>
              <div class="d-flex gap-1 flex-shrink-0">
                <button
                  class="btn btn-sm btn-outline-secondary"
                  title="Editar"
                  @click="openEdit(t)"
                >
                  <i class="bi bi-pencil"></i>
                </button>
                <button
                  class="btn btn-sm btn-outline-danger"
                  title="Excluir"
                  @click="confirmDelete(t)"
                >
                  <i class="bi bi-trash"></i>
                </button>
              </div>
            </div>
            <div v-if="t.palette" class="small mb-1"><strong>Paleta:</strong> {{ t.palette }}</div>
            <div v-if="t.mood" class="small mb-1"><strong>Mood:</strong> {{ t.mood }}</div>
            <div v-if="t.surface" class="small mb-1"><strong>Superfície:</strong> {{ t.surface }}</div>
            <div v-if="t.lighting" class="small mb-1"><strong>Iluminação:</strong> {{ t.lighting }}</div>
            <div v-if="t.props" class="small"><strong>Props:</strong> {{ t.props }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal de cadastro/edição -->
    <div
      v-if="modalOpen"
      class="modal show d-block"
      tabindex="-1"
      style="background: rgba(0, 0, 0, 0.35)"
    >
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">{{ editing ? 'Editar tema' : 'Novo tema' }}</h5>
            <button type="button" class="btn-close" @click="closeModal"></button>
          </div>
          <div class="modal-body">
            <div v-if="error" class="alert alert-danger py-2 small">{{ error }}</div>
            <div class="row g-3">
              <div class="col-12 col-md-6">
                <label class="form-label">Nome <span class="text-danger">*</span></label>
                <TextInput
                  v-model="form.name"
                  placeholder="Ex: Almoço Rústico"
                  maxlength="60"
                />
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label">Aplicar a</label>
                <SelectInput v-model="form.storeId">
                  <option :value="null">Todas as lojas</option>
                  <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.name }}</option>
                </SelectInput>
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label">Paleta de cores</label>
                <TextInput
                  v-model="form.palette"
                  placeholder="tons quentes, dourado, madeira escura"
                  maxlength="200"
                />
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label">Mood / atmosfera</label>
                <TextInput
                  v-model="form.mood"
                  placeholder="aconchegante, caseiro"
                  maxlength="200"
                />
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label">Superfície</label>
                <TextInput
                  v-model="form.surface"
                  placeholder="balcão de madeira escura"
                  maxlength="200"
                />
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label">Iluminação</label>
                <TextInput
                  v-model="form.lighting"
                  placeholder="luz amarela quente, pendente tungstênio"
                  maxlength="200"
                />
              </div>
              <div class="col-12">
                <label class="form-label">Props / objetos</label>
                <TextInput
                  v-model="form.props"
                  placeholder="tábua de madeira, papel kraft, cerveja artesanal"
                  maxlength="300"
                />
              </div>
              <div class="col-12">
                <div class="form-check">
                  <input
                    id="theme-default"
                    v-model="form.isDefault"
                    class="form-check-input"
                    type="checkbox"
                  />
                  <label class="form-check-label" for="theme-default">
                    Marcar como padrão da empresa
                  </label>
                </div>
                <div class="small text-muted">
                  Quando ativado, este vira o tema padrão usado quando nenhum outro se aplica.
                </div>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-outline-secondary" @click="closeModal">Cancelar</button>
            <button class="btn btn-primary" :disabled="saving" @click="save">
              <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
              {{ saving ? 'Salvando...' : 'Salvar' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../api'
import TextInput from '../components/form/input/TextInput.vue'
import SelectInput from '../components/form/select/SelectInput.vue'

const themes = ref([])
const stores = ref([])
const loading = ref(false)
const modalOpen = ref(false)
const editing = ref(null)
const saving = ref(false)
const error = ref('')

const emptyForm = () => ({
  name: '',
  palette: '',
  mood: '',
  props: '',
  surface: '',
  lighting: '',
  isDefault: false,
  storeId: null,
})

const form = ref(emptyForm())

async function load() {
  loading.value = true
  try {
    const [tr, sr] = await Promise.all([api.get('/brand-themes'), api.get('/stores')])
    themes.value = Array.isArray(tr.data) ? tr.data : tr.data?.items || []
    stores.value = Array.isArray(sr.data) ? sr.data : sr.data?.items || []
  } catch (e) {
    console.error('Failed to load brand themes', e)
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = null
  error.value = ''
  form.value = emptyForm()
  modalOpen.value = true
}

function openEdit(t) {
  editing.value = t
  error.value = ''
  form.value = {
    name: t.name || '',
    palette: t.palette || '',
    mood: t.mood || '',
    props: t.props || '',
    surface: t.surface || '',
    lighting: t.lighting || '',
    isDefault: !!t.isDefault,
    storeId: t.storeId || null,
  }
  modalOpen.value = true
}

function closeModal() {
  modalOpen.value = false
  editing.value = null
  error.value = ''
}

function validate() {
  if (!form.value.name || !form.value.name.trim()) return 'Nome é obrigatório.'
  const visualKeys = ['palette', 'mood', 'props', 'surface', 'lighting']
  const hasVisual = visualKeys.some(
    (k) => form.value[k] && String(form.value[k]).trim()
  )
  if (!hasVisual) return 'Preencha pelo menos um campo visual.'
  return null
}

async function save() {
  const err = validate()
  if (err) {
    error.value = err
    return
  }
  saving.value = true
  error.value = ''
  try {
    const payload = { ...form.value }
    // Normalize empty strings to null so backend doesn't store blanks
    for (const k of ['palette', 'mood', 'props', 'surface', 'lighting']) {
      if (typeof payload[k] === 'string' && !payload[k].trim()) payload[k] = null
    }
    if (editing.value) {
      await api.patch(`/brand-themes/${editing.value.id}`, payload)
    } else {
      await api.post('/brand-themes', payload)
    }
    closeModal()
    await load()
  } catch (e) {
    error.value = e?.response?.data?.message || 'Falha ao salvar tema.'
  } finally {
    saving.value = false
  }
}

async function confirmDelete(t) {
  const ok = confirm(
    `Excluir o tema "${t.name}"? Imagens geradas com esse tema mantêm o snapshot, mas o tema some da lista.`
  )
  if (!ok) return
  try {
    await api.delete(`/brand-themes/${t.id}`)
    await load()
  } catch (e) {
    alert(e?.response?.data?.message || 'Falha ao excluir tema.')
  }
}

onMounted(load)
</script>
