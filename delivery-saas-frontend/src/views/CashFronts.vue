<template>
  <div class="p-3">
    <div v-if="loading" class="text-center py-4">Carregando...</div>
    <div v-else>
      <div v-if="!sessions.length" class="text-muted">Nenhuma sessão encontrada.</div>
      <div v-else>
        <ListCard title="Frentes de Caixa" icon="bi bi-cash-stack" :subtitle="`${sessions.length} sessões`">
          <template #default>
            <div class="table-responsive">
              <table class="table table-sm table-hover">
                <thead>
                  <tr>
                    <th>Abertura</th>
                    <th>Fechamento</th>
                    <th class="text-end">Abertura (R$)</th>
                    <th class="text-end">Saldo registrado (R$)</th>
                    <th class="text-end">Retiradas</th>
                    <th class="text-end">Reforços</th>
                    <th class="text-end">Diferença</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="s in sessions" :key="s.id">
                    <td>{{ formatDate(s.openedAt) }}</td>
                    <td>{{ s.closedAt ? formatDate(s.closedAt) : '—' }}</td>
                    <td class="text-end">{{ formatCurrency(Number(s.openingAmount || 0)) }}</td>
                    <td class="text-end">{{ formatCurrency(Number(s.currentBalance || s.balance || 0)) }}</td>
                    <td class="text-end">{{ formatCurrency(Number(s.summary?.totalWithdrawals || totalWithdrawalsFor(s))) }}</td>
                    <td class="text-end">{{ formatCurrency(Number(s.summary?.totalReinforcements || totalReinforcementsFor(s))) }}</td>
                    <td class="text-end">
                      <span v-if="s.differences" :class="totalDiffClass(s.differences)">
                        {{ formatCurrency(totalDiff(s.differences)) }}
                      </span>
                      <span v-else class="text-muted">—</span>
                    </td>
                    <td class="text-end">
                      <button class="btn btn-sm btn-outline-secondary" @click="openDetail(s)">
                        Mais detalhes
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </ListCard>
      </div>
    </div>
  </div>

  <!-- Session Detail Modal -->
  <CashSessionDetailModal
    :visible="!!selectedSession"
    :session="selectedSession || {}"
    :users-map="usersMap"
    @close="selectedSession = null"
    @edit="selectedSession = null"
    @save="onSave"
    @close-session="onCloseSession"
    @add-movement="onAddMovement"
  />
</template>

<script setup>
import { ref, onMounted } from 'vue';
import api from '../api';
import Swal from 'sweetalert2';
import { formatCurrency } from '../utils/formatters.js';
import ListCard from '../components/ListCard.vue';
import CashSessionDetailModal from '../components/CashSessionDetailModal.vue';
import CurrencyInput from '../components/form/input/CurrencyInput.vue';
import { createApp } from 'vue';

const sessions = ref([]);
const loading = ref(false);
const usersMap = ref({});
const selectedSession = ref(null);

function formatDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return String(d); }
}

function totalWithdrawalsFor(s) {
  return (s.movements || []).filter(x => String(x.type||'').toUpperCase() === 'WITHDRAWAL').reduce((a,b)=>a+Number(b.amount||0),0);
}
function totalReinforcementsFor(s) {
  return (s.movements || []).filter(x => String(x.type||'').toUpperCase() === 'REINFORCEMENT').reduce((a,b)=>a+Number(b.amount||0),0);
}
function totalDiff(differences) {
  if (!differences) return 0;
  return Object.values(differences).reduce((sum, v) => sum + Number(v || 0), 0);
}
function totalDiffClass(differences) {
  const d = totalDiff(differences);
  if (Math.abs(d) < 0.01) return 'text-success fw-semibold';
  return d > 0 ? 'text-primary fw-semibold' : 'text-danger fw-semibold';
}

function openDetail(s) {
  selectedSession.value = s;
}

async function onSave({ declaredValues, closingNote }) {
  // Edit declared values on a closed session
  try {
    await api.patch(`/cash/sessions/${selectedSession.value.id}`, { declaredValues, closingNote });
    await reload();
    selectedSession.value = null;
    Swal.fire({ icon: 'success', title: 'Salvo', timer: 1200, showConfirmButton: false });
  } catch (e) {
    Swal.fire('Erro', e.response?.data?.message || 'Falha ao salvar', 'error');
  }
}

async function onCloseSession({ declaredValues, closingNote }) {
  const confirm = await Swal.fire({
    title: 'Fechar frente de caixa?',
    text: 'Esta ação não pode ser desfeita.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Fechar',
    confirmButtonColor: '#dc3545',
  });
  if (!confirm.isConfirmed) return;
  try {
    await api.post('/cash/close/finalize', { declaredValues, closingNote });
    await reload();
    selectedSession.value = null;
    Swal.fire({ icon: 'success', title: 'Caixa fechado!', timer: 1500, showConfirmButton: false });
  } catch (e) {
    Swal.fire('Erro', e.response?.data?.message || 'Falha ao fechar caixa', 'error');
  }
}

async function onAddMovement(type) {
  const mountId = 'mv-app-' + Date.now();
  const result = await Swal.fire({
    title: type === 'withdrawal' ? 'Incluir Retirada' : 'Incluir Reforço',
    html: `<div id="${mountId}"></div>`,
    showCancelButton: true,
    confirmButtonText: 'Confirmar',
    didOpen: () => {
      const el = document.getElementById(mountId);
      const IncRoot = {
        components: { CurrencyInput },
        template: `<div style="display:flex;flex-direction:column;gap:8px"><currency-input v-model="amount" /><input v-model="note" class="swal2-input" placeholder="Descrição (opcional)"></div>`,
        data() { return { amount: null, note: '' }; },
      };
      const app = createApp(IncRoot);
      app.component('currency-input', CurrencyInput);
      const proxy = app.mount(el);
      el.__app = { app, proxy };
    },
    preConfirm: () => {
      const el = document.getElementById(mountId);
      const state = el?.__app?.proxy;
      if (!state || state.amount == null || isNaN(Number(state.amount))) {
        Swal.showValidationMessage('Informe um valor numérico válido');
        return false;
      }
      return { amount: Number(state.amount), note: state.note || '' };
    },
    willClose: () => {
      const el = document.getElementById(mountId);
      if (el?.__app) { try { el.__app.app.unmount(); } catch {} }
    },
  });

  if (!result.isConfirmed || !result.value) return;
  try {
    const { data } = await api.post('/cash/movement', { type, amount: result.value.amount, note: result.value.note });
    if (data?.session) {
      const idx = sessions.value.findIndex(x => x.id === data.session.id);
      if (idx >= 0) sessions.value.splice(idx, 1, data.session);
      // refresh detail
      selectedSession.value = sessions.value.find(x => x.id === data.session.id) || selectedSession.value;
    }
    Swal.fire({ icon: 'success', title: 'Movimento registrado', timer: 1200, showConfirmButton: false });
  } catch (e) {
    Swal.fire('Erro', e.response?.data?.message || 'Falha ao registrar movimento', 'error');
  }
}

async function reload() {
  const { data } = await api.get('/cash/sessions');
  sessions.value = Array.isArray(data) ? data : [];
}

onMounted(async () => {
  loading.value = true;
  try {
    await reload();
    try {
      const { data: users } = await api.get('/users');
      if (Array.isArray(users)) {
        const m = {};
        users.forEach(u => { if (u?.id) m[u.id] = u.name || u.email || u.id; });
        usersMap.value = m;
      }
    } catch {}
  } catch (e) { console.error('Failed to fetch cash sessions', e); }
  finally { loading.value = false; }
});
</script>
