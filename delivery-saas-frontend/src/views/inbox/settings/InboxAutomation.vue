<template>
  <div class="container py-4" style="max-width: 800px;">
    <h4 class="mb-4">Automações do Inbox</h4>

    <!-- Tabs -->
    <ul class="nav nav-tabs mb-4">
      <li class="nav-item">
        <button
          class="nav-link"
          :class="{ active: tab === 'automations' }"
          @click="tab = 'automations'"
        >
          <i class="bi bi-robot me-1"></i>Automações de chat
        </button>
      </li>
      <li class="nav-item">
        <button
          class="nav-link"
          :class="{ active: tab === 'templates' }"
          @click="tab = 'templates'"
        >
          <i class="bi bi-bell me-1"></i>Notificações de pedido
        </button>
      </li>
    </ul>

    <!-- ── Automações de chat ──────────────────────────────────────── -->
    <div v-if="tab === 'automations'">
      <div class="mb-4">
        <label class="form-label">Cardápio</label>
        <SelectInput
          v-model="selectedMenuId"
          :options="menuOptions"
          optionValueKey="value"
          optionLabelKey="label"
          placeholder="Selecione um cardápio"
          @update:modelValue="loadMenu"
        />
      </div>

      <div v-if="selectedMenuId && currentMenu">
        <!-- Out-of-hours -->
        <div class="card mb-3">
          <div class="card-body">
            <h6 class="card-title"><i class="bi bi-moon me-1"></i>Auto-resposta fora do horário</h6>
            <p class="small text-muted mb-2">Disparada quando o cliente envia mensagem fora do horário de funcionamento da loja.</p>
            <div class="mb-3">
              <label class="form-label">Resposta rápida</label>
              <SelectInput
                v-model="form.outOfHoursReplyId"
                :options="quickReplyOptions"
                optionValueKey="value"
                optionLabelKey="label"
                placeholder="— Desabilitado —"
              />
            </div>
            <div v-if="outOfHoursPreview" class="small bg-light rounded p-2 mb-3">
              <strong class="d-block mb-1">Preview:</strong>
              <span style="white-space: pre-wrap;">{{ outOfHoursPreview }}</span>
            </div>
            <BaseButton variant="primary" size="sm" :loading="saving" @click="saveOutOfHours">
              Salvar
            </BaseButton>
          </div>
        </div>

        <!-- Greeting -->
        <div class="card mb-3">
          <div class="card-body">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <div>
                <h6 class="card-title mb-0"><i class="bi bi-emoji-smile me-1"></i>Saudação automática</h6>
                <p class="small text-muted mb-0">Disparada na primeira mensagem do cliente após 6 horas de inatividade.</p>
              </div>
              <BaseButton variant="outline-primary" size="sm" @click="openAddRule">
                <i class="bi bi-plus-lg me-1"></i>Adicionar
              </BaseButton>
            </div>

            <div v-if="!greetingRules.length" class="text-muted small py-2 text-center">
              Nenhuma regra de horário configurada.
            </div>

            <div v-for="rule in greetingRules" :key="rule.id" class="d-flex align-items-center gap-2 p-2 border rounded mb-2">
              <i class="bi bi-clock text-secondary"></i>
              <div class="flex-grow-1">
                <div class="fw-semibold small">{{ rule.label || rule.quickReply?.title }}</div>
                <div class="text-muted small">{{ rule.startTime }} – {{ rule.endTime }}</div>
              </div>
              <div class="small text-truncate" style="max-width: 160px;">{{ rule.quickReply?.body || '—' }}</div>
              <button class="btn btn-sm btn-outline-secondary" @click="openEditRule(rule)" title="Editar">
                <i class="bi bi-pencil"></i>
              </button>
              <button class="btn btn-sm btn-outline-danger" @click="deleteRule(rule)" title="Remover">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </div>
        </div>

        <!-- Rule modal -->
        <div v-if="showRuleForm" class="modal d-block" style="background:rgba(0,0,0,0.5);" @click.self="showRuleForm=false">
          <div class="modal-dialog">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title">{{ editingRuleId ? 'Editar' : 'Nova' }} regra de horário</h5>
                <button type="button" class="btn-close" @click="showRuleForm=false"></button>
              </div>
              <div class="modal-body d-flex flex-column gap-3">
                <div>
                  <label class="form-label">Rótulo <span class="text-muted small">(opcional)</span></label>
                  <input v-model="ruleForm.label" type="text" class="form-control" placeholder="Ex: Bom dia, Boa tarde..." />
                </div>
                <div class="row g-2">
                  <div class="col-6">
                    <label class="form-label">Início</label>
                    <input v-model="ruleForm.startTime" type="time" class="form-control" required />
                  </div>
                  <div class="col-6">
                    <label class="form-label">Fim</label>
                    <input v-model="ruleForm.endTime" type="time" class="form-control" required />
                  </div>
                </div>
                <div>
                  <label class="form-label">Mensagem (resposta rápida)</label>
                  <SelectInput
                    v-model="ruleForm.quickReplyId"
                    :options="quickReplyOptionsRequired"
                    optionValueKey="value"
                    optionLabelKey="label"
                    placeholder="Selecione..."
                  />
                </div>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" @click="showRuleForm=false">Cancelar</button>
                <BaseButton variant="primary" :loading="savingRule" @click="saveRule">Salvar</BaseButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Notificações de pedido ─────────────────────────────────── -->
    <div v-if="tab === 'templates'">
      <!-- Variable & formatting guide -->
      <div class="alert alert-info py-2 mb-3">
        <div class="fw-semibold mb-1"><i class="bi bi-info-circle me-1"></i>Variáveis disponíveis</div>
        <div class="d-flex flex-wrap gap-2" style="font-size: 0.82rem;">
          <code>{{nome}}</code> — nome do cliente &nbsp;
          <code>{{loja}}</code> — nome da loja &nbsp;
          <code>{{status}}</code> — status em português &nbsp;
          <code>{{pedido}}</code> — número do pedido &nbsp;
          <code>{{ganhou}}</code> — valor ganho de cashback &nbsp;
          <code>{{saldo}}</code> — saldo total de cashback
        </div>
      </div>
      <div class="alert alert-secondary py-2 mb-4" style="font-size: 0.82rem;">
        <i class="bi bi-whatsapp me-1 text-success"></i>
        <strong>Formatação WhatsApp:</strong>
        <span class="ms-2"><code>*negrito*</code></span>
        <span class="ms-2"><code>_itálico_</code></span>
        <span class="ms-2"><code>~riscado~</code></span>
        <span class="ms-2"><code>`monoespaçado`</code></span>
        <span class="ms-2 text-muted">— Deixe em branco para usar o template padrão.</span>
      </div>

      <div v-for="s in STATUSES" :key="s.key" class="card mb-3">
        <div class="card-body">
          <div class="d-flex align-items-center gap-2 mb-1">
            <i :class="`bi ${s.icon} text-secondary`"></i>
            <h6 class="mb-0">{{ s.label }}</h6>
          </div>
          <p class="small text-muted mb-2">{{ s.description }}</p>
          <textarea
            v-model="templates[s.key]"
            class="form-control font-monospace"
            :rows="6"
            :placeholder="DEFAULT_TEMPLATE"
            style="font-size: 0.82rem; resize: vertical; white-space: pre;"
          ></textarea>
          <div class="form-text">Deixe em branco para usar o template padrão.</div>
        </div>
      </div>

      <div class="d-flex justify-content-end mt-2">
        <BaseButton variant="primary" :loading="savingTemplates" @click="saveTemplates">
          <i class="bi bi-check-lg me-1"></i>Salvar templates
        </BaseButton>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import api from '@/api';
import { useInboxStore } from '@/stores/inbox';
import Swal from 'sweetalert2';
import SelectInput from '@/components/form/select/SelectInput.vue';
import BaseButton from '@/components/BaseButton.vue';

// ── Constants ──────────────────────────────────────────────────────────────

const STATUSES = [
  { key: 'EM_PREPARO',             label: 'Em Preparo',               icon: 'bi-fire',        description: 'Disparada quando o pedido começa a ser preparado.' },
  { key: 'SAIU_PARA_ENTREGA',      label: 'Saiu para Entrega',        icon: 'bi-bicycle',     description: 'Disparada quando o entregador sai com o pedido.' },
  { key: 'CONFIRMACAO_PAGAMENTO',  label: 'Confirmação de Pagamento', icon: 'bi-credit-card', description: 'Disparada quando o pagamento está sendo confirmado.' },
  { key: 'CONCLUIDO',              label: 'Concluído',                icon: 'bi-check-circle',description: 'Disparada quando o pedido é finalizado com sucesso.' },
  { key: 'CANCELADO',              label: 'Cancelado',                icon: 'bi-x-circle',    description: 'Disparada quando o pedido é cancelado.' },
  { key: 'CASHBACK_CREDIT',        label: 'Cashback recebido',        icon: 'bi-piggy-bank',  description: 'Enviada ao cliente quando seu saldo de cashback aumenta. Variáveis extras: {{ganhou}} e {{saldo}}.' },
];

const DEFAULT_TEMPLATE =
`Olá {{nome}}, aqui é o atendente virtual do *{{loja}}* 👋

*Seu pedido foi atualizado:* *{{status}}* 🎯

Fique tranquilo(a) que vou enviar as atualizações do status do seu pedido por aqui. 😄

*️⃣ Nº do pedido:* {{pedido}}`;

// ── Tab ───────────────────────────────────────────────────────────────────

const tab = ref('automations');

// ── Automações de chat ────────────────────────────────────────────────────

const inboxStore = useInboxStore();
const menus = ref([]);
const selectedMenuId = ref(null);
const currentMenu = ref(null);
const quickReplies = computed(() => inboxStore.quickReplies || []);
const saving = ref(false);

const menuOptions = computed(() =>
  menus.value.map(m => ({ value: m.id, label: m.name }))
);

const quickReplyOptions = computed(() =>
  [{ value: null, label: '— Desabilitado —' }, ...quickReplies.value.map(r => ({ value: r.id, label: r.title || r.shortcut }))]
);

const quickReplyOptionsRequired = computed(() =>
  quickReplies.value.map(r => ({ value: r.id, label: r.title || r.shortcut }))
);

const form = ref({ outOfHoursReplyId: null });

const greetingRules = ref([]);
const showRuleForm = ref(false);
const savingRule = ref(false);
const editingRuleId = ref(null);
const ruleForm = ref({ label: '', startTime: '', endTime: '', quickReplyId: null });

const outOfHoursPreview = computed(() => {
  const r = quickReplies.value.find(q => q.id === form.value.outOfHoursReplyId);
  return r?.body || '';
});

async function loadMenu(val) {
  selectedMenuId.value = val || null;
  if (!selectedMenuId.value) { currentMenu.value = null; greetingRules.value = []; return; }
  try {
    const { data } = await api.get(`/menu/menus/${selectedMenuId.value}`);
    currentMenu.value = data;
    form.value.outOfHoursReplyId = data.outOfHoursReplyId || null;
    await loadGreetingRules(selectedMenuId.value);
  } catch (e) {
    Swal.fire('Erro', 'Falha ao carregar cardápio', 'error');
  }
}

async function saveOutOfHours() {
  saving.value = true;
  try {
    await api.patch(`/menu/menus/${selectedMenuId.value}/inbox-automation`, { outOfHoursReplyId: form.value.outOfHoursReplyId || null });
    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Salvo!', showConfirmButton: false, timer: 1500 });
  } catch (e) {
    Swal.fire('Erro', e.response?.data?.message || 'Falha ao salvar', 'error');
  } finally { saving.value = false; }
}

// ── Greeting time rules ───────────────────────────────────────────────────

async function loadGreetingRules(menuId) {
  if (!menuId) { greetingRules.value = []; return; }
  try {
    const { data } = await api.get('/inbox/greeting-rules', { params: { menuId } });
    greetingRules.value = data;
  } catch (e) {
    console.error('Failed to load greeting rules', e);
  }
}

function openAddRule() {
  editingRuleId.value = null;
  ruleForm.value = { label: '', startTime: '', endTime: '', quickReplyId: null };
  showRuleForm.value = true;
}

function openEditRule(rule) {
  editingRuleId.value = rule.id;
  ruleForm.value = {
    label: rule.label || '',
    startTime: rule.startTime,
    endTime: rule.endTime,
    quickReplyId: rule.quickReplyId,
  };
  showRuleForm.value = true;
}

async function saveRule() {
  if (!ruleForm.value.startTime || !ruleForm.value.endTime || !ruleForm.value.quickReplyId) {
    Swal.fire('Erro', 'Preencha horário de início, fim e a mensagem', 'error');
    return;
  }
  savingRule.value = true;
  try {
    const payload = {
      menuId: selectedMenuId.value,
      quickReplyId: ruleForm.value.quickReplyId,
      startTime: ruleForm.value.startTime,
      endTime: ruleForm.value.endTime,
      label: ruleForm.value.label || null,
    };
    if (editingRuleId.value) {
      await api.put(`/inbox/greeting-rules/${editingRuleId.value}`, payload);
    } else {
      await api.post('/inbox/greeting-rules', payload);
    }
    showRuleForm.value = false;
    await loadGreetingRules(selectedMenuId.value);
    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Salvo!', showConfirmButton: false, timer: 1500 });
  } catch (e) {
    Swal.fire('Erro', e.response?.data?.message || 'Falha ao salvar', 'error');
  } finally {
    savingRule.value = false;
  }
}

async function deleteRule(rule) {
  const result = await Swal.fire({
    title: 'Remover regra?',
    text: `A regra "${rule.label || rule.quickReply?.title}" será removida.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc3545',
    confirmButtonText: 'Remover',
    cancelButtonText: 'Cancelar',
  });
  if (!result.isConfirmed) return;
  try {
    await api.delete(`/inbox/greeting-rules/${rule.id}`);
    greetingRules.value = greetingRules.value.filter(r => r.id !== rule.id);
  } catch (e) {
    Swal.fire('Erro', 'Falha ao remover', 'error');
  }
}

// ── Notificações de pedido ────────────────────────────────────────────────

const templates = ref(Object.fromEntries(STATUSES.map(s => [s.key, ''])));
const savingTemplates = ref(false);

async function loadTemplates() {
  try {
    const { data } = await api.get('/settings/notification-templates');
    for (const s of STATUSES) {
      templates.value[s.key] = typeof data[s.key] === 'string' ? data[s.key] : '';
    }
  } catch (e) {
    console.warn('Falha ao carregar templates de notificação', e);
  }
}

async function saveTemplates() {
  savingTemplates.value = true;
  try {
    await api.patch('/settings/notification-templates', templates.value);
    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Templates salvos!', showConfirmButton: false, timer: 1800 });
  } catch (e) {
    Swal.fire('Erro', e.response?.data?.message || 'Falha ao salvar templates', 'error');
  } finally { savingTemplates.value = false; }
}

// ── Mount ─────────────────────────────────────────────────────────────────

onMounted(async () => {
  try {
    const { data } = await api.get('/menu/menus');
    menus.value = Array.isArray(data) ? data : [];
  } catch (e) { menus.value = []; }
  if (!inboxStore.quickReplies?.length) await inboxStore.fetchQuickReplies();
  await loadTemplates();
});
</script>
