<script setup>
import { ref, computed } from 'vue';
import Swal from 'sweetalert2';
import api from '../api';
import { API_URL } from '../config';

// Placeholder URLs — operator will configure once installers are uploaded.
const WIN_INSTALLER_URL = '/downloads/DeliveryIfoodAgent-Setup-latest.exe';
const MAC_INSTALLER_URL = '/downloads/DeliveryIfoodAgent-latest.dmg';

const agentToken = ref('');
const agentCompanyId = ref('');
const generating = ref(false);
const errorMsg = ref('');

const backendUrl = computed(() => API_URL || window.location.origin);

async function generateAgentToken() {
  generating.value = true;
  errorMsg.value = '';
  try {
    const { data } = await api.post('/ifood-chat/generate-agent-token');
    agentToken.value = data.token;
    agentCompanyId.value = data.companyId;
    Swal.fire({ icon: 'success', text: 'Token gerado. Copie e cole no app desktop.', toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 });
  } catch (e) {
    errorMsg.value = e?.response?.data?.message || e?.message || 'Erro ao gerar token';
    Swal.fire({ icon: 'error', text: 'Erro ao gerar token', toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 });
  } finally {
    generating.value = false;
  }
}

async function copyToClipboard(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    Swal.fire({ icon: 'success', text: 'Copiado!', toast: true, position: 'top-end', showConfirmButton: false, timer: 1000 });
  } catch (e) {
    const tmp = document.createElement('input');
    tmp.value = text;
    document.body.appendChild(tmp);
    tmp.select();
    document.execCommand('copy');
    tmp.remove();
  }
}
</script>

<template>
  <div>
    <!-- Header -->
    <div class="d-flex align-items-center justify-content-between mb-4">
      <div class="d-flex align-items-center gap-3">
        <img src="https://logodownload.org/wp-content/uploads/2017/05/ifood-logo-0.png" alt="iFood" style="height:36px" />
        <div>
          <h4 class="mb-0">Agente iFood (App Desktop)</h4>
          <p class="text-muted small mb-0">
            Aplicativo desktop que substitui a extensão Chrome para enviar mensagens automáticas no chat do iFood.
          </p>
        </div>
      </div>
    </div>

    <!-- Section: Token -->
    <div class="card mb-4">
      <div class="card-body">
        <h6 class="card-title">
          <i class="bi bi-key me-1"></i>Token de autenticação
        </h6>
        <p class="small text-muted mb-3">
          Gere um token para configurar o app desktop. Use esses três valores no painel de configuração do aplicativo.
        </p>

        <button class="btn btn-sm btn-primary mb-3" @click="generateAgentToken" :disabled="generating">
          <span v-if="generating" class="spinner-border spinner-border-sm me-2" role="status"></span>
          {{ generating ? 'Gerando...' : (agentToken ? 'Regenerar token' : 'Gerar novo token') }}
        </button>

        <div v-if="errorMsg" class="alert alert-danger py-2 small">{{ errorMsg }}</div>

        <div v-if="agentToken">
          <div class="alert alert-warning py-2 small mb-3">
            <i class="bi bi-exclamation-triangle me-1"></i>
            Copie o token agora — ele <strong>não será exibido novamente</strong>. Caso perca, gere um novo.
          </div>

          <div class="mb-2">
            <label class="form-label small fw-semibold mb-1">URL do Backend</label>
            <div class="d-flex gap-2">
              <input :value="backendUrl" class="form-control form-control-sm" readonly />
              <button class="btn btn-sm btn-outline-secondary" @click="copyToClipboard(backendUrl)" title="Copiar">
                <i class="bi bi-clipboard"></i>
              </button>
            </div>
          </div>

          <div class="mb-2">
            <label class="form-label small fw-semibold mb-1">Token do App</label>
            <div class="d-flex gap-2">
              <input :value="agentToken" class="form-control form-control-sm font-monospace" readonly />
              <button class="btn btn-sm btn-outline-secondary" @click="copyToClipboard(agentToken)" title="Copiar">
                <i class="bi bi-clipboard"></i>
              </button>
            </div>
          </div>

          <div class="mb-2">
            <label class="form-label small fw-semibold mb-1">Company ID</label>
            <div class="d-flex gap-2">
              <input :value="agentCompanyId" class="form-control form-control-sm" readonly />
              <button class="btn btn-sm btn-outline-secondary" @click="copyToClipboard(agentCompanyId)" title="Copiar">
                <i class="bi bi-clipboard"></i>
              </button>
            </div>
          </div>

          <p class="small text-muted mt-2 mb-0">Cole esses três valores nos campos de configuração do app desktop.</p>
        </div>
      </div>
    </div>

    <!-- Section: Installation -->
    <div class="card mb-4">
      <div class="card-body">
        <h6 class="card-title">
          <i class="bi bi-download me-1"></i>Instalação
        </h6>
        <p class="small text-muted mb-3">Baixe o instalador adequado para o seu sistema operacional.</p>

        <div class="row g-3">
          <div class="col-md-6">
            <div class="card h-100 border-secondary">
              <div class="card-body text-center">
                <i class="bi bi-windows" style="font-size: 2.5rem; color: #0078d4"></i>
                <h6 class="mt-2 mb-1">Windows</h6>
                <p class="small text-muted mb-3">Windows 10 ou superior (64-bit)</p>
                <a :href="WIN_INSTALLER_URL" class="btn btn-primary btn-sm">
                  <i class="bi bi-download me-1"></i>Baixar instalador (.exe)
                </a>
              </div>
            </div>
          </div>

          <div class="col-md-6">
            <div class="card h-100 border-secondary">
              <div class="card-body text-center">
                <i class="bi bi-apple" style="font-size: 2.5rem; color: #555"></i>
                <h6 class="mt-2 mb-1">macOS</h6>
                <p class="small text-muted mb-3">macOS 11 (Big Sur) ou superior</p>
                <a :href="MAC_INSTALLER_URL" class="btn btn-primary btn-sm">
                  <i class="bi bi-download me-1"></i>Baixar instalador (.dmg)
                </a>
              </div>
            </div>
          </div>
        </div>

        <div class="mt-4">
          <h6 class="small fw-semibold mb-2">Como instalar e configurar:</h6>
          <ol class="small text-muted mb-0">
            <li>Baixe e instale o aplicativo.</li>
            <li>Abra o app desktop.</li>
            <li>Preencha a URL do backend, o token e o ID da empresa gerados acima.</li>
            <li>Mantenha o app aberto durante o expediente.</li>
          </ol>
        </div>
      </div>
    </div>

    <!-- Section: Coexistence -->
    <div class="card mb-4">
      <div class="card-body">
        <h6 class="card-title">
          <i class="bi bi-info-circle me-1"></i>Coexistência com a extensão Chrome
        </h6>
        <p class="small text-muted mb-0">
          Durante 2 meses (até 2026-07-20) o app desktop e a extensão Chrome funcionam em paralelo.
          Você pode rodar ambos sem duplicação — o sistema garante envio único por pedido.
        </p>
      </div>
    </div>
  </div>
</template>
