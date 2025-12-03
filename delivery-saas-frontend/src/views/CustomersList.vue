<script setup>
import { ref, onMounted, computed } from 'vue';
import { useCustomersStore } from '../stores/customers';
import { useRouter } from 'vue-router';
import BaseButton from '../components/BaseButton.vue';
import ListCard from '../components/ListCard.vue';
import Swal from 'sweetalert2'

const store = useCustomersStore();
const router = useRouter();

const q = ref('');
const error = ref('');
const loading = ref(false)

const limit = ref(20)
const offset = ref(0)
const total = ref(0)

const isAdmin = true

const load = async () => {
  loading.value = true
  error.value = ''
  try{
    const token = localStorage.getItem('token')
    if(!token){ router.push({ path: '/login', query: { redirect: '/customers' } }); return }
    await store.fetch()
    // compute total after optional client filtering
    let list = store.list || []
    if(q.value) list = list.filter(c => (c.fullName||'').toLowerCase().includes(q.value.toLowerCase()) || (c.whatsapp||'').includes(q.value) || (c.cpf||'').includes(q.value))
    total.value = list.length
  }catch(e){ console.error('Failed to fetch customers', e); error.value = e?.response?.data?.message || 'Falha ao carregar clientes' }
  finally{ loading.value = false }
}

onMounted(()=> load())

function search(){ load() }
function goNew(){ router.push('/customers/new') }
function goProfile(id){ router.push(`/customers/${id}`) }

async function onImport(e){
  const file = e.target.files?.[0]
  if(!file) return
  try{
    const res = await store.importFile(file)
    await load()
    Swal.fire({ icon:'success', text: `Importação: criados ${res.created}, atualizados ${res.updated}.` })
  }catch(e){ console.error(e); Swal.fire({ icon:'error', text: 'Falha ao importar' }) }
}

const resetFilters = () => { q.value=''; offset.value=0; load() }
const nextPage = () => { if(offset.value + limit.value < total.value) offset.value += limit.value }
const prevPage = () => { offset.value = Math.max(0, offset.value - limit.value) }

const displayed = computed(()=>{
  let list = store.list || []
  if(q.value) list = list.filter(c => (c.fullName||'').toLowerCase().includes(q.value.toLowerCase()) || (c.whatsapp||'').includes(q.value) || (c.cpf||'').includes(q.value))
  total.value = list.length
  return list.slice(offset.value, offset.value + limit.value)
})

function editCustomer(id){ router.push(`/customers/${id}/edit`) }

</script>

<template>
  <ListCard :title="`Clientes (${total || store.list.length})`" icon="bi bi-people" :subtitle="total ? `${total} itens` : ''">
    <template #actions>
      <div class="d-flex align-items-center gap-2">
        <label class="btn btn-outline-secondary btn-sm mb-0">
          Importar
          <input type="file" accept=".csv,.xlsx,.xls" class="d-none" @change="onImport" />
        </label>

        <button class="btn btn-primary" @click="goNew"><i class="bi bi-plus-lg me-1"></i> Novo</button>
      </div>
    </template>

    <template #filters>
      <div class="filters row g-2">
        <div class="col-md-6">
          <TextInput v-model="q" placeholder="Buscar por nome, CPF, WhatsApp" inputClass="form-control" />
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
                <th>Nome</th>
                <th>CPF</th>
                <th>WhatsApp</th>
                <th>Endereço</th>
                <th>Pedidos</th>
                <th style="width:140px">Ações</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in displayed" :key="c.id">
                <td>
                  <div><strong>{{ c.fullName }}</strong></div>
                  <div class="desc small text-muted">{{ c.email || '' }}</div>
                </td>
                <td>{{ c.cpf || '—' }}</td>
                <td>{{ c.whatsapp || c.phone || '—' }}</td>
                <td>
                  <div class="small text-dark">{{ c.addresses?.[0]?.formatted || [c.addresses?.[0]?.street, c.addresses?.[0]?.number].filter(Boolean).join(', ') || '—' }}</div>
                </td>
                <td>{{ c.orders?.length || 0 }}</td>
                <td>
                  <div class="d-flex">
                    <button class="btn btn-sm btn-light me-2" @click="goProfile(c.id)">Perfil</button>
                    <button class="btn btn-sm btn-outline-secondary me-2" @click="editCustomer(c.id)"><i class="bi bi-pencil-square"></i></button>
                  </div>
                </td>
              </tr>
              <tr v-if="total === 0">
                <td colspan="6" class="text-center text-secondary py-4">Nenhum cliente encontrado.</td>
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
