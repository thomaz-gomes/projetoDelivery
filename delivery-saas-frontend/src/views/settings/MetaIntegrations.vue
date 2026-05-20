<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Swal from 'sweetalert2'
import api from '../../api'
import BaseButton from '../../components/BaseButton.vue'
import SelectInput from '../../components/form/select/SelectInput.vue'

const route = useRoute()
const router = useRouter()

const loading = ref(false)
const starting = ref(false)
const submitting = ref(false)
const expiresIn = ref(null)
const errorMsg = ref('')
const tempKey = ref(null)

const accounts = ref({ pages: [], igAccounts: [], waNumbers: [] })
const menus = ref([])

// Already-connected accounts for this tenant, grouped for display.
const connected = ref([])
const loadingConnected = ref(false)

// selections keyed by `${provider}:${externalId}` → { selected, menuId }
const selectionState = ref({})

const connectedByProvider = computed(() => {
  const groups = { META_FB: [], META_IG: [], META_WA: [] }
  for (const c of connected.value) {
    if (groups[c.provider]) groups[c.provider].push(c)
  }
  return groups
})

const providerLabel = {
  META_FB: { name: 'Facebook', icon: 'bi-facebook' },
  META_IG: { name: 'Instagram', icon: 'bi-instagram' },
  META_WA: { name: 'WhatsApp Cloud', icon: 'bi-whatsapp' },
}

const hasResults = computed(() =>
  (accounts.value.pages?.length || 0) +
  (accounts.value.igAccounts?.length || 0) +
  (accounts.value.waNumbers?.length || 0) > 0
)

const menuOptions = computed(() => {
  return [
    { value: '', label: 'Sem cardápio (apenas conectar)' },
    ...menus.value.map(m => ({ value: m.id, label: m.name }))
  ]
})

function menuHasEvolution(menuId) {
  if (!menuId) return false
  const m = menus.value.find(x => x.id === menuId)
  return !!(m && m.whatsappInstanceId)
}

function selKey(provider, externalId) {
  return `${provider}:${externalId}`
}

function getSel(provider, externalId) {
  const key = selKey(provider, externalId)
  if (!selectionState.value[key]) {
    selectionState.value[key] = { selected: false, menuId: '' }
  }
  return selectionState.value[key]
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
    connected.value = Array.isArray(data?.accounts) ? data.accounts : []
  } catch (e) {
    console.warn('Falha ao carregar integrações conectadas', e)
    connected.value = []
  } finally {
    loadingConnected.value = false
  }
}

async function disconnect(account) {
  const label = account.displayName || account.externalId
  const result = await Swal.fire({
    title: 'Desconectar integração?',
    text: `Remover ${label}. Os cardápios vinculados perderão o acesso a essa conta.`,
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
    Swal.fire({ icon: 'success', text: 'Integração removida', timer: 1500, showConfirmButton: false })
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Falha ao desconectar' })
  }
}

async function loadAccounts(temp) {
  loading.value = true
  errorMsg.value = ''
  try {
    const { data } = await api.get('/auth/meta/accounts', { params: { temp } })
    accounts.value = data?.accounts || { pages: [], igAccounts: [], waNumbers: [] }
    expiresIn.value = data?.expiresIn || null
    tempKey.value = temp
  } catch (e) {
    const status = e?.response?.status
    if (status === 404) {
      errorMsg.value = 'A sessão de conexão expirou. Por favor, clique em "Conectar Meta" novamente.'
    } else if (status === 403) {
      errorMsg.value = 'Sessão de conexão inválida.'
    } else {
      errorMsg.value = e?.response?.data?.message || e?.message || 'Falha ao carregar contas.'
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
      text: e?.response?.data?.message || e?.message || 'Falha ao iniciar conexão Meta'
    })
  }
}

function buildSelections() {
  const selections = []
  for (const p of accounts.value.pages || []) {
    const s = getSel('META_FB', p.id)
    if (!s.selected) continue
    selections.push({
      provider: 'META_FB',
      externalId: p.id,
      displayName: p.name,
      menuId: s.menuId || undefined,
    })
  }
  for (const ig of accounts.value.igAccounts || []) {
    const s = getSel('META_IG', ig.id)
    if (!s.selected) continue
    selections.push({
      provider: 'META_IG',
      externalId: ig.id,
      displayName: ig.username,
      fbPageId: ig.fbPageId || undefined,
      menuId: s.menuId || undefined,
    })
  }
  for (const wa of accounts.value.waNumbers || []) {
    const s = getSel('META_WA', wa.phoneNumberId)
    if (!s.selected) continue
    selections.push({
      provider: 'META_WA',
      externalId: wa.phoneNumberId,
      displayName: wa.displayPhoneNumber,
      wabaId: wa.wabaId || undefined,
      menuId: s.menuId || undefined,
    })
  }
  return selections
}

async function submitSelections() {
  if (!tempKey.value) return
  const selections = buildSelections()
  if (!selections.length) {
    await Swal.fire({ icon: 'info', text: 'Selecione pelo menos uma conta para conectar.' })
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
        html: `${createdCount ? `<p>${createdCount} conta(s) conectada(s).</p>` : ''}<p>Falhas:</p><div style="text-align:left">${detail}</div>`,
      })
    } else {
      await Swal.fire({
        icon: 'success',
        title: 'Pronto!',
        text: `${createdCount} conta(s) Meta conectada(s) com sucesso.`,
        timer: 2200,
        showConfirmButton: false,
      })
    }

    // Clean URL and reset state so the page returns to the initial screen.
    router.replace({ path: '/settings/meta-integrations', query: {} })
    tempKey.value = null
    accounts.value = { pages: [], igAccounts: [], waNumbers: [] }
    selectionState.value = {}
    await Promise.all([loadMenus(), loadConnected()])
  } catch (e) {
    const status = e?.response?.status
    if (status === 400 && e?.response?.data?.error === 'expired') {
      errorMsg.value = 'A sessão de conexão expirou. Por favor, clique em "Conectar Meta" novamente.'
      tempKey.value = null
    } else {
      await Swal.fire({
        icon: 'error',
        title: 'Erro',
        text: e?.response?.data?.message || e?.message || 'Falha ao conectar contas.',
      })
    }
  } finally {
    submitting.value = false
  }
}

function cancelSelection() {
  router.replace({ path: '/settings/meta-integrations', query: {} })
  tempKey.value = null
  accounts.value = { pages: [], igAccounts: [], waNumbers: [] }
  selectionState.value = {}
  errorMsg.value = ''
}

onMounted(async () => {
  await Promise.all([loadMenus(), loadConnected()])

  // Handle OAuth callback error from URL.
  const err = route.query.error
  if (err) {
    errorMsg.value = `Falha na autorização Meta: ${decodeURIComponent(String(err))}`
    router.replace({ path: '/settings/meta-integrations', query: {} })
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
        <h4 class="mb-1">Integrações Meta</h4>
        <small class="text-muted">
          Conecte páginas do Facebook, contas do Instagram Business e números do WhatsApp Cloud para receber mensagens diretamente no Inbox.
        </small>
      </div>
    </div>

    <!-- Error banner -->
    <div v-if="errorMsg" class="alert alert-danger d-flex align-items-start gap-2">
      <i class="bi bi-exclamation-triangle-fill mt-1"></i>
      <div class="flex-grow-1">{{ errorMsg }}</div>
      <button type="button" class="btn-close" aria-label="Fechar" @click="errorMsg = ''"></button>
    </div>

    <!-- Connected integrations: visible whenever something is linked, so the
         user always sees current status without re-running OAuth. -->
    <div v-if="!tempKey && (connected.length || loadingConnected)" class="card shadow-sm mb-4">
      <div class="card-body">
        <div class="d-flex align-items-center justify-content-between mb-3">
          <h6 class="card-title mb-0">
            <i class="bi bi-link-45deg me-1"></i> Integrações ativas
            <span class="badge bg-light text-dark ms-1">{{ connected.length }}</span>
          </h6>
          <small v-if="loadingConnected" class="text-muted">Carregando...</small>
        </div>

        <div v-if="!connected.length && !loadingConnected" class="text-muted small">
          Nenhuma integração conectada ainda.
        </div>

        <template v-for="provider in ['META_FB', 'META_IG', 'META_WA']" :key="provider">
          <div v-if="connectedByProvider[provider].length" class="mb-3">
            <div class="text-muted small text-uppercase mb-2" style="letter-spacing: 0.04em;">
              <i :class="['bi', providerLabel[provider].icon, 'me-1']"></i>
              {{ providerLabel[provider].name }}
            </div>
            <div class="d-flex flex-column gap-2">
              <div v-for="c in connectedByProvider[provider]" :key="c.id" class="border rounded p-2 d-flex align-items-center gap-2">
                <div class="flex-grow-1">
                  <div class="fw-semibold">
                    {{ provider === 'META_IG' ? '@' + (c.displayName || c.externalId) : (c.displayName || c.externalId) }}
                    <span
                      class="badge ms-1"
                      :class="c.status === 'ACTIVE' && !c.lastError ? 'bg-success' : 'bg-warning text-dark'"
                    >
                      {{ c.status === 'ACTIVE' && !c.lastError ? 'Ativo' : 'Atenção' }}
                    </span>
                  </div>
                  <div class="text-muted small">
                    <span>ID: {{ c.externalId }}</span>
                    <span v-if="provider === 'META_WA' && c.wabaId"> · WABA: {{ c.wabaId }}</span>
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
        </template>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-5">
      <div class="spinner-border text-primary" role="status"></div>
      <div class="mt-2 text-muted small">Carregando contas Meta...</div>
    </div>

    <!-- Initial state: not connected, show "Conectar Meta" button -->
    <div v-else-if="!tempKey" class="card shadow-sm">
      <div class="card-body text-center py-5">
        <div class="mb-3">
          <i class="bi bi-meta" style="font-size: 3rem; color: var(--primary);"></i>
        </div>
        <h5 class="mb-2">Conecte sua conta Meta</h5>
        <p class="text-muted mb-4">
          Você será redirecionado ao Facebook para autorizar o acesso. Ao retornar, escolha quais páginas, contas Instagram e números WhatsApp deseja conectar a cada cardápio.
        </p>
        <BaseButton variant="primary" :loading="starting" @click="startOAuth">
          <i class="bi bi-facebook me-1"></i> Conectar Meta
        </BaseButton>
        <div class="mt-4 text-start">
          <h6 class="mb-2"><i class="bi bi-info-circle me-1"></i> O que será conectado</h6>
          <ul class="text-muted small mb-0">
            <li><strong>Facebook Messenger</strong> — receba mensagens das páginas que você administra.</li>
            <li><strong>Instagram Direct</strong> — mensagens enviadas para suas contas Instagram Business.</li>
            <li><strong>WhatsApp Cloud API</strong> — números oficiais registrados na sua conta WhatsApp Business.</li>
          </ul>
        </div>
      </div>
    </div>

    <!-- Selection state: temp key loaded, accounts ready -->
    <div v-else>
      <div v-if="!hasResults" class="alert alert-warning">
        <i class="bi bi-exclamation-triangle me-1"></i>
        Nenhuma conta Meta disponível foi encontrada. Verifique se a sua conta Facebook tem permissões para alguma Página, Instagram Business ou número WhatsApp Business.
        <div class="mt-2">
          <BaseButton variant="outline" size="sm" @click="cancelSelection">Voltar</BaseButton>
        </div>
      </div>

      <template v-else>
        <div class="alert alert-info d-flex align-items-start gap-2">
          <i class="bi bi-check-circle-fill mt-1"></i>
          <div>
            Autenticação concluída. Selecione abaixo quais contas deseja conectar e vincule cada uma a um cardápio.
          </div>
        </div>

        <!-- Facebook Pages -->
        <div v-if="accounts.pages?.length" class="card shadow-sm mb-3">
          <div class="card-body">
            <h6 class="card-title mb-3">
              <i class="bi bi-facebook me-1"></i> Páginas do Facebook
              <span class="badge bg-light text-dark ms-1">{{ accounts.pages.length }}</span>
            </h6>
            <div class="d-flex flex-column gap-3">
              <div v-for="p in accounts.pages" :key="p.id" class="border rounded p-3">
                <div class="row g-3 align-items-center">
                  <div class="col-12 col-md-5">
                    <div class="form-check">
                      <input
                        :id="`fb-${p.id}`"
                        class="form-check-input"
                        type="checkbox"
                        v-model="getSel('META_FB', p.id).selected"
                      />
                      <label class="form-check-label" :for="`fb-${p.id}`">
                        <div class="fw-semibold">{{ p.name }}</div>
                        <div class="text-muted small">ID: {{ p.id }}</div>
                      </label>
                    </div>
                  </div>
                  <div class="col-12 col-md-7">
                    <label class="form-label small mb-1">Vincular ao cardápio</label>
                    <SelectInput
                      v-model="getSel('META_FB', p.id).menuId"
                      :options="menuOptions"
                      :disabled="!getSel('META_FB', p.id).selected"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Instagram Business -->
        <div v-if="accounts.igAccounts?.length" class="card shadow-sm mb-3">
          <div class="card-body">
            <h6 class="card-title mb-3">
              <i class="bi bi-instagram me-1"></i> Contas Instagram Business
              <span class="badge bg-light text-dark ms-1">{{ accounts.igAccounts.length }}</span>
            </h6>
            <div class="d-flex flex-column gap-3">
              <div v-for="ig in accounts.igAccounts" :key="ig.id" class="border rounded p-3">
                <div class="row g-3 align-items-center">
                  <div class="col-12 col-md-5">
                    <div class="form-check">
                      <input
                        :id="`ig-${ig.id}`"
                        class="form-check-input"
                        type="checkbox"
                        v-model="getSel('META_IG', ig.id).selected"
                      />
                      <label class="form-check-label" :for="`ig-${ig.id}`">
                        <div class="fw-semibold">@{{ ig.username }}</div>
                        <div class="text-muted small">ID: {{ ig.id }}</div>
                      </label>
                    </div>
                  </div>
                  <div class="col-12 col-md-7">
                    <label class="form-label small mb-1">Vincular ao cardápio</label>
                    <SelectInput
                      v-model="getSel('META_IG', ig.id).menuId"
                      :options="menuOptions"
                      :disabled="!getSel('META_IG', ig.id).selected"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- WhatsApp Business -->
        <div v-if="accounts.waNumbers?.length" class="card shadow-sm mb-3">
          <div class="card-body">
            <h6 class="card-title mb-3">
              <i class="bi bi-whatsapp me-1"></i> WhatsApp Business (Cloud API)
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
                        v-model="getSel('META_WA', wa.phoneNumberId).selected"
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
                      v-model="getSel('META_WA', wa.phoneNumberId).menuId"
                      :options="menuOptions"
                      :disabled="!getSel('META_WA', wa.phoneNumberId).selected"
                    />
                    <div
                      v-if="getSel('META_WA', wa.phoneNumberId).selected && menuHasEvolution(getSel('META_WA', wa.phoneNumberId).menuId)"
                      class="alert alert-warning mt-2 mb-0 py-2 small"
                    >
                      <i class="bi bi-exclamation-triangle me-1"></i>
                      Este cardápio já recebe WhatsApp via Evolution. Ao ativar Meta Cloud, mensagens novas chegarão por ambos. Outbound proativo usará Meta Cloud (oficial).
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Actions footer -->
        <div class="d-flex justify-content-end gap-2 mt-4">
          <BaseButton variant="outline" :disabled="submitting" @click="cancelSelection">
            Cancelar
          </BaseButton>
          <BaseButton variant="primary" :loading="submitting" @click="submitSelections">
            <i class="bi bi-check2 me-1"></i> Conectar selecionados
          </BaseButton>
        </div>
      </template>
    </div>
  </div>
</template>
