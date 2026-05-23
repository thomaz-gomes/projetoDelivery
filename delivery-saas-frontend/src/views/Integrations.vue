<script setup>
import { onMounted, ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import api from '../api';
import ListCard from '../components/ListCard.vue';
import { formatDateTime } from '../utils/dates.js';
import Swal from 'sweetalert2'

const router = useRouter();

const loading = ref(false)
const error = ref('')

// filters & pagination
const q = ref('')
const filterEnabled = ref('')
const limit = ref(20)
const offset = ref(0)
const total = ref(0)

const integrations = ref([])
const metaPixels = ref([])
const waCloudAccounts = ref([]) // WhatsApp Cloud API connections (provider === 'META_WA')
const waEvolutionInstances = ref([]) // legacy WhatsApp Evolution (Baileys) instances
const stores = ref([])
const menus = ref([])
const ifoodAgentStatus = ref(null) // { hasAgentToken, hasExtensionToken, isOnline, lastSeenAt }

// modal for choosing integration type
const showTypeModal = ref(false)

const integrationTypes = [
  {
    key: 'IFOOD',
    name: 'iFood',
    description: 'Receba pedidos do iFood automaticamente na sua central.',
    icon: 'https://logodownload.org/wp-content/uploads/2017/05/ifood-logo-0.png',
    iconType: 'img',
    route: '/settings/ifood',
  },
  {
    key: 'IFOOD_AGENT',
    name: 'Agente iFood (App Desktop)',
    description: 'App desktop para enviar mensagens automáticas no chat do iFood (substitui a extensão Chrome).',
    icon: 'https://logodownload.org/wp-content/uploads/2017/05/ifood-logo-0.png',
    iconType: 'img',
    route: '/settings/ifood-agent',
  },
  {
    key: 'AIQFOME',
    name: 'aiqfome',
    description: 'Receba pedidos do aiqfome, sincronize cardápio e gerencie sua loja.',
    icon: 'https://aiqfome.com/favicon.ico',
    iconType: 'img',
    route: '/settings/integrations/aiqfome',
  },
  {
    key: 'WHATSAPP_CLOUD',
    name: 'WhatsApp Cloud API',
    description: 'Conecte os números oficiais da sua WhatsApp Business Account para receber e enviar mensagens no Inbox.',
    iconType: 'svg-wa',
    route: '/settings/whatsapp-cloud',
  },
  {
    key: 'WHATSAPP_EVOLUTION',
    name: 'WhatsApp (Evolution)',
    description: 'Conecte um WhatsApp pessoal via QR Code (Baileys/Evolution). Indicado para testes e estoque baixo de mensagens.',
    iconType: 'svg-wa',
    route: '/settings/whatsapp',
  },
  {
    key: 'META_PIXEL',
    name: 'Meta Pixel (Facebook)',
    description: 'Rastreie eventos de conversão no seu cardápio online para otimizar campanhas.',
    iconType: 'svg',
    route: '/settings/meta-pixel',
  },
]

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [{ data: ints }, { data: sts }, { data: mns }] = await Promise.all([
      api.get('/integrations'),
      api.get('/stores'),
      api.get('/menu/menus'),
    ])
    integrations.value = ints || []
    stores.value = sts || []
    menus.value = mns || []
    try {
      const { data: pxs } = await api.get('/meta-pixel')
      metaPixels.value = pxs || []
    } catch (e) { metaPixels.value = [] }
    try {
      const { data: ag } = await api.get('/ifood-chat/agent-status')
      ifoodAgentStatus.value = ag || null
    } catch (e) { ifoodAgentStatus.value = null }
    try {
      const { data: meta } = await api.get('/auth/meta/connected')
      const all = Array.isArray(meta?.accounts) ? meta.accounts : []
      // Only WhatsApp Cloud accounts surface here; FB/IG would have their own
      // lines on this page when those channels enter scope.
      waCloudAccounts.value = all.filter(a => a.provider === 'META_WA')
    } catch (e) { waCloudAccounts.value = [] }
    try {
      const { data: insts } = await api.get('/wa/instances')
      waEvolutionInstances.value = Array.isArray(insts) ? insts : []
    } catch (e) { waEvolutionInstances.value = [] }
    total.value = allItems.value.length
  } catch (e) {
    console.error(e);
    error.value = 'Falha ao carregar integrações';
  } finally {
    loading.value = false
  }
}

function goNew() {
  showTypeModal.value = true
}

function selectType(type) {
  showTypeModal.value = false
  router.push(type.route)
}

function goEdit(item) {
  if (item._type === 'META_PIXEL') {
    router.push('/settings/meta-pixel')
  } else if (item._type === 'IFOOD_AGENT') {
    router.push('/settings/ifood-agent')
  } else if (item._type === 'WHATSAPP_CLOUD') {
    router.push('/settings/whatsapp-cloud')
  } else if (item._type === 'WHATSAPP_EVOLUTION') {
    router.push('/settings/whatsapp')
  } else if ((item.provider || '').toUpperCase() === 'AIQFOME') {
    router.push('/settings/integrations/aiqfome')
  } else {
    router.push('/settings/ifood')
  }
}

const remove = async (it) => {
  if (it._type === 'META_PIXEL') {
    const res = await Swal.fire({ title: 'Remover Meta Pixel?', text: `Remover pixel do cardápio ${menuName(it.menuId)}?`, icon: 'warning', showCancelButton: true, confirmButtonText: 'Remover', cancelButtonText: 'Cancelar' })
    if(!res.isConfirmed) return
    try{ await api.delete(`/meta-pixel/${it.id}`); await load(); Swal.fire({ icon:'success', text:'Pixel removido' }) }catch(e){ console.error(e); Swal.fire({ icon:'error', text: e.response?.data?.message || 'Erro ao remover' }) }
  } else if (it._type === 'IFOOD_AGENT') {
    const res = await Swal.fire({ title: 'Desativar Agente iFood?', text: 'Isso revoga os tokens do app desktop e da extensão Chrome. Continuar?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Desativar', cancelButtonText: 'Cancelar' })
    if(!res.isConfirmed) return
    try{ await api.post('/ifood-chat/deactivate-agent', { alsoRevokeExtension: true }); await load(); Swal.fire({ icon:'success', text:'Integração desativada' }) }catch(e){ console.error(e); Swal.fire({ icon:'error', text: e.response?.data?.message || 'Erro ao desativar' }) }
  } else if (it._type === 'WHATSAPP_CLOUD') {
    const res = await Swal.fire({ title: 'Desconectar número WhatsApp Cloud?', text: `Remover ${it._label}. Os cardápios vinculados perderão o acesso a esse WhatsApp.`, icon: 'warning', showCancelButton: true, confirmButtonText: 'Desconectar', cancelButtonText: 'Cancelar' })
    if(!res.isConfirmed) return
    try{ await api.delete(`/auth/meta/connected/${it.id}`); await load(); Swal.fire({ icon:'success', text:'WhatsApp desconectado' }) }catch(e){ console.error(e); Swal.fire({ icon:'error', text: e.response?.data?.message || 'Erro ao desconectar' }) }
  } else if (it._type === 'WHATSAPP_EVOLUTION') {
    const res = await Swal.fire({ title: 'Remover instância WhatsApp (Evolution)?', text: `Apaga a instância "${it.instanceName}" e desfaz o pareamento. Vai precisar escanear o QR Code de novo se quiser usar esse número.`, icon: 'warning', showCancelButton: true, confirmButtonText: 'Remover', cancelButtonText: 'Cancelar' })
    if(!res.isConfirmed) return
    try{ await api.delete(`/wa/instances/${encodeURIComponent(it.instanceName)}`); await load(); Swal.fire({ icon:'success', text:'Instância removida' }) }catch(e){ console.error(e); Swal.fire({ icon:'error', text: e.response?.data?.message || 'Erro ao remover' }) }
  } else {
    const res = await Swal.fire({ title: 'Remover integração?', text: `Remover ${it.provider} vinculado à loja ${storeName(it.storeId)}?`, icon: 'warning', showCancelButton: true, confirmButtonText: 'Remover', cancelButtonText: 'Cancelar' })
    if(!res.isConfirmed) return
    try{ await api.delete(`/integrations/${it.id}`); await load(); Swal.fire({ icon:'success', text:'Integração removida' }) }catch(e){ console.error(e); Swal.fire({ icon:'error', text: e.response?.data?.message || 'Erro ao remover' }) }
  }
}

const resetFilters = () => { q.value=''; filterEnabled.value=''; offset.value=0; load() }
const nextPage = () => { if(offset.value + limit.value < total.value) { offset.value += limit.value } }
const prevPage = () => { offset.value = Math.max(0, offset.value - limit.value) }

const allItems = computed(() => {
  const apiInts = (integrations.value || []).map(i => {
    const base = storeName(i.storeId);
    const merchant = i.merchantName;
    // Show iFood channel name (merchantName) as primary; append store name only if different
    const sublabel = merchant ? (merchant !== base ? `${merchant} (${base})` : merchant) : base;
    return { ...i, _type: 'API', _label: i.provider || 'API', _sublabel: sublabel };
  })
  const pxInts = (metaPixels.value || []).map(p => ({ ...p, _type: 'META_PIXEL', _label: 'Meta Pixel', _sublabel: menuName(p.menuId), enabled: p.enabled }))

  // Linha sintética para a integração "Agente iFood" — não é uma row da tabela
  // `Integration`, mas sim um par de tokens em `PrinterSetting`. Listamos aqui
  // para que o operador veja o status junto com as demais integrações.
  const agentRows = []
  const ag = ifoodAgentStatus.value
  if (ag && (ag.hasAgentToken || ag.hasExtensionToken)) {
    const channels = []
    if (ag.hasAgentToken) channels.push('App Desktop')
    if (ag.hasExtensionToken) channels.push('Extensão Chrome')
    agentRows.push({
      id: '__ifood_agent__',
      _type: 'IFOOD_AGENT',
      _label: 'Agente iFood (Chat Automático)',
      _sublabel: channels.join(' + '),
      enabled: !!ag.isOnline,
      createdAt: ag.lastSeenAt,
    })
  }

  // WhatsApp Cloud API — uma linha por número conectado.
  const waCloudRows = (waCloudAccounts.value || []).map(a => ({
    ...a,
    _type: 'WHATSAPP_CLOUD',
    _label: 'WhatsApp Cloud API',
    _sublabel: a.displayName || a.externalId,
    enabled: a.status === 'ACTIVE' && !a.lastError,
  }))

  // WhatsApp Evolution — uma linha por instância pareada via QR.
  const waEvoRows = (waEvolutionInstances.value || []).map(i => ({
    ...i,
    _type: 'WHATSAPP_EVOLUTION',
    _label: 'WhatsApp (Evolution)',
    _sublabel: i.displayName || i.instanceName,
    enabled: String(i.status || '').toUpperCase() === 'CONNECTED',
  }))

  return [...apiInts, ...pxInts, ...agentRows, ...waCloudRows, ...waEvoRows]
})

const displayed = computed(() => {
  let list = allItems.value
  if(q.value) list = list.filter(i => (i._label||'').toLowerCase().includes(q.value.toLowerCase()) || (i._sublabel||'').toLowerCase().includes(q.value.toLowerCase()))
  if(filterEnabled.value !== '') list = list.filter(i => String(!!i.enabled) === String(filterEnabled.value))
  total.value = list.length
  return list.slice(offset.value, offset.value + limit.value)
})

function storeName(id){
  if(!id) return '-'
  const s = stores.value.find(x => x.id === id)
  return s ? s.name : id
}

function menuName(id){
  if(!id) return '-'
  const m = menus.value.find(x => x.id === id)
  if (!m) return id
  const store = stores.value.find(s => s.id === m.storeId)
  return m.name + (store ? ` (${store.name})` : '')
}

onMounted(()=> load())

</script>

<template>
  <ListCard title="Integrações" icon="bi bi-plug" :subtitle="total ? `${total} itens` : ''">
    <template #actions>
      <button class="btn btn-primary" @click="goNew"><i class="bi bi-plus-lg me-1"></i> Nova integração</button>
    </template>

    <template #filters>
      <div class="filters row g-2">
        <div class="col-md-4">
          <TextInput v-model="q" placeholder="Buscar por tipo ou loja..." inputClass="form-control" />
        </div>
        <div class="col-md-3">
          <SelectInput  class="form-select"  v-model="filterEnabled"  @change="load">
            <option value="">Todos</option>
            <option value="true">Ativos</option>
            <option value="false">Inativos</option>
          </SelectInput>
        </div>
        <div class="col-md-2 d-flex align-items-center">
          <button class="btn btn-outline-secondary w-100" @click="resetFilters">Limpar</button>
        </div>
      </div>
    </template>

    <template #default>
      <div v-if="loading" class="text-center py-4">Carregando...</div>
      <div v-else-if="error" class="alert alert-danger">{{ error }}</div>
      <div v-else>
        <div class="table-responsive">
          <table class="table table-striped align-middle">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Vinculado a</th>
                <th>Ativo</th>
                <th>Criado</th>
                <th style="width:160px">Ações</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="it in displayed" :key="it.id">
                <td>
                  <div class="d-flex align-items-center gap-2">
                    <img v-if="it._type === 'API' && (it.provider||'').toUpperCase() === 'IFOOD'" src="https://logodownload.org/wp-content/uploads/2017/05/ifood-logo-0.png" alt="iFood" style="height:20px" />
                    <img v-else-if="it._type === 'API' && (it.provider||'').toUpperCase() === 'AIQFOME'" src="https://aiqfome.com/favicon.ico" alt="aiqfome" style="height:20px" />
                    <img v-else-if="it._type === 'IFOOD_AGENT'" src="https://logodownload.org/wp-content/uploads/2017/05/ifood-logo-0.png" alt="iFood Agent" style="height:20px" />
                    <svg v-else-if="it._type === 'META_PIXEL'" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                    <svg v-else-if="it._type === 'WHATSAPP_CLOUD' || it._type === 'WHATSAPP_EVOLUTION'" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="#25D366"><path d="M12 2a10 10 0 0 0-8.6 15.07L2 22l5.07-1.33A10 10 0 1 0 12 2zm5.43 14.13c-.23.65-1.36 1.24-1.86 1.3-.5.06-1.1.09-1.78-.11-.4-.13-.93-.31-1.6-.6-2.8-1.21-4.62-4.03-4.76-4.22-.14-.18-1.13-1.5-1.13-2.86 0-1.37.72-2.04.97-2.32.26-.28.56-.35.74-.35.18 0 .37 0 .53.01.17.01.4-.07.62.47.23.55.78 1.91.85 2.05.07.14.12.31.02.5-.1.18-.14.3-.28.46-.14.16-.3.36-.43.49-.14.14-.29.29-.13.57.16.28.7 1.15 1.5 1.86 1.04.93 1.92 1.21 2.2 1.36.27.14.43.12.59-.07.16-.2.68-.79.86-1.06.18-.27.36-.23.6-.14.25.09 1.57.74 1.83.88.27.13.45.2.51.31.07.12.07.66-.16 1.31z" /></svg>
                    <i v-else class="bi bi-plug"></i>
                    <strong>{{ it._label }}</strong>
                  </div>
                  <div v-if="it._type === 'META_PIXEL'" class="small text-muted">Pixel ID: {{ it.pixelId }}</div>
                  <div v-else-if="it._type === 'IFOOD_AGENT'" class="small text-muted">Chat automático</div>
                  <div v-else-if="it._type === 'WHATSAPP_CLOUD'" class="small text-muted">Phone ID: {{ it.externalId }}<span v-if="it.wabaId"> · WABA: {{ it.wabaId }}</span></div>
                  <div v-else-if="it._type === 'WHATSAPP_EVOLUTION'" class="small text-muted">Instância: {{ it.instanceName }} · Status: {{ it.status || '—' }}</div>
                  <div v-else class="small text-muted">ClientId: {{ it.clientId ? '●●●' : '-' }}</div>
                </td>
                <td>{{ it._sublabel }}</td>
                <td>
                  <span :class="['badge', it.enabled ? 'bg-success' : 'bg-secondary']">{{ it.enabled ? 'Sim' : 'Não' }}</span>
                </td>
                <td>{{ it.createdAt ? formatDateTime(it.createdAt) : '-' }}</td>
                <td>
                  <div class="d-flex">
                    <button class="btn btn-sm btn-outline-secondary me-2" @click="goEdit(it)" title="Editar"><i class="bi bi-pencil-square"></i></button>
                    <button class="btn btn-sm btn-outline-danger" @click="remove(it)" title="Remover"><i class="bi bi-trash"></i></button>
                  </div>
                </td>
              </tr>
              <tr v-if="total === 0">
                <td colspan="5" class="text-center text-secondary py-4">Nenhuma integração encontrada.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="d-flex align-items-center justify-content-between mt-3">
          <div>
            <small>Mostrando {{ Math.min(offset + 1, total) }} - {{ Math.min(offset + limit, total) }} de {{ total }}</small>
          </div>
          <div>
            <button class="btn btn-sm btn-outline-secondary me-2" @click="prevPage" :disabled="offset===0">Anterior</button>
            <button class="btn btn-sm btn-secondary" @click="nextPage" :disabled="offset+limit >= total">Próxima</button>
          </div>
        </div>
      </div>
    </template>
  </ListCard>

  <!-- Modal: choose integration type -->
  <div v-if="showTypeModal" class="modal-backdrop-custom" @click.self="showTypeModal = false">
    <div class="type-modal-card">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h5 class="mb-0">Escolha o tipo de integração</h5>
        <button class="btn-close" @click="showTypeModal = false"></button>
      </div>
      <div class="row g-3">
        <div v-for="t in integrationTypes" :key="t.key" class="col-12 col-sm-4">
          <div class="type-option-card" @click="selectType(t)">
            <div class="d-flex align-items-center gap-3 mb-2">
              <img v-if="t.iconType === 'img'" :src="t.icon" :alt="t.name" style="height:32px" />
              <svg v-else-if="t.iconType === 'svg-wa'" xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="#25D366"><path d="M12 2a10 10 0 0 0-8.6 15.07L2 22l5.07-1.33A10 10 0 1 0 12 2zm5.43 14.13c-.23.65-1.36 1.24-1.86 1.3-.5.06-1.1.09-1.78-.11-.4-.13-.93-.31-1.6-.6-2.8-1.21-4.62-4.03-4.76-4.22-.14-.18-1.13-1.5-1.13-2.86 0-1.37.72-2.04.97-2.32.26-.28.56-.35.74-.35.18 0 .37 0 .53.01.17.01.4-.07.62.47.23.55.78 1.91.85 2.05.07.14.12.31.02.5-.1.18-.14.3-.28.46-.14.16-.3.36-.43.49-.14.14-.29.29-.13.57.16.28.7 1.15 1.5 1.86 1.04.93 1.92 1.21 2.2 1.36.27.14.43.12.59-.07.16-.2.68-.79.86-1.06.18-.27.36-.23.6-.14.25.09 1.57.74 1.83.88.27.13.45.2.51.31.07.12.07.66-.16 1.31z" /></svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
              <strong>{{ t.name }}</strong>
            </div>
            <p class="small text-muted mb-0">{{ t.description }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop-custom {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1050;
}
.type-modal-card {
  background: #fff;
  border-radius: 12px;
  padding: 24px;
  max-width: 680px;
  width: 90%;
  box-shadow: 0 8px 32px rgba(0,0,0,0.2);
}
.type-option-card {
  border: 2px solid #e9ecef;
  border-radius: 10px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.type-option-card:hover {
  border-color: #0d6efd;
  background: #f8f9ff;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(13,110,253,0.15);
}
</style>
