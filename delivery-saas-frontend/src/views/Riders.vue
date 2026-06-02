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
const togglingActive = ref({}) // id -> bool, evita doubleclick no switch

// filters & pagination (CouponsList pattern)
// filterActive padrão "Ativos" (true) — empresas com motoboys terceirizados
// têm listas muito grandes, e o operador 99% do tempo quer ver só ativos.
// O valor é persistido em localStorage pra sobreviver entre navegações.
const FILTER_STORAGE_KEY = 'riders.filterActive'
function loadInitialFilter() {
  try {
    const saved = localStorage.getItem(FILTER_STORAGE_KEY)
    if (saved === 'true' || saved === 'false' || saved === '') return saved
  } catch (_) { /* ignore */ }
  return 'true'
}
const q = ref('')
const filterActive = ref(loadInitialFilter())
const limit = ref(20)
const offset = ref(0)
const total = ref(0)

const isAdmin = true // TODO: replace with real auth check

const load = async () => {
  loading.value = true
  error.value = ''
  try{
    // Sempre busca incluindo inativos — o filtro é aplicado no client,
    // permitindo trocar entre Ativos/Inativos/Todos sem novo fetch.
    await store.fetch({ includeInactive: true, force: true })
    let list = store.riders || []
    if(q.value) list = list.filter(r => (r.name||'').toLowerCase().includes(q.value.toLowerCase()) || (r.whatsapp||'').includes(q.value))
    if(filterActive.value !== '') list = list.filter(r => String(!!r.active) === String(filterActive.value))
    total.value = list.length
    // fetch balances for displayed riders (all for now)
    for (const r of store.riders) {
      try { const { data } = await api.get(`/riders/${r.id}/account`); balances.value[r.id] = data.balance } catch(e){ balances.value[r.id] = 0 }
    }
  }catch(e){ console.error(e); error.value = 'Falha ao carregar entregadores' }
  finally{ loading.value = false }
}

// Persiste a mudança do filtro sem precisar refetch (lista já tem inativos).
function onFilterActiveChange() {
  try { localStorage.setItem(FILTER_STORAGE_KEY, filterActive.value) } catch (_) { /* ignore */ }
  offset.value = 0
}

// Toggle active sem sair da página. Atualiza otimisticamente; em erro reverte.
async function toggleActive(r) {
  if (togglingActive.value[r.id]) return
  const newActive = !r.active
  // Confirmação só ao desativar (ativar é trivial).
  if (!newActive) {
    const res = await Swal.fire({
      title: 'Desativar entregador?',
      text: `${r.name} não aparecerá mais nas listas de despacho. Você pode reativar a qualquer momento.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Desativar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#dc3545',
    })
    if (!res.isConfirmed) return
  }
  togglingActive.value[r.id] = true
  const prev = r.active
  r.active = newActive // otimista
  try {
    await api.patch(`/riders/${r.id}`, { active: newActive })
  } catch (e) {
    console.error(e)
    r.active = prev // reverte
    Swal.fire({ icon: 'error', text: e.response?.data?.message || 'Erro ao alterar status' })
  } finally {
    togglingActive.value[r.id] = false
  }
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

const resetFilters = () => {
  q.value = ''
  filterActive.value = 'true' // volta ao default (só Ativos)
  try { localStorage.setItem(FILTER_STORAGE_KEY, 'true') } catch (_) {}
  offset.value = 0
}
const nextPage = () => { if(offset.value + limit.value < total.value) { offset.value += limit.value } }
const prevPage = () => { offset.value = Math.max(0, offset.value - limit.value) }

const displayed = computed(() => {
  let list = store.riders || []
  if(q.value) list = list.filter(r => (r.name||'').toLowerCase().includes(q.value.toLowerCase()) || (r.whatsapp||'').includes(q.value))
  if(filterActive.value !== '') list = list.filter(r => String(!!r.active) === String(filterActive.value))
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
          <SelectInput class="form-select" v-model="filterActive" @change="onFilterActiveChange">
            <option value="true">Apenas ativos</option>
            <option value="false">Apenas inativos</option>
            <option value="">Todos</option>
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
                <th class="text-center" style="width:80px">Ativo</th>
                <th class="text-end" style="width:160px">Ações</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in displayed" :key="r.id" :class="{ 'text-muted': !r.active }">
                <td>
                  <div>
                    <strong>{{ r.name }}</strong>
                    <span v-if="!r.active" class="badge bg-secondary ms-2">Inativo</span>
                  </div>
                  <div class="desc small text-muted">{{ r.email || '' }}</div>
                </td>
                <td>{{ r.whatsapp || '-' }}</td>
                <td>R$ {{ formatBalance(r.id) }}</td>
                <td class="text-center">
                  <div class="form-check form-switch d-flex justify-content-center m-0">
                    <input
                      type="checkbox"
                      class="form-check-input"
                      role="switch"
                      :checked="r.active"
                      :disabled="!!togglingActive[r.id]"
                      @change="toggleActive(r)"
                      :title="r.active ? 'Desativar entregador' : 'Ativar entregador'"
                    />
                  </div>
                </td>
                <td class="text-end">
                  <div class="btn-group btn-group-sm" role="group">
                    <button class="btn btn-outline-secondary" @click="goAccount(r.id)" title="Conta / Extrato">
                      <i class="bi bi-wallet2"></i>
                    </button>
                    <button class="btn btn-outline-primary" @click="goEdit(r.id)" title="Editar entregador">
                      <i class="bi bi-pencil-square"></i>
                    </button>
                    <button class="btn btn-outline-warning" v-if="isAdmin" @click="resetPassword(r)" title="Resetar senha">
                      <i class="bi bi-key"></i>
                    </button>
                    <button class="btn btn-outline-danger" v-if="isAdmin" @click="remove(r)" title="Remover entregador">
                      <i class="bi bi-trash"></i>
                    </button>
                  </div>
                </td>
              </tr>
              <tr v-if="total === 0">
                <td colspan="5" class="text-center text-secondary py-4">Nenhum entregador encontrado.</td>
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