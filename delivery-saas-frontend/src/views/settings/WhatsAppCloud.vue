<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Swal from 'sweetalert2'
import api from '../../api'
import BaseButton from '../../components/BaseButton.vue'
import SelectInput from '../../components/form/select/SelectInput.vue'

// Ported from the legacy MetaIntegrations.vue, stripped down to the WhatsApp
// Cloud API only. Facebook Pages and Instagram Business are out of scope until
// the corresponding OAuth scopes are approved by Meta.
//
// Why the auto-discovery list is often empty
// ─────────────────────────────────────────────
// The post-OAuth callback in metaOauth.js enumerates WABAs via
//   GET /me/businesses → /<businessId>/owned_whatsapp_business_accounts
//                       → /<wabaId>/phone_numbers
// All three calls require the `business_management` permission. Until that
// scope is approved by Meta, the enumeration returns 403 and `waNumbers`
// comes back empty — even though the operator legitimately owns WABAs.
// This screen offers a manual-entry path: paste the Phone Number ID + WABA ID
// from Meta Business Suite and we connect using just the access token already
// issued by the OAuth flow.

const route = useRoute()
const router = useRouter()

const loading = ref(false)
const starting = ref(false)
const submitting = ref(false)
const errorMsg = ref('')
const tempKey = ref(null)

const accounts = ref({ waNumbers: [] })
const menus = ref([])

const connected = ref([])
const loadingConnected = ref(false)

// Selections from the discovered list, keyed by phoneNumberId.
const selectionState = ref({})

// Manual-entry form state (used when auto-discovery returns empty or the
// operator wants to add a WABA the discovery missed).
const manual = ref({
  phoneNumberId: '',
  wabaId: '',
  displayName: '',
  menuId: '',
})

const hasResults = computed(() => (accounts.value.waNumbers?.length || 0) > 0)

const menuOptions = computed(() => [
  { value: '', label: 'Sem cardápio (apenas conectar)' },
  ...menus.value.map(m => ({ value: m.id, label: m.name })),
])

function menuHasEvolution(menuId) {
  if (!menuId) return false
  const m = menus.value.find(x => x.id === menuId)
  return !!(m && m.whatsappInstanceId)
}

function getSel(phoneNumberId) {
  if (!selectionState.value[phoneNumberId]) {
    selectionState.value[phoneNumberId] = { selected: false, menuId: '' }
  }
  return selectionState.value[phoneNumberId]
}

async function loadMenus() {
  try {
    const { data } = await api.get('/menu/menus')
    menus.value = Array.isArray(data) ? data : []
  } catch (e) {
    console.warn('Falha ao carregar cardápios', e)
    menus.value = []
  }
}

async function loadConnected() {
  loadingConnected.value = true
  try {
    const { data } = await api.get('/auth/meta/connected')
    const all = Array.isArray(data?.accounts) ? data.accounts : []
    // Only show WhatsApp accounts on this screen — FB/IG live elsewhere
    // (or simply aren't supported yet).
    connected.value = all.filter(a => a.provider === 'META_WA')
  } catch (e) {
    console.warn('Falha ao carregar conexões WhatsApp', e)
    connected.value = []
  } finally {
    loadingConnected.value = false
  }
}

async function disconnect(account) {
  const label = account.displayName || account.externalId
  const result = await Swal.fire({
    title: 'Desconectar número?',
    text: `Remover ${label}. Os cardápios vinculados perderão o acesso a esse WhatsApp.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Desconectar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc3545',
  })
  if (!result.isConfirmed) return
  try {
    await api.delete(`/auth/meta/connected/${account.id}`)
    await loadConnected()
    Swal.fire({ icon: 'success', text: 'WhatsApp desconectado', timer: 1500, showConfirmButton: false })
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Falha ao desconectar' })
  }
}

async function loadAccounts(temp) {
  loading.value = true
  errorMsg.value = ''
  try {
    const { data } = await api.get('/auth/meta/accounts', { params: { temp } })
    const all = data?.accounts || {}
    accounts.value = { waNumbers: all.waNumbers || [] }
    tempKey.value = temp
  } catch (e) {
    const status = e?.response?.status
    if (status === 404) {
      errorMsg.value = 'A sessão de conexão expirou. Por favor, clique em "Conectar WhatsApp" novamente.'
    } else if (status === 403) {
      errorMsg.value = 'Sessão de conexão inválida.'
    } else {
      errorMsg.value = e?.response?.data?.message || e?.message || 'Falha ao carregar números.'
    }
    tempKey.value = null
  } finally {
    loading.value = false
  }
}

async function startOAuth() {
  starting.value = true
  try {
    const { data } = await api.get('/auth/meta/start')
    if (data?.url) {
      window.location.href = data.url
    } else {
      throw new Error('URL de autorização não retornada')
    }
  } catch (e) {
    starting.value = false
    await Swal.fire({
      icon: 'error',
      title: 'Erro',
      text: e?.response?.data?.message || e?.message || 'Falha ao iniciar conexão WhatsApp',
    })
  }
}

function buildDiscoverySelections() {
  const sels = []
  for (const wa of accounts.value.waNumbers || []) {
    const s = getSel(wa.phoneNumberId)
    if (!s.selected) continue
    sels.push({
      provider: 'META_WA',
      externalId: wa.phoneNumberId,
      displayName: wa.displayPhoneNumber,
      wabaId: wa.wabaId || undefined,
      menuId: s.menuId || undefined,
    })
  }
  return sels
}

function buildManualSelection() {
  const phoneNumberId = manual.value.phoneNumberId.trim()
  const wabaId = manual.value.wabaId.trim()
  if (!phoneNumberId || !wabaId) return null
  return {
    provider: 'META_WA',
    externalId: phoneNumberId,
    wabaId,
    displayName: manual.value.displayName.trim() || phoneNumberId,
    menuId: manual.value.menuId || undefined,
  }
}

async function submitSelections() {
  if (!tempKey.value) return
  const selections = buildDiscoverySelections()
  const manualSel = buildManualSelection()
  if (manualSel) selections.push(manualSel)

  if (!selections.length) {
    await Swal.fire({
      icon: 'info',
      text: 'Selecione um número da lista ou preencha o formulário manual antes de continuar.',
    })
    return
  }

  submitting.value = true
  try {
    const { data } = await api.post('/auth/meta/connect', {
      temp: tempKey.value,
      selections,
    })

    const createdCount = (data?.created || []).length
    const errors = data?.errors || []

    if (errors.length) {
      const detail = errors.map(e => `• ${e.selection?.displayName || e.selection?.externalId}: ${e.error}`).join('<br>')
      await Swal.fire({
        icon: createdCount ? 'warning' : 'error',
        title: createdCount ? 'Conectado com avisos' : 'Erro ao conectar',
        html: `${createdCount ? `<p>${createdCount} número(s) conectado(s).</p>` : ''}<p>Falhas:</p><div style="text-align:left">${detail}</div>`,
      })
    } else {
      await Swal.fire({
        icon: 'success',
        title: 'Pronto!',
        text: `${createdCount} número(s) WhatsApp conectado(s) com sucesso.`,
        timer: 2200,
        showConfirmButton: false,
      })
    }

    router.replace({ path: '/settings/whatsapp-cloud', query: {} })
    tempKey.value = null
    accounts.value = { waNumbers: [] }
    selectionState.value = {}
    manual.value = { phoneNumberId: '', wabaId: '', displayName: '', menuId: '' }
    await Promise.all([loadMenus(), loadConnected()])
  } catch (e) {
    const status = e?.response?.status
    if (status === 400 && e?.response?.data?.error === 'expired') {
      errorMsg.value = 'A sessão de conexão expirou. Por favor, clique em "Conectar WhatsApp" novamente.'
      tempKey.value = null
    } else {
      await Swal.fire({
        icon: 'error',
        title: 'Erro',
        text: e?.response?.data?.message || e?.message || 'Falha ao conectar números.',
      })
    }
  } finally {
    submitting.value = false
  }
}

function cancelSelection() {
  router.replace({ path: '/settings/whatsapp-cloud', query: {} })
  tempKey.value = null
  accounts.value = { waNumbers: [] }
  selectionState.value = {}
  manual.value = { phoneNumberId: '', wabaId: '', displayName: '', menuId: '' }
  errorMsg.value = ''
}

onMounted(async () => {
  await Promise.all([loadMenus(), loadConnected()])

  const err = route.query.error
  if (err) {
    errorMsg.value = `Falha na autorização do WhatsApp: ${decodeURIComponent(String(err))}`
    router.replace({ path: '/settings/whatsapp-cloud', query: {} })
    return
  }

  const temp = route.query.temp
  if (temp) {
    await loadAccounts(String(temp))
  }
})
</script>

<template>
  <div class="container-sm py-4">
    <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-4">
      <div>
        <h4 class="mb-1">WhatsApp Cloud API</h4>
        <small class="text-muted">
          Conecte os números oficiais da sua conta WhatsApp Business para receber e enviar mensagens diretamente no Inbox.
        </small>
      </div>
      <router-link to="/settings/whatsapp-templates" class="btn btn-outline-secondary btn-sm">
        <i class="bi bi-file-earmark-text me-1"></i> Templates de mensagem
      </router-link>
    </div>

    <div v-if="errorMsg" class="alert alert-danger d-flex align-items-start gap-2">
      <i class="bi bi-exclamation-triangle-fill mt-1"></i>
      <div class="flex-grow-1">{{ errorMsg }}</div>
      <button type="button" class="btn-close" aria-label="Fechar" @click="errorMsg = ''"></button>
    </div>

    <!-- Connected numbers -->
    <div v-if="!tempKey && (connected.length || loadingConnected)" class="card shadow-sm mb-4">
      <div class="card-body">
        <div class="d-flex align-items-center justify-content-between mb-3">
          <h6 class="card-title mb-0">
            <i class="bi bi-link-45deg me-1"></i> Números conectados
            <span class="badge bg-light text-dark ms-1">{{ connected.length }}</span>
          </h6>
          <small v-if="loadingConnected" class="text-muted">Carregando...</small>
        </div>

        <div v-if="!connected.length && !loadingConnected" class="text-muted small">
          Nenhum número WhatsApp conectado ainda.
        </div>

        <div class="d-flex flex-column gap-2">
          <div v-for="c in connected" :key="c.id" class="border rounded p-2 d-flex align-items-center gap-2">
            <div class="flex-grow-1">
              <div class="fw-semibold">
                <i class="bi bi-whatsapp text-success me-1"></i>
                {{ c.displayName || c.externalId }}
                <span
                  class="badge ms-1"
                  :class="c.status === 'ACTIVE' && !c.lastError ? 'bg-success' : 'bg-warning text-dark'"
                >
                  {{ c.status === 'ACTIVE' && !c.lastError ? 'Ativo' : 'Atenção' }}
                </span>
              </div>
              <div class="text-muted small">
                <span>Phone ID: {{ c.externalId }}</span>
                <span v-if="c.wabaId"> · WABA: {{ c.wabaId }}</span>
                <span v-if="c.menus && c.menus.length"> · Cardápio: {{ c.menus.map(m => m.name).join(', ') }}</span>
                <span v-else> · Sem cardápio vinculado</span>
              </div>
              <div v-if="c.lastError" class="small text-danger mt-1">
                <i class="bi bi-exclamation-triangle me-1"></i>{{ c.lastError }}
              </div>
            </div>
            <BaseButton variant="outline" size="sm" @click="disconnect(c)">
              <i class="bi bi-x-lg me-1"></i> Desconectar
            </BaseButton>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-5">
      <div class="spinner-border text-primary" role="status"></div>
      <div class="mt-2 text-muted small">Carregando números do WhatsApp...</div>
    </div>

    <!-- Initial state -->
    <div v-else-if="!tempKey" class="card shadow-sm">
      <div class="card-body text-center py-5">
        <div class="mb-3">
          <i class="bi bi-whatsapp" style="font-size: 3rem; color: #25D366;"></i>
        </div>
        <h5 class="mb-2">Conecte um número WhatsApp Cloud</h5>
        <p class="text-muted mb-4">
          Você será redirecionado ao Facebook para autorizar o acesso à sua conta WhatsApp Business. Ao retornar, escolha quais números deseja vincular a cada cardápio.
        </p>
        <BaseButton variant="primary" :loading="starting" @click="startOAuth">
          <i class="bi bi-whatsapp me-1"></i> Conectar WhatsApp
        </BaseButton>
        <div class="mt-4 text-start mx-auto" style="max-width: 520px;">
          <h6 class="mb-2"><i class="bi bi-info-circle me-1"></i> Pré-requisitos</h6>
          <ul class="text-muted small mb-0">
            <li>Conta WhatsApp Business registrada no <a href="https://business.facebook.com" target="_blank" rel="noopener">Meta Business Suite</a>.</li>
            <li>Número de telefone verificado e ativo na WABA (WhatsApp Business Account).</li>
            <li>Permissão de administrador na Business Account.</li>
          </ul>
        </div>
      </div>
    </div>

    <!-- Selection state -->
    <div v-else>
      <div v-if="!hasResults" class="alert alert-warning">
        <div class="d-flex align-items-start gap-2">
          <i class="bi bi-exclamation-triangle mt-1"></i>
          <div>
            <strong>Não encontramos números na sua conta.</strong>
            <div class="small mt-1">
              Verifique se a conta Facebook usada no login tem permissão de administrador em alguma WhatsApp Business Account. Você também pode conectar manualmente abaixo — pegue o <strong>Phone Number ID</strong> e o <strong>WABA ID</strong> no Meta Business Suite.
            </div>
          </div>
        </div>
      </div>

      <div v-else class="alert alert-info d-flex align-items-start gap-2">
        <i class="bi bi-check-circle-fill mt-1"></i>
        <div>
          Autenticação concluída. Selecione os números que deseja conectar e vincule cada um a um cardápio.
        </div>
      </div>

      <!-- Auto-discovered WhatsApp numbers (often empty without business_management) -->
      <div v-if="accounts.waNumbers?.length" class="card shadow-sm mb-3">
        <div class="card-body">
          <h6 class="card-title mb-3">
            <i class="bi bi-whatsapp text-success me-1"></i> Números encontrados
            <span class="badge bg-light text-dark ms-1">{{ accounts.waNumbers.length }}</span>
          </h6>
          <div class="d-flex flex-column gap-3">
            <div v-for="wa in accounts.waNumbers" :key="wa.phoneNumberId" class="border rounded p-3">
              <div class="row g-3 align-items-center">
                <div class="col-12 col-md-5">
                  <div class="form-check">
                    <input
                      :id="`wa-${wa.phoneNumberId}`"
                      class="form-check-input"
                      type="checkbox"
                      v-model="getSel(wa.phoneNumberId).selected"
                    />
                    <label class="form-check-label" :for="`wa-${wa.phoneNumberId}`">
                      <div class="fw-semibold">{{ wa.displayPhoneNumber }}</div>
                      <div class="text-muted small">WABA: {{ wa.wabaId }}</div>
                    </label>
                  </div>
                </div>
                <div class="col-12 col-md-7">
                  <label class="form-label small mb-1">Vincular ao cardápio</label>
                  <SelectInput
                    v-model="getSel(wa.phoneNumberId).menuId"
                    :options="menuOptions"
                    :disabled="!getSel(wa.phoneNumberId).selected"
                  />
                  <div
                    v-if="getSel(wa.phoneNumberId).selected && menuHasEvolution(getSel(wa.phoneNumberId).menuId)"
                    class="alert alert-warning mt-2 mb-0 py-2 small"
                  >
                    <i class="bi bi-exclamation-triangle me-1"></i>
                    Este cardápio já recebe mensagens via Evolution. Ao ativar o WhatsApp Cloud, mensagens novas chegarão por ambos. Envios proativos usarão o canal oficial (Cloud API).
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Manual entry -->
      <div class="card shadow-sm mb-3">
        <div class="card-body">
          <h6 class="card-title mb-3">
            <i class="bi bi-keyboard me-1"></i> Adicionar número manualmente
          </h6>
          <p class="small text-muted">
            No <a href="https://business.facebook.com" target="_blank" rel="noopener">Meta Business Suite</a>, abra <em>WhatsApp Manager → Configurações da API → Configuração</em> e copie os IDs.
          </p>
          <div class="row g-3">
            <div class="col-12 col-md-6">
              <label class="form-label small mb-1">Phone Number ID <span class="text-danger">*</span></label>
              <input
                v-model="manual.phoneNumberId"
                type="text"
                class="form-control"
                placeholder="123456789012345"
              />
            </div>
            <div class="col-12 col-md-6">
              <label class="form-label small mb-1">WABA ID <span class="text-danger">*</span></label>
              <input
                v-model="manual.wabaId"
                type="text"
                class="form-control"
                placeholder="987654321098765"
              />
            </div>
            <div class="col-12 col-md-6">
              <label class="form-label small mb-1">Nome amigável <span class="text-muted">(opcional)</span></label>
              <input
                v-model="manual.displayName"
                type="text"
                class="form-control"
                placeholder="WhatsApp Loja Centro"
              />
            </div>
            <div class="col-12 col-md-6">
              <label class="form-label small mb-1">Vincular ao cardápio</label>
              <SelectInput
                v-model="manual.menuId"
                :options="menuOptions"
              />
              <div
                v-if="manual.menuId && menuHasEvolution(manual.menuId)"
                class="alert alert-warning mt-2 mb-0 py-2 small"
              >
                <i class="bi bi-exclamation-triangle me-1"></i>
                Este cardápio já recebe mensagens via Evolution. Ao ativar o WhatsApp Cloud, mensagens novas chegarão por ambos. Envios proativos usarão o canal oficial (Cloud API).
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="d-flex justify-content-end gap-2 mt-4">
        <BaseButton variant="outline" :disabled="submitting" @click="cancelSelection">
          Cancelar
        </BaseButton>
        <BaseButton variant="primary" :loading="submitting" @click="submitSelections">
          <i class="bi bi-check2 me-1"></i> Conectar
        </BaseButton>
      </div>
    </div>
  </div>
</template>
