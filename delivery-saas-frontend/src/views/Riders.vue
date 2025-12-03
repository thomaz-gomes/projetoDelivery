<script setup>
import { onMounted, ref, computed } from 'vue';
import { useRidersStore } from '../stores/riders';
import { useRouter } from 'vue-router';
import api from '../api';
import ListCard from '../components/ListCard.vue';
import Swal from 'sweetalert2'
import { formatAmount } from '../utils/formatters.js';

const store = useRidersStore();
const router = useRouter();

const loading = ref(false)
const error = ref('')
const balances = ref({})

// filters & pagination (CouponsList pattern)
const q = ref('')
const filterActive = ref('')
const limit = ref(20)
const offset = ref(0)
const total = ref(0)

const isAdmin = true // TODO: replace with real auth check

const load = async () => {
  loading.value = true
  error.value = ''
  try{
    await store.fetch() // keep existing store fetching
    // compute total and reset pagination if needed
    let list = store.riders || []
    // apply simple client-side filters (name / whatsapp / active)
    if(q.value) list = list.filter(r => (r.name||'').toLowerCase().includes(q.value.toLowerCase()) || (r.whatsapp||'').includes(q.value))
    if(filterActive.value !== '') list = list.filter(r => String(!!r.isActive) === String(filterActive.value))
    total.value = list.length
    // fetch balances for displayed riders (all for now)
    for (const r of store.riders) {
      try { const { data } = await api.get(`/riders/${r.id}/account`); balances.value[r.id] = data.balance } catch(e){ balances.value[r.id] = 0 }
    }
  }catch(e){ console.error(e); error.value = 'Falha ao carregar entregadores' }
  finally{ loading.value = false }
}

function goNew(){ router.push('/riders/new') }
function goEdit(id){ router.push(`/riders/${id}`) }
function goAccount(id){ router.push(`/riders/${id}/account`) }

const remove = async (r) => {
  const res = await Swal.fire({ title: 'Remover entregador?', text: `Remover ${r.name}?`, icon: 'warning', showCancelButton: true, confirmButtonText: 'Remover', cancelButtonText: 'Cancelar' })
  if(!res.isConfirmed) return
  try{ await api.delete(`/riders/${r.id}`); await load(); Swal.fire({ icon:'success', text:'Entregador removido' }) }catch(e){ console.error(e); Swal.fire({ icon:'error', text: e.response?.data?.message || 'Erro ao remover' }) }
}

const resetPassword = async (r) => {
  const { value: pw } = await Swal.fire({
    title: `Resetar senha - ${r.name}`,
    input: 'text',
    inputLabel: 'Nova senha (deixe em branco para gerar automaticamente)',
    inputPlaceholder: 'Digite a nova senha ou deixe em branco',
    showCancelButton: true,
    confirmButtonText: 'Resetar',
    preConfirm: (v) => v
  });
  if (pw === undefined) return; // cancelled
  try {
    const body = (pw && pw.trim()) ? { password: pw.trim() } : {};
    const { data } = await api.post(`/riders/${r.id}/reset-password`, body);

    // data.wa contains the WhatsApp send result (or null/undefined)
    const wa = data && data.wa ? data.wa : null;

    function escapeHtml(s) {
      if (!s) return '';
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    if (!wa) {
      // password updated but no WA send attempted (no instance or phone)
      await Swal.fire({ icon: 'warning', title: 'Senha resetada', text: 'Senha atualizada, mas não foi possível enviar via WhatsApp (instância ou telefone indisponível).' });
    } else if (wa && wa.error) {
      await Swal.fire({ icon: 'warning', title: 'Senha resetada', html: `Senha atualizada. Falha ao enviar via WhatsApp:<br/><pre>${escapeHtml(wa.error)}</pre>` });
    } else {
      // success: show a compact summary of the WA response
      const pretty = typeof wa === 'string' ? escapeHtml(wa) : escapeHtml(JSON.stringify(wa, null, 2));
      await Swal.fire({ icon: 'success', title: 'Senha resetada e enviada', html: `Senha enviada via WhatsApp. Resposta:<br/><pre style="text-align:left;">${pretty}</pre>` });
    }
  } catch (e) {
    console.error(e);
    Swal.fire({ icon: 'error', text: e.response?.data?.message || 'Erro ao resetar senha' });
  }
}

const resetFilters = () => { q.value=''; filterActive.value=''; offset.value=0; load() }
const nextPage = () => { if(offset.value + limit.value < total.value) { offset.value += limit.value } }
const prevPage = () => { offset.value = Math.max(0, offset.value - limit.value) }

const displayed = computed(() => {
  let list = store.riders || []
  if(q.value) list = list.filter(r => (r.name||'').toLowerCase().includes(q.value.toLowerCase()) || (r.whatsapp||'').includes(q.value))
  if(filterActive.value !== '') list = list.filter(r => String(!!r.isActive) === String(filterActive.value))
  total.value = list.length
  return list.slice(offset.value, offset.value + limit.value)
})

onMounted(()=> load())

const formatBalance = (id) => {
  const v = balances.value[id] || 0
  return formatAmount(v)
}

</script>

<template>
  <ListCard title="Entregadores" icon="bi bi-bicycle" :subtitle="total ? `${total} itens` : ''">
    <template #actions>
      <button class="btn btn-primary" @click="goNew"><i class="bi bi-plus-lg me-1"></i> Novo entregador</button>
    </template>

    <template #filters>
      <div class="filters row g-2">
        <div class="col-md-4">
          <TextInput v-model="q" placeholder="Buscar nome ou WhatsApp..." inputClass="form-control" />
        </div>
        <div class="col-md-3">
          <SelectInput  class="form-select"  v-model="filterActive"  @change="load">
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
                <th>Nome</th>
                <th>WhatsApp</th>
                <th>Saldo</th>
                <th style="width:140px">Ações</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in displayed" :key="r.id">
                <td>
                  <div><strong>{{ r.name }}</strong></div>
                  <div class="desc small text-muted">{{ r.email || '' }}</div>
                </td>
                <td>{{ r.whatsapp || '-' }}</td>
                <td>R$ {{ formatBalance(r.id) }}</td>
                <td>
                  <div class="d-flex">
                    <button class="btn btn-sm btn-light me-2" @click="goAccount(r.id)">Conta</button>
                    <button class="btn btn-sm btn-outline-secondary me-2" @click="goEdit(r.id)"><i class="bi bi-pencil-square"></i></button>
                    <button class="btn btn-sm btn-outline-warning me-2" v-if="isAdmin" @click="resetPassword(r)">Reset Senha</button>
                    <button class="btn btn-sm btn-outline-danger" v-if="isAdmin" @click="remove(r)"><i class="bi bi-trash"></i></button>
                  </div>
                </td>
              </tr>
              <tr v-if="total === 0">
                <td colspan="4" class="text-center text-secondary py-4">Nenhum entregador encontrado.</td>
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