<template>
  <div class="container" style="max-width: 800px;">
    <div class="py-4">
      <!-- Header -->
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h5 class="mb-0">Respostas Rápidas</h5>
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
                <th>Título</th>
                <th>Mensagem</th>
                <th style="width: 90px;"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!inboxStore.quickReplies.length">
                <td colspan="4" class="text-center text-muted py-4">
                  Nenhuma resposta rápida cadastrada.
                </td>
              </tr>
              <tr v-for="reply in inboxStore.quickReplies" :key="reply.id">
                <td>
                  <code v-if="reply.shortcut">{{ reply.shortcut }}</code>
                  <span v-else class="text-muted small">—</span>
                </td>
                <td>{{ reply.title }}</td>
                <td>
                  <i v-if="reply.mediaUrl" class="bi bi-paperclip me-1 text-primary" :title="reply.mediaFileName || 'anexo'"></i>
                  <span class="d-inline-block text-truncate" style="max-width: 260px; vertical-align: middle;">
                    {{ reply.body || (reply.mediaUrl ? '(apenas anexo)' : '') }}
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
              <h5 class="modal-title">{{ editingId ? 'Editar' : 'Nova' }} Resposta Rápida</h5>
              <button type="button" class="btn-close" @click="showForm = false"></button>
            </div>
            <form @submit.prevent="save">
              <div class="modal-body d-flex flex-column gap-3">
                <div>
                  <div class="form-check mb-2">
                    <input
                      id="useShortcutCheck"
                      v-model="form.useShortcut"
                      class="form-check-input"
                      type="checkbox"
                    />
                    <label class="form-check-label" for="useShortcutCheck">
                      Adicionar atalho de teclado no chat
                    </label>
                  </div>
                  <div v-if="form.useShortcut">
                    <input
                      v-model="form.shortcut"
                      type="text"
                      class="form-control"
                      placeholder="ex: ola (sem a barra)"
                    />
                    <small class="text-muted">Disponível digitando /atalho no chat</small>
                  </div>
                </div>
                <div>
                  <label class="form-label">Título</label>
                  <input v-model="form.title" type="text" class="form-control" placeholder="ex: Saudação" required />
                </div>
                <div>
                  <label class="form-label">Mensagem <span class="text-muted small">(opcional se tiver anexo)</span></label>
                  <textarea v-model="form.body" class="form-control" rows="4" placeholder="Texto da resposta..."></textarea>
                </div>

                <!-- Attachment -->
                <div>
                  <label class="form-label">Anexo <span class="text-muted small">(opcional)</span></label>

                  <!-- Existing attachment (edit mode) -->
                  <div v-if="form.existingMediaUrl && !selectedFile && !form.removeMedia" class="d-flex align-items-center gap-2 p-2 bg-light rounded mb-2 small">
                    <i class="bi bi-file-earmark"></i>
                    <span class="text-truncate flex-grow-1">{{ form.existingMediaFileName || 'arquivo' }}</span>
                    <a :href="assetBase + form.existingMediaUrl" target="_blank" class="btn btn-sm btn-link p-0 me-1" title="Abrir">
                      <i class="bi bi-box-arrow-up-right"></i>
                    </a>
                    <button type="button" class="btn btn-sm btn-outline-danger" @click="markRemoveMedia">Remover</button>
                  </div>

                  <!-- Selected file preview -->
                  <div v-else-if="selectedFile" class="d-flex align-items-center gap-2 p-2 bg-light rounded mb-2 small">
                    <i class="bi bi-paperclip"></i>
                    <span class="text-truncate flex-grow-1">{{ selectedFile.name }}</span>
                    <button type="button" class="btn btn-sm btn-outline-danger" @click="clearSelectedFile">Remover</button>
                  </div>

                  <input
                    type="file"
                    class="form-control form-control-sm"
                    accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,video/*,audio/*"
                    @change="onFileChange"
                  />
                  <small class="text-muted d-block mt-1">Máx 25 MB. Informe texto, anexo, ou ambos.</small>
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
import { API_URL } from '@/config';
import Swal from 'sweetalert2';

const inboxStore = useInboxStore();

const showForm = ref(false);
const saving = ref(false);
const editingId = ref(null);
const selectedFile = ref(null);
const assetBase = API_URL;

const form = ref({
  useShortcut: false,
  shortcut: '',
  title: '',
  body: '',
  existingMediaUrl: null,
  existingMediaFileName: null,
  removeMedia: false,
});

onMounted(() => {
  inboxStore.fetchQuickReplies();
});

function resetForm() {
  form.value = {
    useShortcut: false,
    shortcut: '',
    title: '',
    body: '',
    existingMediaUrl: null,
    existingMediaFileName: null,
    removeMedia: false,
  };
  selectedFile.value = null;
}

function openCreate() {
  editingId.value = null;
  resetForm();
  showForm.value = true;
}

function openEdit(reply) {
  editingId.value = reply.id;
  form.value = {
    useShortcut: !!reply.shortcut,
    shortcut: reply.shortcut ? reply.shortcut.replace(/^\//, '') : '',
    title: reply.title,
    body: reply.body || '',
    existingMediaUrl: reply.mediaUrl || null,
    existingMediaFileName: reply.mediaFileName || null,
    removeMedia: false,
  };
  selectedFile.value = null;
  showForm.value = true;
}

function onFileChange(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) {
    Swal.fire('Erro', 'Arquivo maior que 25 MB', 'error');
    e.target.value = '';
    return;
  }
  selectedFile.value = file;
  form.value.removeMedia = false;
}

function clearSelectedFile() {
  selectedFile.value = null;
}

function markRemoveMedia() {
  form.value.removeMedia = true;
  selectedFile.value = null;
}

async function save() {
  // Validation: shortcut required when toggle is on
  if (form.value.useShortcut && !form.value.shortcut.trim()) {
    Swal.fire('Erro', 'Informe o atalho ou desmarque a opção', 'error');
    return;
  }

  // Validation: body or attachment required
  const hasBody = form.value.body && form.value.body.trim();
  const willHaveMedia = !!selectedFile.value || (form.value.existingMediaUrl && !form.value.removeMedia);
  if (!hasBody && !willHaveMedia) {
    Swal.fire('Erro', 'Informe texto, anexo, ou ambos', 'error');
    return;
  }

  saving.value = true;
  try {
    const fd = new FormData();
    if (form.value.useShortcut && form.value.shortcut.trim()) {
      fd.append('shortcut', form.value.shortcut.trim());
    } else {
      fd.append('shortcut', '');
    }
    fd.append('title', form.value.title);
    if (hasBody) fd.append('body', form.value.body.trim());
    if (selectedFile.value) fd.append('file', selectedFile.value);
    if (form.value.removeMedia) fd.append('removeMedia', 'true');

    if (editingId.value) {
      await inboxStore.updateQuickReply(editingId.value, fd);
    } else {
      await inboxStore.createQuickReply(fd);
    }
    showForm.value = false;
  } catch (err) {
    Swal.fire('Erro', err.response?.data?.message || 'Falha ao salvar', 'error');
  } finally {
    saving.value = false;
  }
}

async function confirmDelete(reply) {
  const result = await Swal.fire({
    title: 'Excluir resposta rápida?',
    text: `"${reply.title}" será removida permanentemente.`,
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
      Swal.fire('Erro', err.response?.data?.message || 'Falha ao excluir', 'error');
    }
  }
}
</script>
