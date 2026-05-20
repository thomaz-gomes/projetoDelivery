<script setup>
import { ref, computed, onMounted } from 'vue';
import Swal from 'sweetalert2';
import api from '../api';
import { API_URL } from '../config';
import { useAgentStatus } from '../composables/useAgentStatus';

// Placeholder URLs — operator will configure once installers are uploaded.
const WIN_INSTALLER_URL = '/downloads/ifood-agent/DeliveryIfoodAgent-Setup-1.0.0.exe';
const MAC_INSTALLER_URL = '/downloads/ifood-agent/DeliveryIfoodAgent-latest.dmg';

const agentToken = ref('');
const agentCompanyId = ref('');
const generating = ref(false);
const deactivating = ref(false);
const errorMsg = ref('');

const backendUrl = computed(() => API_URL || window.location.origin);

const agentStatus = useAgentStatus();
onMounted(() => { agentStatus.fetch(); });

const statusBadgeClass = computed(() => {
  if (!agentStatus.hasAgentToken.value && !agentStatus.hasExtensionToken.value) return 'bg-secondary';
  if (agentStatus.isOnline.value) return 'bg-success';
  return 'bg-warning text-dark';
});
const statusBadgeLabel = computed(() => {
  if (!agentStatus.hasAgentToken.value && !agentStatus.hasExtensionToken.value) return 'Não configurado';
  if (agentStatus.isOnline.value) return 'Online';
  if (agentStatus.lastSeenAt.value === null) return 'Nunca conectou';
  return 'Offline';
});

async function generateAgentToken() {
  generating.value = true;
  errorMsg.value = '';
  try {
    const { data } = await api.post('/ifood-chat/generate-agent-token');
    agentToken.value = data.token;
    agentCompanyId.value = data.companyId;
    await agentStatus.fetch();
    Swal.fire({ icon: 'success', text: 'Token gerado. Copie e cole no app desktop.', toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 });
  } catch (e) {
    errorMsg.value = e?.response?.data?.message || e?.message || 'Erro ao gerar token';
    Swal.fire({ icon: 'error', text: 'Erro ao gerar token', toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 });
  } finally {
    generating.value = false;
  }
}

async function deactivate(alsoRevokeExtension) {
  const confirmText = alsoRevokeExtension
    ? 'Isso vai revogar tanto o token do app desktop quanto o token da extensão Chrome. As mensagens automáticas deixarão de ser enviadas. Continuar?'
    : 'Isso vai revogar apenas o token do app desktop. A extensão Chrome (se houver) continua funcionando. Continuar?';
  const res = await Swal.fire({
    title: alsoRevokeExtension ? 'Desativar integração completa?' : 'Desativar app desktop?',
    text: confirmText,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sim, desativar',
    cancelButtonText: 'Cancelar',
  });
  if (!res.isConfirmed) return;

  deactivating.value = true;
  errorMsg.value = '';
  try {
    await api.post('/ifood-chat/deactivate-agent', { alsoRevokeExtension });
    agentToken.value = '';
    agentCompanyId.value = '';
    await agentStatus.fetch();
    Swal.fire({ icon: 'success', text: 'Integração desativada.', toast: true, position: 'top-end', showConfirmButton: false, timer: 2500 });
  } catch (e) {
    errorMsg.value = e?.response?.data?.message || e?.message || 'Erro ao desativar';
    Swal.fire({ icon: 'error', text: 'Erro ao desativar', toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 });
  } finally {
    deactivating.value = false;
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
  <div class="container-fluid px-3 px-md-4 py-3">
    <!-- Banner: cliente offline há 24h+ -->
    <div v-if="agentStatus.banner.value === 'never-connected'" class="alert alert-warning d-flex align-items-start gap-2 mb-4" role="alert">
      <i class="bi bi-exclamation-triangle-fill mt-1"></i>
      <div>
        <div class="fw-semibold">Nenhum cliente do iFood Chat conectou ainda</div>
        <div class="small mb-0">
          Nem a extensão Chrome nem o app Agente iFood se conectaram. Mensagens automáticas não serão enviadas. Instale o app e abra-o para começar.
        </div>
      </div>
    </div>
    <div v-else-if="agentStatus.banner.value === 'stale'" class="alert alert-warning d-flex align-items-start gap-2 mb-4" role="alert">
      <i class="bi bi-exclamation-triangle-fill mt-1"></i>
      <div>
        <div class="fw-semibold">Agente iFood offline há {{ agentStatus.hoursSinceLastSeen.value }} h</div>
        <div class="small mb-0">
          A última conexão da extensão Chrome ou do app Agente iFood foi há
          <strong>{{ agentStatus.hoursSinceLastSeen.value }}h</strong>
          (em {{ agentStatus.formatLastSeen() }}). Reabra o app para retomar os envios automáticos.
        </div>
      </div>
    </div>

    <!-- Header -->
    <div class="d-flex align-items-center justify-content-between flex-wrap gap-3 mb-4">
      <div class="d-flex align-items-center gap-3">
        <img src="https://logodownload.org/wp-content/uploads/2017/05/ifood-logo-0.png" alt="iFood" style="height:36px" />
        <div>
          <h4 class="mb-0">Agente iFood (App Desktop)</h4>
          <p class="text-muted small mb-0">
            Aplicativo desktop que substitui a extensão Chrome para enviar mensagens automáticas no chat do iFood.
          </p>
        </div>
      </div>
      <span :class="['badge', 'fs-6', 'px-3', 'py-2', statusBadgeClass]">{{ statusBadgeLabel }}</span>
    </div>

    <!-- Section: Status -->
    <div class="card mb-4">
      <div class="card-body">
        <h6 class="card-title">
          <i class="bi bi-activity me-1"></i>Status da integração
        </h6>

        <div class="row g-3 mt-1">
          <div class="col-md-4">
            <div class="text-muted small">App Desktop</div>
            <div>
              <span :class="['badge', agentStatus.hasAgentToken.value ? 'bg-success' : 'bg-secondary']">
                {{ agentStatus.hasAgentToken.value ? 'Configurado' : 'Não configurado' }}
              </span>
            </div>
          </div>
          <div class="col-md-4">
            <div class="text-muted small">Extensão Chrome</div>
            <div>
              <span :class="['badge', agentStatus.hasExtensionToken.value ? 'bg-success' : 'bg-secondary']">
                {{ agentStatus.hasExtensionToken.value ? 'Configurada' : 'Não configurada' }}
              </span>
            </div>
          </div>
          <div class="col-md-4">
            <div class="text-muted small">Última conexão</div>
            <div v-if="agentStatus.lastSeenAt.value">
              {{ agentStatus.formatLastSeen() }}
              <span class="text-muted small">({{ agentStatus.hoursSinceLastSeen.value }}h atrás)</span>
            </div>
            <div v-else class="text-muted">—</div>
          </div>
        </div>

        <div v-if="agentStatus.hasAgentToken.value || agentStatus.hasExtensionToken.value" class="mt-3 pt-3 border-top">
          <div class="d-flex flex-wrap gap-2">
            <button
              class="btn btn-sm btn-outline-danger"
              :disabled="deactivating || !agentStatus.hasAgentToken.value"
              @click="deactivate(false)"
            >
              <span v-if="deactivating" class="spinner-border spinner-border-sm me-1" role="status"></span>
              <i v-else class="bi bi-power me-1"></i>
              Desativar app desktop
            </button>
            <button
              class="btn btn-sm btn-outline-danger"
              :disabled="deactivating || (!agentStatus.hasAgentToken.value && !agentStatus.hasExtensionToken.value)"
              @click="deactivate(true)"
            >
              <i class="bi bi-x-octagon me-1"></i>
              Desativar tudo (app + extensão)
            </button>
          </div>
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
          {{ generating ? 'Gerando...' : (agentStatus.hasAgentToken.value ? 'Regenerar token' : 'Gerar novo token') }}
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
