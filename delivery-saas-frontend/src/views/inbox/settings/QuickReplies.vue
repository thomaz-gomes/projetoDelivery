<template>
  <div class="container" style="max-width: 800px;">
    <div class="py-4">
      <!-- Header -->
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h5 class="mb-0">Respostas Rapidas</h5>
        <button class="btn btn-primary btn-sm" @click="openCreate">
          <i class="bi bi-plus-lg me-1"></i>Nova
        </button>
      </div>

      <!-- Table -->
      <div class="card">
        <div class="table-responsive">
          <table class="table table-hover mb-0">
            <thead>
              <tr>
                <th>Atalho</th>
                <th>Titulo</th>
                <th>Mensagem</th>
                <th style="width: 90px;"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!inboxStore.quickReplies.length">
                <td colspan="4" class="text-center text-muted py-4">
                  Nenhuma resposta rapida cadastrada.
                </td>
              </tr>
              <tr v-for="reply in inboxStore.quickReplies" :key="reply.id">
                <td><code>/{{ reply.shortcut }}</code></td>
                <td>{{ reply.title }}</td>
                <td>
                  <span class="d-inline-block text-truncate" style="max-width: 300px;">
                    {{ reply.body }}
                  </span>
                </td>
                <td class="text-end">
                  <button class="btn btn-sm btn-outline-secondary me-1" @click="openEdit(reply)" title="Editar">
                    <i class="bi bi-pencil"></i>
                  </button>
                  <button class="btn btn-sm btn-outline-danger" @click="confirmDelete(reply)" title="Excluir">
                    <i class="bi bi-trash"></i>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Modal -->
      <div v-if="showForm" class="modal d-block" style="background: rgba(0,0,0,0.5);" @click.self="showForm = false">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">{{ editingId ? 'Editar' : 'Nova' }} Resposta Rapida</h5>
              <button type="button" class="btn-close" @click="showForm = false"></button>
            </div>
            <form @submit.prevent="save">
              <div class="modal-body d-flex flex-column gap-3">
                <div>
                  <label class="form-label">Atalho</label>
                  <input v-model="form.shortcut" type="text" class="form-control" placeholder="ex: ola" required />
                </div>
                <div>
                  <label class="form-label">Titulo</label>
                  <input v-model="form.title" type="text" class="form-control" placeholder="ex: Saudacao" required />
                </div>
                <div>
                  <label class="form-label">Mensagem</label>
                  <textarea v-model="form.body" class="form-control" rows="4" placeholder="Texto da resposta..." required></textarea>
                </div>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" @click="showForm = false">Cancelar</button>
                <button type="submit" class="btn btn-primary" :disabled="saving">
                  <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useInboxStore } from '@/stores/inbox';
import Swal from 'sweetalert2';

const inboxStore = useInboxStore();

const showForm = ref(false);
const saving = ref(false);
const editingId = ref(null);
const form = ref({ shortcut: '', title: '', body: '' });

onMounted(() => {
  inboxStore.fetchQuickReplies();
});

function openCreate() {
  editingId.value = null;
  form.value = { shortcut: '', title: '', body: '' };
  showForm.value = true;
}

function openEdit(reply) {
  editingId.value = reply.id;
  form.value = { shortcut: reply.shortcut, title: reply.title, body: reply.body };
  showForm.value = true;
}

async function save() {
  saving.value = true;
  try {
    if (editingId.value) {
      await inboxStore.updateQuickReply(editingId.value, form.value);
    } else {
      await inboxStore.createQuickReply(form.value);
    }
    showForm.value = false;
  } catch (err) {
    Swal.fire('Erro', err.response?.data?.error || 'Falha ao salvar', 'error');
  } finally {
    saving.value = false;
  }
}

async function confirmDelete(reply) {
  const result = await Swal.fire({
    title: 'Excluir resposta rapida?',
    text: `"${reply.title}" sera removida permanentemente.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc3545',
    confirmButtonText: 'Excluir',
    cancelButtonText: 'Cancelar',
  });
  if (result.isConfirmed) {
    try {
      await inboxStore.deleteQuickReply(reply.id);
    } catch (err) {
      Swal.fire('Erro', err.response?.data?.error || 'Falha ao excluir', 'error');
    }
  }
}
</script>
