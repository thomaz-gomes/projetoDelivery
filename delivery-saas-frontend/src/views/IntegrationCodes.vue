<template>
  <div>
    <ListCard title="Códigos de Integração" icon="bi bi-upc-scan" :subtitle="subtitleText">
      <template #actions>
        <div class="d-flex align-items-center gap-2">
          <span class="small text-muted">Itens: <span class="badge bg-primary">{{ items.length }}</span></span>
          <span class="small text-muted">Opcionais: <span class="badge bg-secondary">{{ optionals.length }}</span></span>
        </div>
      </template>

      <template #filters>
        <div class="row g-2">
          <div class="col-md-4">
            <SelectInput v-model="menuFilter" :options="menuOptions" placeholder="Todos os cardápios" />
          </div>
          <div class="col-md-4">
            <TextInput v-model="search" placeholder="Buscar por nome..." />
          </div>
          <div class="col-md-4 d-flex align-items-start gap-2">
            <button class="btn btn-outline-secondary" @click="resetFilters">Limpar</button>
          </div>
        </div>
      </template>

      <template #default>
        <ul class="nav nav-tabs mb-4">
          <li class="nav-item">
            <a class="nav-link" :class="{ active: tab === 'items' }" href="#" @click.prevent="tab = 'items'">
              <i class="bi bi-box me-1"></i> Itens
            </a>
          </li>
          <li class="nav-item">
            <a class="nav-link" :class="{ active: tab === 'optionals' }" href="#" @click.prevent="tab = 'optionals'">
              <i class="bi bi-list-check me-1"></i> Opcionais
            </a>
          </li>
        </ul>

        <div v-if="loading" class="text-center py-4">Carregando...</div>
        <div v-else-if="error" class="alert alert-danger">{{ error }}</div>

        <!-- Items Tab -->
        <div v-else-if="tab === 'items'">
          <div v-if="filteredItems.length === 0" class="alert alert-info">Nenhum item encontrado</div>
          <div v-else class="table-responsive">
            <table class="table table-hover align-middle">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Cardápio</th>
                  <th>Categoria</th>
                  <th>Código de Integração</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in filteredItems" :key="item.id">
                  <td>
                    <span>{{ item.name }}</span>
                    <span v-if="!item.isActive" class="badge bg-light text-dark ms-2">Inativo</span>
                  </td>
                  <td>{{ item.menu?.name || '—' }}</td>
                  <td>{{ item.category?.name || '—' }}</td>
                  <td>
                    <template v-if="item.integrationCode">
                      <code class="integration-code">{{ item.integrationCode }}</code>
                      <button class="btn btn-sm btn-link p-0 ms-2" @click="copy(item.integrationCode)" title="Copiar">
                        <i class="bi bi-clipboard"></i>
                      </button>
                    </template>
                    <span v-else class="text-muted">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Optionals Tab -->
        <div v-else-if="tab === 'optionals'">
          <div v-if="filteredOptionals.length === 0" class="alert alert-info">Nenhum opcional encontrado</div>
          <div v-else class="table-responsive">
            <table class="table table-hover align-middle">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Grupo</th>
                  <th>Código Genérico</th>
                  <th>Produtos Associados</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="opt in filteredOptionals" :key="opt.id">
                  <td>
                    <span>{{ opt.name }}</span>
                    <span v-if="!opt.isAvailable" class="badge bg-light text-dark ms-2">Indisponível</span>
                  </td>
                  <td>{{ opt.group?.name || '—' }}</td>
                  <td>
                    <template v-if="opt.integrationCode">
                      <code class="integration-code">{{ opt.integrationCode }}</code>
                      <button class="btn btn-sm btn-link p-0 ms-2" @click="copy(opt.integrationCode)" title="Copiar">
                        <i class="bi bi-clipboard"></i>
                      </button>
                    </template>
                    <span v-else class="text-muted">—</span>
                  </td>
                  <td>
                    <div v-if="opt.associatedProducts && opt.associatedProducts.length > 0">
                      <div v-for="p in opt.associatedProducts" :key="p.id" class="mb-1">
                        <span class="small">{{ p.name }}</span>
                        <code v-if="p.specificCode" class="integration-code integration-code--dark ms-1">{{ p.specificCode }}</code>
                        <button v-if="p.specificCode" class="btn btn-sm btn-link p-0 ms-1" @click="copy(p.specificCode)" title="Copiar código específico">
                          <i class="bi bi-clipboard"></i>
                        </button>
                      </div>
                    </div>
                    <span v-else class="text-muted small">Nenhum</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>
    </ListCard>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import api from '../api'
import ListCard from '@/components/ListCard.vue'
import TextInput from '@/components/form/input/TextInput.vue'
import SelectInput from '@/components/form/select/SelectInput.vue'
import { bindLoading } from '../state/globalLoading.js'
import Swal from 'sweetalert2'

const loading = ref(false)
bindLoading(loading)
const error = ref('')

const tab = ref('items')
const search = ref('')
const menuFilter = ref('')

const menus = ref([])
const items = ref([])
const optionals = ref([])

const menuOptions = computed(() => {
  return [
    { value: '', label: 'Todos os cardápios' },
    ...menus.value.map(m => ({ value: m.id, label: m.name }))
  ]
})

const subtitleText = computed(() => {
  const total = items.value.length + optionals.value.length
  return total ? `${total} registros` : ''
})

const filteredItems = computed(() => {
  const q = (search.value || '').toLowerCase().trim()
  if (!q) return items.value
  return items.value.filter(i => (i.name || '').toLowerCase().includes(q))
})

const filteredOptionals = computed(() => {
  const q = (search.value || '').toLowerCase().trim()
  if (!q) return optionals.value
  return optionals.value.filter(o => (o.name || '').toLowerCase().includes(q))
})

let loadDebounce = null
watch([menuFilter], () => {
  clearTimeout(loadDebounce)
  loadDebounce = setTimeout(() => loadData(), 200)
})

async function loadData() {
  loading.value = true
  error.value = ''
  try {
    const params = {}
    if (menuFilter.value) params.menuId = menuFilter.value

    const [itemsRes, optionalsRes] = await Promise.all([
      api.get('/menu/integration/items', { params }),
      api.get('/menu/integration/optionals', { params })
    ])
    items.value = itemsRes.data || []
    optionals.value = optionalsRes.data || []
  } catch (e) {
    console.error(e)
    error.value = e.response?.data?.message || 'Erro ao carregar dados'
  } finally {
    loading.value = false
  }
}

async function loadMenus() {
  try {
    const res = await api.get('/menu/menus')
    menus.value = res.data || []
  } catch (e) {
    console.error('Error loading menus', e)
  }
}

function copy(text) {
  if (!text) return
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
    } else {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    Swal.fire({ toast: true, position: 'top-end', showConfirmButton: false, timer: 1200, icon: 'success', title: 'Copiado!' })
  } catch (e) {
    console.error('copy failed', e)
  }
}

function resetFilters() {
  search.value = ''
  menuFilter.value = ''
  loadData()
}

onMounted(() => {
  loadMenus()
  loadData()
})
</script>

<style scoped>
.integration-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, 'Roboto Mono', 'Courier New', monospace;
  font-size: 0.85rem;
  background: var(--bg-input, #f8f9fa);
  color: var(--primary, #105784);
  padding: 0.2em 0.55em;
  border-radius: var(--border-radius-sm, 0.625rem);
  border: 1px solid var(--border-color, #e6e6e6);
  white-space: nowrap;
}
.integration-code--dark {
  background: #2b2d31;
  color: #e9ecef;
  border-color: #2b2d31;
}
</style>
