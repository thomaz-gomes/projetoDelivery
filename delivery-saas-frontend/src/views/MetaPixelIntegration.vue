<script setup>
import { ref, onMounted, computed } from 'vue';
import Swal from 'sweetalert2';
import api from '../api';

const pixels = ref([]);
const menus = ref([]);
const stores = ref([]);
const loading = ref(false);
const saving = ref(false);
const statusMsg = ref('');
const statusType = ref('info');

const form = ref({
  menuId: null,
  pixelId: '',
  enabled: true,
  trackPageView: true,
  trackViewContent: true,
  trackAddToCart: true,
  trackInitiateCheckout: true,
  trackAddPaymentInfo: true,
  trackPurchase: true,
  trackSearch: true,
  trackLead: true,
  trackContact: true,
});

const editingId = ref(null);

const eventDescriptions = {
  trackPageView: { label: 'PageView', desc: 'Quando o cliente abre o cardápio' },
  trackViewContent: { label: 'ViewContent', desc: 'Quando o cliente visualiza um produto' },
  trackAddToCart: { label: 'AddToCart', desc: 'Quando o cliente adiciona item ao carrinho' },
  trackSearch: { label: 'Search', desc: 'Quando o cliente busca um produto' },
  trackInitiateCheckout: { label: 'InitiateCheckout', desc: 'Quando o cliente inicia o checkout' },
  trackAddPaymentInfo: { label: 'AddPaymentInfo', desc: 'Quando o cliente seleciona forma de pagamento' },
  trackPurchase: { label: 'Purchase', desc: 'Quando o pedido é finalizado com sucesso' },
  trackLead: { label: 'Lead', desc: 'Quando o cliente se cadastra ou faz login' },
  trackContact: { label: 'Contact', desc: 'Quando o cliente clica em WhatsApp ou telefone' },
};

function showStatus(msg, type = 'info') {
  statusMsg.value = msg;
  statusType.value = type;
}

function menuName(menuId) {
  const m = menus.value.find(x => x.id === menuId);
  if (!m) return menuId;
  const store = stores.value.find(s => s.id === m.storeId);
  return m.name + (store ? ` (${store.name})` : '');
}

const availableMenus = computed(() => {
  const usedMenuIds = pixels.value.filter(p => !editingId.value || p.id !== editingId.value).map(p => p.menuId);
  return menus.value.filter(m => !usedMenuIds.includes(m.id));
});

async function loadAll() {
  loading.value = true;
  try {
    const [pixelsRes, menusRes, storesRes] = await Promise.all([
      api.get('/meta-pixel'),
      api.get('/menu/menus'),
      api.get('/stores'),
    ]);
    pixels.value = pixelsRes.data || [];
    menus.value = menusRes.data || [];
    stores.value = storesRes.data || [];
  } catch (e) {
    console.error('Failed to load data', e);
    showStatus('Erro ao carregar dados.', 'danger');
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  editingId.value = null;
  form.value = {
    menuId: null,
    pixelId: '',
    enabled: true,
    trackPageView: true,
    trackViewContent: true,
    trackAddToCart: true,
    trackInitiateCheckout: true,
    trackAddPaymentInfo: true,
    trackPurchase: true,
    trackSearch: true,
    trackLead: true,
    trackContact: true,
  };
}

function editPixel(pixel) {
  editingId.value = pixel.id;
  form.value = {
    menuId: pixel.menuId,
    pixelId: pixel.pixelId,
    enabled: pixel.enabled,
    trackPageView: pixel.trackPageView,
    trackViewContent: pixel.trackViewContent,
    trackAddToCart: pixel.trackAddToCart,
    trackInitiateCheckout: pixel.trackInitiateCheckout,
    trackAddPaymentInfo: pixel.trackAddPaymentInfo,
    trackPurchase: pixel.trackPurchase,
    trackSearch: pixel.trackSearch,
    trackLead: pixel.trackLead,
    trackContact: pixel.trackContact,
  };
  // scroll to form
  try { document.getElementById('pixel-form')?.scrollIntoView({ behavior: 'smooth' }) } catch(e) {}
}

async function savePixel() {
  if (saving.value) return;
  statusMsg.value = '';
  if (!form.value.menuId) { showStatus('Selecione um cardápio.', 'danger'); return; }
  if (!form.value.pixelId || !/^\d{10,20}$/.test(String(form.value.pixelId).trim())) {
    showStatus('Informe um Pixel ID válido (10-20 dígitos numéricos).', 'danger');
    return;
  }
  saving.value = true;
  try {
    if (editingId.value) {
      await api.put(`/meta-pixel/${editingId.value}`, form.value);
      showStatus('Pixel atualizado com sucesso!', 'success');
    } else {
      await api.post('/meta-pixel', form.value);
      showStatus('Pixel criado com sucesso!', 'success');
    }
    resetForm();
    await loadAll();
  } catch (e) {
    console.error('Save pixel failed', e);
    showStatus(e?.response?.data?.message || 'Erro ao salvar pixel.', 'danger');
  } finally {
    saving.value = false;
  }
}

async function deletePixel(pixel) {
  const res = await Swal.fire({
    title: 'Remover Pixel',
    text: `Tem certeza que deseja remover o Pixel do cardápio "${menuName(pixel.menuId)}"?`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sim, remover',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc3545',
  });
  if (!res || !res.isConfirmed) return;
  try {
    await api.delete(`/meta-pixel/${pixel.id}`);
    showStatus('Pixel removido.', 'info');
    await loadAll();
  } catch (e) {
    console.error('Delete pixel failed', e);
    showStatus(e?.response?.data?.message || 'Erro ao remover pixel.', 'danger');
  }
}

async function toggleEnabled(pixel) {
  try {
    await api.put(`/meta-pixel/${pixel.id}`, { enabled: !pixel.enabled });
    await loadAll();
  } catch (e) {
    console.error('Toggle failed', e);
    showStatus('Erro ao alterar status.', 'danger');
  }
}

onMounted(loadAll);
</script>

<template>
  <div>
    <!-- Header -->
    <div class="d-flex align-items-center justify-content-between mb-4">
      <div class="d-flex align-items-center gap-3">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="#1877F2">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
        </svg>
        <h4 class="mb-0">Meta Pixel (Facebook)</h4>
      </div>
    </div>

    <div v-if="statusMsg" :class="['alert', `alert-${statusType}`, 'alert-dismissible']" role="alert">
      {{ statusMsg }}
      <button type="button" class="btn-close" @click="statusMsg = ''"></button>
    </div>

    <!-- Info card -->
    <div class="card border-0 bg-light mb-4">
      <div class="card-body">
        <h6 class="card-title">O que é o Meta Pixel?</h6>
        <p class="card-text small text-muted mb-2">
          O Meta Pixel é um trecho de código do Facebook/Instagram que permite rastrear o comportamento dos visitantes do seu cardápio online.
          Com ele, você pode criar públicos personalizados, medir conversões e otimizar campanhas de anúncios.
        </p>
        <p class="card-text small text-muted mb-0">
          Cada cardápio pode ter seu próprio Pixel configurado. Os eventos rastreados incluem: visualização de página, visualização de produto,
          adição ao carrinho, início de checkout, pagamento, compra finalizada, busca, cadastro e contato.
        </p>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-5">
      <div class="spinner-border text-primary" role="status"></div>
    </div>

    <template v-else>
      <!-- Existing pixels list -->
      <div v-if="pixels.length > 0" class="mb-4">
        <h6 class="mb-3">Pixels configurados</h6>
        <div class="table-responsive">
          <table class="table table-hover align-middle">
            <thead class="table-light">
              <tr>
                <th>Cardápio</th>
                <th>Pixel ID</th>
                <th>Status</th>
                <th>Eventos</th>
                <th class="text-end">Ações</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="px in pixels" :key="px.id">
                <td>
                  <strong>{{ menuName(px.menuId) }}</strong>
                </td>
                <td>
                  <code>{{ px.pixelId }}</code>
                </td>
                <td>
                  <span :class="['badge', px.enabled ? 'bg-success' : 'bg-secondary']" style="cursor:pointer" @click="toggleEnabled(px)">
                    {{ px.enabled ? 'Ativo' : 'Inativo' }}
                  </span>
                </td>
                <td>
                  <span class="small text-muted">
                    {{ Object.keys(eventDescriptions).filter(k => px[k]).length }}/{{ Object.keys(eventDescriptions).length }} eventos
                  </span>
                </td>
                <td class="text-end">
                  <button class="btn btn-sm btn-outline-primary me-1" @click="editPixel(px)" title="Editar">
                    <i class="bi bi-pencil"></i>
                  </button>
                  <button class="btn btn-sm btn-outline-danger" @click="deletePixel(px)" title="Remover">
                    <i class="bi bi-trash"></i>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Form -->
      <div id="pixel-form" class="card">
        <div class="card-header">
          <h6 class="mb-0">{{ editingId ? 'Editar Pixel' : 'Adicionar novo Pixel' }}</h6>
        </div>
        <div class="card-body">
          <div class="row g-3">
            <!-- Menu selection -->
            <div class="col-md-6">
              <label class="form-label">Cardápio</label>
              <SelectInput class="form-select" v-model="form.menuId" :disabled="!!editingId">
                <option :value="null">-- Selecione um cardápio --</option>
                <option v-for="m in (editingId ? menus : availableMenus)" :key="m.id" :value="m.id">
                  {{ m.name }}{{ stores.find(s => s.id === m.storeId) ? ` (${stores.find(s => s.id === m.storeId).name})` : '' }}
                </option>
              </SelectInput>
              <div class="form-text">O pixel será ativado apenas neste cardápio público.</div>
            </div>

            <!-- Pixel ID -->
            <div class="col-md-6">
              <label class="form-label">Pixel ID</label>
              <TextInput v-model="form.pixelId" placeholder="Ex: 123456789012345" inputClass="form-control" />
              <div class="form-text">
                Encontre seu Pixel ID no
                <a href="https://business.facebook.com/events_manager" target="_blank" rel="noopener">Gerenciador de Eventos do Meta</a>.
              </div>
            </div>

            <!-- Enabled toggle -->
            <div class="col-12">
              <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" id="pixelEnabled" v-model="form.enabled" />
                <label class="form-check-label" for="pixelEnabled">Pixel ativo</label>
              </div>
            </div>

            <!-- Events configuration -->
            <div class="col-12">
              <label class="form-label mb-2">Eventos rastreados</label>
              <div class="row g-2">
                <div v-for="(info, key) in eventDescriptions" :key="key" class="col-md-6 col-lg-4">
                  <div class="card border h-100">
                    <div class="card-body py-2 px-3 d-flex align-items-start gap-2">
                      <div class="form-check form-switch mt-1">
                        <input class="form-check-input" type="checkbox" :id="'ev-' + key" v-model="form[key]" />
                      </div>
                      <div>
                        <label :for="'ev-' + key" class="form-check-label fw-semibold small">{{ info.label }}</label>
                        <div class="text-muted" style="font-size:0.75rem">{{ info.desc }}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div class="d-flex gap-2 mt-4">
            <button class="btn btn-primary" @click="savePixel" :disabled="saving">
              <span v-if="saving" class="spinner-border spinner-border-sm me-2" role="status"></span>
              {{ editingId ? 'Salvar alterações' : 'Adicionar Pixel' }}
            </button>
            <button v-if="editingId" class="btn btn-outline-secondary" @click="resetForm">Cancelar</button>
          </div>
        </div>
      </div>

      <!-- Help section -->
      <div class="card mt-4 border-0 bg-light">
        <div class="card-body">
          <h6>Como configurar</h6>
          <ol class="small text-muted mb-0">
            <li>Acesse o <a href="https://business.facebook.com/events_manager" target="_blank" rel="noopener">Gerenciador de Eventos do Meta</a> e crie um Pixel (ou use um existente).</li>
            <li>Copie o <strong>Pixel ID</strong> (sequência numérica de 15-16 dígitos).</li>
            <li>Selecione o cardápio onde deseja ativar o rastreamento e cole o Pixel ID acima.</li>
            <li>Escolha quais eventos deseja rastrear (recomendamos manter todos ativos).</li>
            <li>Pronto! O pixel será carregado automaticamente quando clientes acessarem o cardápio público.</li>
            <li>Use o <a href="https://developers.facebook.com/docs/meta-pixel/support/pixel-helper" target="_blank" rel="noopener">Meta Pixel Helper</a> (extensão do Chrome) para verificar se os eventos estão sendo disparados corretamente.</li>
          </ol>
        </div>
      </div>
    </template>
  </div>
</template>
