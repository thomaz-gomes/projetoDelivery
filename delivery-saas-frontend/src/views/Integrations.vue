<script setup>
import { onMounted, ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import api from '../api';
import ListCard from '../components/ListCard.vue';
import Swal from 'sweetalert2'

const router = useRouter();

const loading = ref(false)
const error = ref('')

// filters & pagination
const q = ref('')
const filterEnabled = ref('')
const limit = ref(20)
const offset = ref(0)
const total = ref(0)

const integrations = ref([])
const stores = ref([])

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [{ data: ints }, { data: sts }] = await Promise.all([
      api.get('/integrations'),
      api.get('/stores')
    ])
    integrations.value = ints || []
    stores.value = sts || []
    total.value = integrations.value.length
  } catch (e) {
    console.error(e);
    error.value = 'Falha ao carregar integrações';
  } finally {
    loading.value = false
  }
}

function goNew(){ router.push('/integrations/new') }
function goEdit(id){ router.push(`/integrations/${id}`) }

const remove = async (it) => {
  const res = await Swal.fire({ title: 'Remover integração?', text: `Remover ${it.provider} vinculado à loja ${storeName(it.storeId)}?`, icon: 'warning', showCancelButton: true, confirmButtonText: 'Remover', cancelButtonText: 'Cancelar' })
  if(!res.isConfirmed) return
  try{ await api.delete(`/integrations/${it.id}`); await load(); Swal.fire({ icon:'success', text:'Integração removida' }) }catch(e){ console.error(e); Swal.fire({ icon:'error', text: e.response?.data?.message || 'Erro ao remover' }) }
}

const resetFilters = () => { q.value=''; filterEnabled.value=''; offset.value=0; load() }
const nextPage = () => { if(offset.value + limit.value < total.value) { offset.value += limit.value } }
const prevPage = () => { offset.value = Math.max(0, offset.value - limit.value) }

const displayed = computed(() => {
  let list = integrations.value || []
  if(q.value) list = list.filter(i => (i.provider||'').toLowerCase().includes(q.value.toLowerCase()) || (storeName(i.storeId)||'').toLowerCase().includes(q.value.toLowerCase()))
  if(filterEnabled.value !== '') list = list.filter(i => String(!!i.enabled) === String(filterEnabled.value))
  total.value = list.length
  return list.slice(offset.value, offset.value + limit.value)
})

function storeName(id){
  if(!id) return '-'
  const s = stores.value.find(x => x.id === id)
  return s ? s.name : id
}

onMounted(()=> load())

</script>

<template>
  <ListCard title="Integrações" icon="bi bi-plug" :subtitle="total ? `${total} itens` : ''">
    <template #actions>
      <button class="btn btn-primary" @click="goNew"><i class="bi bi-plus-lg me-1"></i> Nova integração</button>
    </template>

    <template #filters>
      <div class="filters row g-2">
        <div class="col-md-4">
          <TextInput v-model="q" placeholder="Buscar provider ou loja..." inputClass="form-control" />
        </div>
        <div class="col-md-3">
          <SelectInput  class="form-select"  v-model="filterEnabled"  @change="load">
            <option value="">Todos</option>
            <option value="true">Ativos</option>
            <option value="false">Inativos</option>
          </SelectInput>
        </div>
        <div class="col-md-2 d-flex align-items-center">
          <button class="btn btn-outline-secondary w-100" @click="resetFilters">Limpar</button>
        </div>
      </div>
    </template>

    <template #default>
      <div v-if="loading" class="text-center py-4">Carregando...</div>
      <div v-else-if="error" class="alert alert-danger">{{ error }}</div>
      <div v-else>
        <div class="table-responsive">
          <table class="table table-striped align-middle">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Loja</th>
                <th>Ativo</th>
                <th>Criado</th>
                <th style="width:160px">Ações</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="it in displayed" :key="it.id">
                <td>
                  <div><strong>{{ it.provider }}</strong></div>
                  <div class="desc small text-muted">ClientId: {{ it.clientId ? '●●●' : '-' }}</div>
                </td>
                <td>{{ storeName(it.storeId) }}</td>
                <td>{{ it.enabled ? 'Sim' : 'Não' }}</td>
                <td>{{ it.createdAt ? new Date(it.createdAt).toLocaleString() : '-' }}</td>
                <td>
                  <div class="d-flex">
                    <button class="btn btn-sm btn-outline-secondary me-2" @click="goEdit(it.id)"><i class="bi bi-pencil-square"></i></button>
                    <button class="btn btn-sm btn-outline-danger" @click="remove(it)"><i class="bi bi-trash"></i></button>
                  </div>
                </td>
              </tr>
              <tr v-if="total === 0">
                <td colspan="5" class="text-center text-secondary py-4">Nenhuma integração encontrada.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="d-flex align-items-center justify-content-between mt-3">
          <div>
            <small>Mostrando {{ offset + 1 }} - {{ Math.min(offset + limit, total) }} de {{ total }}</small>
          </div>
          <div>
            <button class="btn btn-sm btn-outline-secondary me-2" @click="prevPage" :disabled="offset===0">Anterior</button>
            <button class="btn btn-sm btn-secondary" @click="nextPage" :disabled="offset+limit >= total">Próxima</button>
          </div>
        </div>
      </div>
    </template>
  </ListCard>
</template>
