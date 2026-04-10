<template>
  <div class="container py-4" style="max-width:800px;">
    <h4 class="mb-4">Mensagens Automáticas — Chat iFood</h4>

    <div class="alert alert-info small">
      <i class="bi bi-info-circle me-1"></i>
      Configure as mensagens enviadas automaticamente no chat do iFood quando o status do pedido mudar.
      Use <code>{nome}</code> para o nome do cliente e <code>{numero}</code> para o número do pedido.
    </div>

    <!-- Token Section -->
    <div class="card mb-4">
      <div class="card-body">
        <h6 class="card-title">Token da Extensão Chrome</h6>
        <p class="small text-muted">Gere um token para autenticar a extensão do Chrome. Cole-o no popup da extensão.</p>
        <div class="d-flex gap-2">
          <input v-if="token" :value="token" class="form-control form-control-sm" readonly />
          <button class="btn btn-sm btn-primary" @click="generateToken" :disabled="generatingToken">
            {{ generatingToken ? 'Gerando...' : (token ? 'Regenerar Token' : 'Gerar Token') }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="loading" class="text-center py-4">
      <div class="spinner-border text-primary" role="status"></div>
    </div>

    <div v-else>
      <div v-for="msg in messages" :key="msg.status" class="card mb-3">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <h6 class="mb-0">{{ statusLabels[msg.status] || msg.status }}</h6>
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" v-model="msg.enabled" />
              <label class="form-check-label small">{{ msg.enabled ? 'Ativo' : 'Inativo' }}</label>
            </div>
          </div>
          <textarea class="form-control" v-model="msg.message" rows="3"></textarea>
        </div>
      </div>

      <button class="btn btn-success" @click="save" :disabled="saving">
        {{ saving ? 'Salvando...' : 'Salvar Configurações' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import Swal from 'sweetalert2'
import api from '../api'

const loading = ref(true)
const saving = ref(false)
const messages = ref([])
const token = ref('')
const generatingToken = ref(false)

const statusLabels = {
  CONFIRMED: 'Pedido Confirmado',
  DISPATCHED: 'Saiu para Entrega',
  DELIVERED: 'Pedido Entregue',
  MANUAL: 'Mensagem Manual (botão)',
}

onMounted(async () => {
  try {
    const storeId = localStorage.getItem('selectedStoreId')
    if (!storeId) {
      Swal.fire({ icon: 'warning', text: 'Selecione uma loja', toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 })
      return
    }
    const { data } = await api.get(`/ifood-chat/messages/${storeId}`)
    messages.value = data.messages || []
  } catch (e) {
    Swal.fire({ icon: 'error', text: 'Erro ao carregar configurações', toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 })
  } finally {
    loading.value = false
  }
})

async function save() {
  saving.value = true
  try {
    const storeId = localStorage.getItem('selectedStoreId')
    await api.put(`/ifood-chat/messages/${storeId}`, { messages: messages.value })
    Swal.fire({ icon: 'success', text: 'Configurações salvas', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 })
  } catch (e) {
    Swal.fire({ icon: 'error', text: 'Erro ao salvar', toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 })
  } finally {
    saving.value = false
  }
}

async function generateToken() {
  generatingToken.value = true
  try {
    const { data } = await api.post('/ifood-chat/generate-token')
    token.value = data.token
    Swal.fire({ icon: 'success', text: 'Token gerado. Copie e cole na extensão.', toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 })
  } catch (e) {
    Swal.fire({ icon: 'error', text: 'Erro ao gerar token', toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 })
  } finally {
    generatingToken.value = false
  }
}
</script>
