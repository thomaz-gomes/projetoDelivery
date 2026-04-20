<script setup>
import { ref, onMounted, computed } from 'vue';
import Swal from 'sweetalert2';
import api from '../../api';
import ListCard from '../../components/ListCard.vue';

const list = ref([]);
const q = ref('');
const loading = ref(false);
const error = ref('');

const showModal = ref(false);
const editing = ref(null);
const form = ref({ name: '', cnpj: '', phone: '', email: '', notes: '' });

async function fetchList() {
  loading.value = true;
  try {
    const { data } = await api.get('/suppliers');
    list.value = data || [];
  } catch (e) {
    error.value = 'Falha ao carregar fornecedores';
  } finally {
    loading.value = false;
  }
}

function formatCnpj(cnpj) {
  if (!cnpj) return '-';
  const digits = String(cnpj).replace(/\D/g, '');
  if (digits.length !== 14) return cnpj;
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

const displayed = computed(() => {
  if (!q.value) return list.value;
  const term = q.value.toLowerCase();
  return (list.value || []).filter(s =>
    (s.name || '').toLowerCase().includes(term) ||
    (s.cnpj || '').replace(/\D/g, '').includes(term.replace(/\D/g, ''))
  );
});

function onQuickSearch(val) { q.value = val; }
function onQuickClear() { q.value = ''; }

function openCreate() {
  editing.value = null;
  form.value = { name: '', cnpj: '', phone: '', email: '', notes: '' };
  showModal.value = true;
}

function openEdit(supplier) {
  editing.value = supplier;
  form.value = {
    name: supplier.name || '',
    cnpj: supplier.cnpj || '',
    phone: supplier.phone || '',
    email: supplier.email || '',
    notes: supplier.notes || '',
  };
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
  editing.value = null;
}

async function saveSupplier() {
  try {
    const payload = {
      name: form.value.name,
      cnpj: (form.value.cnpj || '').replace(/\D/g, '') || null,
      phone: form.value.phone || null,
      email: form.value.email || null,
      notes: form.value.notes || null,
    };
    if (editing.value) {
      await api.patch(`/suppliers/${editing.value.id}`, payload);
    } else {
      await api.post('/suppliers', payload);
    }
    await Swal.fire({ icon: 'success', text: editing.value ? 'Fornecedor atualizado' : 'Fornecedor criado', timer: 1200, showConfirmButton: false });
    closeModal();
    await fetchList();
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Erro ao salvar fornecedor' });
  }
}

async function toggleActive(supplier) {
  const newActive = !supplier.isActive;
  const { isConfirmed } = await Swal.fire({
    title: newActive ? 'Ativar fornecedor?' : 'Desativar fornecedor?',
    text: `"${supplier.name}" será ${newActive ? 'ativado' : 'desativado'}.`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: newActive ? 'Ativar' : 'Desativar',
    cancelButtonText: 'Cancelar',
  });
  if (!isConfirmed) return;
  try {
    await api.patch(`/suppliers/${supplier.id}`, { isActive: newActive });
    await Swal.fire({ icon: 'success', text: newActive ? 'Ativado' : 'Desativado', timer: 1200, showConfirmButton: false });
    await fetchList();
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Erro ao alterar status' });
  }
}

async function deleteSupplier(supplier) {
  const { isConfirmed } = await Swal.fire({
    title: 'Excluir fornecedor?',
    text: `"${supplier.name}" será desativado.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc3545',
    confirmButtonText: 'Excluir',
    cancelButtonText: 'Cancelar',
  });
  if (!isConfirmed) return;
  try {
    await api.delete(`/suppliers/${supplier.id}`);
    await Swal.fire({ icon: 'success', text: 'Excluído', timer: 1200, showConfirmButton: false });
    await fetchList();
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Erro ao excluir' });
  }
}

onMounted(() => { fetchList(); });
</script>

<template>
  <div class="p-4">
    <ListCard title="Fornecedores" icon="bi bi-truck" :subtitle="list.length ? `${list.length} itens` : ''" :quickSearch="true" quickSearchPlaceholder="Buscar por nome, CNPJ" @quick-search="onQuickSearch" @quick-clear="onQuickClear">
      <template #actions>
        <div class="mb-3 d-flex justify-content-end align-items-center gap-2">
          <button class="btn btn-primary" @click="openCreate">+ Novo Fornecedor</button>
        </div>
      </template>

      <template #default>
        <div class="table-responsive">
          <table class="table table-hover mb-0">
            <thead>
              <tr>
                <th>Nome</th>
                <th>CNPJ</th>
                <th>Telefone</th>
                <th>Email</th>
                <th>Status</th>
                <th class="text-end">Ações</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in displayed" :key="s.id">
                <td>{{ s.name }}</td>
                <td>{{ formatCnpj(s.cnpj) }}</td>
                <td>{{ s.phone || '-' }}</td>
                <td>{{ s.email || '-' }}</td>
                <td>
                  <span :class="['badge', s.isActive !== false ? 'bg-success' : 'bg-secondary']">
                    {{ s.isActive !== false ? 'Ativo' : 'Inativo' }}
                  </span>
                </td>
                <td class="text-end">
                  <button class="btn btn-sm btn-outline-secondary me-1" @click="openEdit(s)" title="Editar"><i class="bi bi-pencil"></i></button>
                  <button class="btn btn-sm me-1" :class="s.isActive !== false ? 'btn-outline-warning' : 'btn-outline-success'" @click="toggleActive(s)" :title="s.isActive !== false ? 'Desativar' : 'Ativar'">
                    <i :class="s.isActive !== false ? 'bi bi-toggle-on' : 'bi bi-toggle-off'"></i>
                  </button>
                  <button class="btn btn-sm btn-outline-danger" @click="deleteSupplier(s)" title="Excluir"><i class="bi bi-trash"></i></button>
                </td>
              </tr>
              <tr v-if="!list.length"><td colspan="6" class="text-center text-muted py-4">Nenhum fornecedor cadastrado.</td></tr>
            </tbody>
          </table>
        </div>
      </template>
    </ListCard>

    <!-- Modal Criar/Editar -->
    <div v-if="showModal" class="modal d-block" tabindex="-1" style="background:rgba(0,0,0,0.4)">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">{{ editing ? 'Editar Fornecedor' : 'Novo Fornecedor' }}</h5>
            <button type="button" class="btn-close" @click="closeModal"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label">Nome *</label>
              <input type="text" class="form-control" v-model="form.name" required />
            </div>
            <div class="mb-3">
              <label class="form-label">CNPJ</label>
              <input type="text" class="form-control" v-model="form.cnpj" placeholder="00.000.000/0000-00" />
            </div>
            <div class="mb-3">
              <label class="form-label">Telefone</label>
              <input type="text" class="form-control" v-model="form.phone" />
            </div>
            <div class="mb-3">
              <label class="form-label">Email</label>
              <input type="email" class="form-control" v-model="form.email" />
            </div>
            <div class="mb-3">
              <label class="form-label">Observações</label>
              <textarea class="form-control" v-model="form.notes" rows="3"></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="closeModal">Cancelar</button>
            <button type="button" class="btn btn-primary" @click="saveSupplier" :disabled="!form.name">Salvar</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
