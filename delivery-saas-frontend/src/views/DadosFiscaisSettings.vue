<template>
  <div class="container py-4">

    <!-- infRespTec global -->
    <div class="card mb-4">
      <div class="card-header d-flex align-items-center gap-2">
        <i class="bi bi-person-badge"></i>
        <strong>Responsável Técnico pelo Software (infRespTec)</strong>
      </div>
      <div class="card-body">
        <p class="text-muted small mb-3">
          Identifica o fornecedor do software emissor de NF-e. Obrigatório por NT 2018.005 — sem este bloco alguns estados retornam <strong>Rejeição 972</strong>.
          Preencha com os dados da empresa que desenvolveu este sistema. Esta configuração é global e se aplica a todas as notas emitidas.
        </p>
        <div class="row g-3">
          <div class="col-md-4">
            <label class="form-label small">CNPJ do Responsável</label>
            <input v-model="respTec.CNPJ" type="text" class="form-control" placeholder="00.000.000/0000-00" />
          </div>
          <div class="col-md-4">
            <label class="form-label small">Nome do Contato</label>
            <input v-model="respTec.xContato" type="text" class="form-control" placeholder="Nome completo" />
          </div>
          <div class="col-md-4">
            <label class="form-label small">Telefone</label>
            <input v-model="respTec.fone" type="text" class="form-control" placeholder="DDD + número" />
          </div>
          <div class="col-md-4">
            <label class="form-label small">E-mail</label>
            <input v-model="respTec.email" type="email" class="form-control" placeholder="email@empresa.com" />
          </div>
        </div>
        <div class="mt-3 d-flex align-items-center gap-2">
          <button class="btn btn-primary btn-sm" @click="saveRespTec" :disabled="savingRespTec">
            <span v-if="savingRespTec" class="spinner-border spinner-border-sm me-1"></span>
            Salvar
          </button>
          <span v-if="respTecMsg" :class="respTecMsgOk ? 'text-success' : 'text-danger'" class="small">{{ respTecMsg }}</span>
        </div>
      </div>
    </div>

    <!-- Perfis de dados fiscais -->
    <div class="d-flex align-items-center justify-content-between mb-3">
      <h2 class="m-0">Dados Fiscais</h2>
      <div>
        <router-link class="btn btn-primary" to="/settings/dados-fiscais/new">Criar novo</router-link>
      </div>
    </div>

    <div v-if="loading" class="text-center py-3">Carregando...</div>
    <div v-else>
      <div class="table-responsive">
        <table class="table table-striped">
          <thead>
            <tr>
              <th>Descrição</th>
              <th>NCM</th>
              <th>CFOPs</th>
              <th style="width:200px">Ações</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="list.length === 0">
              <td colspan="4" class="text-center text-muted py-3">Nenhum dado fiscal cadastrado.</td>
            </tr>
            <tr v-for="item in list" :key="item.id">
              <td><strong>{{ item.descricao }}</strong></td>
              <td class="text-muted">{{ item.ncm || '—' }}</td>
              <td class="text-muted">{{ formatCfops(item.cfops) }}</td>
              <td>
                <router-link class="btn btn-sm btn-outline-primary me-2" :to="`/settings/dados-fiscais/${item.id}`">Editar</router-link>
                <button class="btn btn-sm btn-danger" @click="remove(item)">Remover</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../api'
import Swal from 'sweetalert2'

const list = ref([])
const loading = ref(false)

const respTec = ref({ CNPJ: '', xContato: '', fone: '', email: '' })
const savingRespTec = ref(false)
const respTecMsg = ref('')
const respTecMsgOk = ref(true)

function formatCfops(raw) {
  if (!raw) return '—'
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(arr)) return '—'
    return arr.map(c => typeof c === 'string' ? c : c.code).join(', ') || '—'
  } catch { return '—' }
}

async function load() {
  loading.value = true
  try {
    const [fiscalRes, companyRes] = await Promise.all([
      api.get('/settings/dados-fiscais'),
      api.get('/settings/company'),
    ])
    list.value = fiscalRes.data || []
    const rt = companyRes.data?.infRespTec
    if (rt) {
      respTec.value = { CNPJ: rt.CNPJ || '', xContato: rt.xContato || '', fone: rt.fone || '', email: rt.email || '' }
    }
  } catch (e) {
    Swal.fire({ icon: 'error', text: 'Falha ao carregar dados fiscais' })
  } finally {
    loading.value = false
  }
}

async function saveRespTec() {
  savingRespTec.value = true
  respTecMsg.value = ''
  try {
    await api.patch('/settings/company', {
      infRespTec: respTec.value.CNPJ ? respTec.value : null,
    })
    respTecMsgOk.value = true
    respTecMsg.value = 'Salvo com sucesso!'
    setTimeout(() => { respTecMsg.value = '' }, 3000)
  } catch (e) {
    respTecMsgOk.value = false
    respTecMsg.value = e?.response?.data?.message || 'Erro ao salvar'
  } finally {
    savingRespTec.value = false
  }
}

async function remove(item) {
  const r = await Swal.fire({
    title: 'Excluir?',
    text: `Remover "${item.descricao}"? Categorias e produtos vinculados perderão a referência fiscal.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sim, excluir',
    cancelButtonText: 'Cancelar'
  })
  if (!r.isConfirmed) return
  try {
    await api.delete(`/settings/dados-fiscais/${item.id}`)
    await load()
    Swal.fire({ icon: 'success', toast: true, position: 'top-end', showConfirmButton: false, timer: 1600, text: 'Removido' })
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Erro ao remover' })
  }
}

onMounted(load)
</script>
