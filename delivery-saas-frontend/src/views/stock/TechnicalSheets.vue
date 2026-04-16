<script setup>
import { ref, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import api from '../../api';
import Swal from 'sweetalert2';
import ListCard from '../../components/ListCard.vue';
import TechnicalSheetForm from '../../components/TechnicalSheetForm.vue';
import TechnicalSheetAiImportModal from '../../components/TechnicalSheetAiImportModal.vue';
import { normalizeToIngredientUnit, areUnitsCompatible } from '../../utils/unitConversion.js';

const list = ref([]);
const showAiImport = ref(false);
const q = ref('')
const loading = ref(false);
const form = ref({ id: null, name: '', notes: '' });
const saving = ref(false);
const error = ref('');
const selected = ref(null);
const showModal = ref(false);
const router = useRouter();
const ingredients = ref([]);
const itemQty = ref('');
const itemIng = ref(null);
const auditItems = ref([]);
const auditTotal = ref(0);
const auditTruncated = ref(false);
const auditCount = computed(() => auditTotal.value);
const showAuditModal = ref(false);

async function loadAudit() {
  try {
    const { data } = await api.get('/technical-sheets/audit-units');
    auditItems.value = data.items || [];
    auditTotal.value = data.total || 0;
    auditTruncated.value = data.truncated || false;
  } catch (e) {
    // ignore — just don't show the banner
  }
}

const selectedIngredient = computed(() => {
  try{
    return ingredients.value.find(i => String(i.id) === String(itemIng.value)) || null;
  }catch(e){ return null }
});

function fmtMoney(v){
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '-';
  return Number(v).toFixed(2);
}

function sheetCost(s) {
  if (!s.items || !s.items.length) return 0;
  return s.items.reduce((acc, it) => {
    const ingUnit = it.ingredient?.unit;
    // skip rows with incompatible units — they would produce bogus numbers
    if (it.unit && ingUnit && !areUnitsCompatible(it.unit, ingUnit)) return acc;
    const cost = Number(it.ingredient?.avgCost) || 0;
    const rawQty = Number(it.quantity) || 0;
    const qty = normalizeToIngredientUnit(rawQty, it.unit, ingUnit);
    return acc + cost * qty;
  }, 0);
}

async function fetch(){
  loading.value = true;
  try{
    const [{ data: sheets }, { data: ings }] = await Promise.all([ api.get('/technical-sheets'), api.get('/ingredients') ]);
    list.value = sheets || [];
    ingredients.value = ings || [];
  }catch(e){ error.value = 'Falha ao carregar' }
  finally{ loading.value = false }
}

function edit(s){ router.push(`/technical-sheets/${s.id}/edit`) }

function openCreate(){ reset(); showModal.value = true }

async function loadSheet(id){
  try{ const { data } = await api.get(`/technical-sheets/${id}`); selected.value = data; }catch(e){ selected.value = null }
}

function reset(){ form.value = { id: null, name: '', notes: '' }; selected.value = null; showModal.value = false }

async function save(){ saving.value = true; error.value='';
  try{
    const payload = { name: form.value.name, notes: form.value.notes };
    if(form.value.id) await api.patch(`/technical-sheets/${form.value.id}`, payload);
    else await api.post('/technical-sheets', payload);
    await fetch(); reset();
  }catch(e){
    // show detailed server error when available to aid debugging
    const serverBody = e?.response?.data;
    error.value = serverBody?.message || (serverBody ? JSON.stringify(serverBody) : (e.message || String(e)));
    console.error('TechnicalSheets.save error', e, serverBody);
  }
  finally{ saving.value = false }
}

async function addItem(){
  if(!selected.value || !itemIng.value || !itemQty.value) return;
  try{
    await api.post(`/technical-sheets/${selected.value.id}/items`, { ingredientId: itemIng.value, quantity: Number(itemQty.value) });
    await loadSheet(selected.value.id);
    itemQty.value = '';
    itemIng.value = null;
  }catch(e){ alert(e?.response?.data?.message || 'Erro ao adicionar item') }
}

async function removeItem(id){
  if(!selected.value) return;
  try{ await api.delete(`/technical-sheets/${selected.value.id}/items/${id}`); await loadSheet(selected.value.id); }catch(e){ alert('Erro ao remover item') }
}

onMounted(() => { fetch(); loadAudit(); });

const displayed = computed(() => {
  if(!q.value) return list.value
  const term = q.value.toLowerCase()
  return (list.value || []).filter(s => (s.name || '').toLowerCase().includes(term))
})

async function deleteSheet(s) {
  const { isConfirmed } = await Swal.fire({
    title: 'Excluir ficha técnica?',
    text: `"${s.name}" será removida permanentemente.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc3545',
    confirmButtonText: 'Excluir',
    cancelButtonText: 'Cancelar',
  });
  if (!isConfirmed) return;
  try {
    await api.delete(`/technical-sheets/${s.id}`);
    await fetch();
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Erro ao excluir' });
  }
}

async function duplicateSheet(s) {
  const { isConfirmed } = await Swal.fire({
    title: 'Duplicar ficha técnica?',
    text: `Uma cópia de "${s.name}" será criada com todos os itens.`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Duplicar',
    cancelButtonText: 'Cancelar',
  });
  if (!isConfirmed) return;
  try {
    await api.post(`/technical-sheets/${s.id}/duplicate`);
    await Swal.fire({ icon: 'success', text: 'Cópia criada', timer: 1200, showConfirmButton: false });
    await fetch();
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Erro ao duplicar' });
  }
}

function onQuickSearch(val){ q.value = val }
function onQuickClear(){ q.value = '' }
</script>

<template>
  <div class="p-4">

    <div v-if="auditCount > 0" class="alert alert-warning d-flex justify-content-between align-items-center mb-3">
      <div>
        <i class="bi-exclamation-triangle me-2"></i>
        <strong>{{ auditCount }}</strong> item(ns) com unidade incompatível precisam ser revisados.
        Essas fichas estão com custo incorreto.
      </div>
      <button class="btn btn-sm btn-warning" @click="showAuditModal = true">
        Ver itens
      </button>
    </div>

    <div v-if="showAuditModal" class="modal fade show d-block" tabindex="-1" style="background:rgba(0,0,0,0.5)">
      <div class="modal-dialog modal-lg">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Itens com unidade incompatível</h5>
            <button type="button" class="btn-close" @click="showAuditModal = false"></button>
          </div>
          <div class="modal-body">
            <p class="small text-muted">Estes itens foram salvos com unidades que não convertem para a unidade do ingrediente. O custo exibido e a baixa de estoque para esses itens estão incorretos. Clique em "Abrir ficha" para corrigi-los.</p>
            <table class="table table-sm">
              <thead>
                <tr>
                  <th>Ficha</th>
                  <th>Ingrediente</th>
                  <th>Qtd atual</th>
                  <th>Unidade</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="a in auditItems" :key="a.itemId">
                  <td>{{ a.sheetName }}</td>
                  <td>{{ a.ingredientName }}</td>
                  <td>{{ a.quantity }} {{ a.itemUnit }}</td>
                  <td><span class="badge bg-danger">{{ a.itemUnit }}</span> → <span class="badge bg-light text-dark">{{ a.ingredientUnit }}</span></td>
                  <td><router-link :to="`/technical-sheets/${a.sheetId}/edit`" class="btn btn-sm btn-outline-primary">Abrir ficha</router-link></td>
                </tr>
              </tbody>
            </table>
            <p v-if="auditTruncated" class="small text-muted mt-2">
              Mostrando {{ auditItems.length }} de {{ auditTotal }} itens. Corrija e recarregue para ver os demais.
            </p>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" @click="showAuditModal = false">Fechar</button>
          </div>
        </div>
      </div>
    </div>

    <ListCard title="Fichas Técnicas" icon="bi bi-file-earmark-text" :subtitle="list.length ? `${list.length} itens` : ''" :quickSearch="true" quickSearchPlaceholder="Buscar por nome" @quick-search="onQuickSearch" @quick-clear="onQuickClear">
      <template #actions>
        <button class="btn btn-outline-primary me-2" @click="showAiImport = true">
          <i class="bi bi-stars me-1"></i>Importar com IA
        </button>
        <button class="btn btn-primary" @click="openCreate">Nova Ficha</button>
      </template>

      <template #default>
        <div class="table-responsive">
          <table class="table table-hover table-sm mb-0">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Rendimento</th>
                <th class="text-end">Itens</th>
                <th class="text-end">Custo</th>
                <th class="text-end">Ações</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in displayed" :key="s.id">
                <td>{{ s.name }}</td>
                <td class="text-muted">{{ s.yield || '-' }}</td>
                <td class="text-end">{{ s.itemCount || 0 }}</td>
                <td class="text-end">R$ {{ fmtMoney(sheetCost(s)) }}</td>
                <td class="text-end">
                  <button class="btn btn-sm btn-outline-secondary me-1" @click="edit(s)">Editar</button>
                  <button class="btn btn-sm btn-outline-secondary me-1" @click="duplicateSheet(s)" title="Duplicar"><i class="bi bi-files"></i></button>
                  <button class="btn btn-sm btn-outline-danger" @click="deleteSheet(s)" title="Excluir"><i class="bi bi-trash"></i></button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </ListCard>

    <div v-if="showModal">
      <div class="modal-backdrop fade show"></div>
      <div class="modal d-block" tabindex="-1">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Nova Ficha Técnica</h5>
              <button type="button" class="btn-close" aria-label="Close" @click="showModal = false"></button>
            </div>
            <div class="modal-body">
              <TechnicalSheetForm :initial="form" @saved="() => { showModal = false; fetch(); }" @cancel="() => { showModal = false }" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="selected" class="card">
      <div class="card-body">
        <h5>{{ selected.name }}</h5>
        <p class="small text-muted">{{ selected.notes }}</p>
        <hr />
        <h6>Itens</h6>
        <div class="mb-2">
          <div class="d-flex gap-2">
            <select v-model="itemIng" class="form-select"><option :value="null">-- Selecione ingrediente --</option><option v-for="i in ingredients" :key="i.id" :value="i.id">{{ i.description }} ({{ i.unit }})</option></select>
            <input v-model="itemQty" type="number" step="any" class="form-control" placeholder="Quantidade" />
            <button class="btn btn-primary" @click="addItem">Adicionar</button>
          </div>
          <div class="mt-2 small text-muted">
            <span v-if="selectedIngredient">Unidade: <strong>{{ selectedIngredient.unit }}</strong></span>
            <span v-if="selectedIngredient" class="ms-3">Custo unit.: <strong>{{ fmtMoney(selectedIngredient.avgCost) }}</strong></span>
          </div>
        </div>
        <table class="table table-sm">
          <thead>
            <tr>
              <th>Ingrediente</th>
              <th>Unidade</th>
              <th>Custo Unit.</th>
              <th>Qtd</th>
              <th>Custo Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="it in selected.items" :key="it.id">
              <td>{{ it.ingredient.description }}</td>
              <td>
                {{ it.unit || it.ingredient.unit || '-' }}
                <span v-if="it.unit && !areUnitsCompatible(it.unit, it.ingredient.unit)" class="badge bg-danger ms-1" :title="'Incompatível com ' + it.ingredient.unit"><i class="bi-exclamation-triangle"></i> Inválida</span>
              </td>
              <td>{{ fmtMoney(it.ingredient.avgCost) }}/{{ it.ingredient.unit }}</td>
              <td>{{ it.quantity }}</td>
              <td>
                <template v-if="it.unit && !areUnitsCompatible(it.unit, it.ingredient.unit)">
                  <span class="text-danger" :title="'Não é possível calcular: ' + it.unit + ' não converte para ' + it.ingredient.unit">—</span>
                </template>
                <template v-else>
                  {{ fmtMoney((it.ingredient.avgCost || 0) * normalizeToIngredientUnit(Number(it.quantity || 0), it.unit, it.ingredient?.unit)) }}
                </template>
              </td>
              <td><button class="btn btn-sm btn-outline-danger" @click="removeItem(it.id)">Remover</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <TechnicalSheetAiImportModal
      v-if="showAiImport"
      @close="showAiImport = false"
      @imported="showAiImport = false; fetch()"
    />
  </div>
</template>