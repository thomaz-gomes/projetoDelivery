<template>
  <div class="container py-4">
    <div class="d-flex align-items-center justify-content-between mb-3">
      <h2 class="m-0">{{ isEdit ? 'Editar forma' : 'Nova forma' }}</h2>
      <div>
        <router-link class="btn btn-outline-secondary" to="/settings/payment-methods">Voltar</router-link>
      </div>
    </div>

    <div class="card">
      <div class="card-body">
        <ul class="nav nav-tabs mb-3">
          <li class="nav-item"><a class="nav-link" :class="{ active: tab === 'basic' }" href="#" @click.prevent="tab = 'basic'">Geral</a></li>
          <li v-if="hasFinancial" class="nav-item"><a class="nav-link" :class="{ active: tab === 'financial' }" href="#" @click.prevent="tab = 'financial'">Financeiro</a></li>
          <li v-if="hasFiscal" class="nav-item"><a class="nav-link" :class="{ active: tab === 'fiscal' }" href="#" @click.prevent="tab = 'fiscal'">Fiscal</a></li>
        </ul>

        <form @submit.prevent="save">

          <!-- TAB: Informações Básicas -->
          <div v-show="tab === 'basic'">
            <div class="mb-3">
              <label class="form-label">Nome <span class="text-danger">*</span></label>
              <TextInput v-model="form.name" placeholder="Nome (ex: Dinheiro, PIX)" inputClass="form-control" required />
            </div>

            <div class="mb-3">
              <label class="form-label">Descrição</label>
              <TextInput v-model="form.description" placeholder="Descrição da forma de pagamento" inputClass="form-control" />
            </div>

            <div class="mb-3 row">
              <div class="col-md-6">
                <label class="form-label">Código <span class="text-danger">*</span></label>
                <TextInput v-model="form.code" placeholder="Código (ex: CASH, PIX)" inputClass="form-control" required />
              </div>
              <div class="col-md-6">
                <label class="form-label">Estado</label>
                <SelectInput v-model="form.isActive" class="form-select">
                  <option :value="true">Ativo</option>
                  <option :value="false">Inativo</option>
                </SelectInput>
              </div>
            </div>

            <div class="mb-3 row">
              <div class="col-md-6">
                <label class="form-label">Tipo</label>
                <SelectInput v-model="form.noChange" class="form-select">
                  <option :value="false">Com troco</option>
                  <option :value="true">Sem troco</option>
                </SelectInput>
              </div>
              <div class="col-md-6 d-flex align-items-end">
                <div class="form-check mb-2">
                  <input class="form-check-input" type="checkbox" id="isOnline" v-model="form.isOnline">
                  <label class="form-check-label" for="isOnline">Pagamento Online</label>
                </div>
              </div>
            </div>

          </div>

          <!-- TAB: Financeiro -->
          <div v-show="tab === 'financial'" v-if="hasFinancial">
            <div class="mb-3">
              <label class="form-label">Método de pagamento</label>
              <SelectInput v-model="form.paymentType" class="form-select">
                <option value="">Selecione...</option>
                <option value="credit">Cartão de Crédito</option>
                <option value="debit">Cartão de Débito</option>
                <option value="pix">PIX</option>
                <option value="cash">Dinheiro</option>
                <option value="voucher">Vale Alimentação / Refeição</option>
                <option value="boleto">Boleto</option>
                <option value="other">Outro</option>
              </SelectInput>
            </div>

            <div class="mb-3">
              <label class="form-label">Bandeira do cartão</label>
              <SelectInput v-model="form.cardBrand" class="form-select">
                <option value="">Nenhuma</option>
                <option value="visa">Visa</option>
                <option value="mastercard">Mastercard</option>
                <option value="elo">Elo</option>
                <option value="amex">American Express</option>
                <option value="hipercard">Hipercard</option>
                <option value="diners">Diners Club</option>
                <option value="alelo">Alelo</option>
                <option value="sodexo">Sodexo</option>
                <option value="vr">VR</option>
                <option value="other">Outra</option>
              </SelectInput>
            </div>

            <div class="mb-3 row">
              <div class="col-md-6">
                <label class="form-label">Taxa (%)</label>
                <input type="number" step="0.01" min="0" max="100" class="form-control" v-model.number="form.taxRate" placeholder="Ex: 3.19">
              </div>
              <div class="col-md-6">
                <label class="form-label">Taxa fixa por transação (R$)</label>
                <input type="number" step="0.01" min="0" class="form-control" v-model.number="form.fixedFee" placeholder="Ex: 0.50">
              </div>
            </div>

            <div class="mb-3">
              <label class="form-label">Formato de repasse</label>
              <SelectInput v-model="form.transferFormat" class="form-select">
                <option value="">Selecione...</option>
                <option value="dias_corridos_util">Dias corridos com pagamento em dia útil</option>
                <option value="dias_corridos">Dias corridos</option>
                <option value="periodo_agrupado">Período agrupado</option>
                <option value="mesmo_dia_proximo_mes">Mesmo dia do próximo mês</option>
                <option value="lote_mensal">Lote mensal</option>
              </SelectInput>
            </div>

            <div class="mb-3">
              <label class="form-label">Dias para recebimento</label>
              <input type="number" min="0" class="form-control" v-model.number="form.daysToReceive" placeholder="Ex: 1">
            </div>

            <div class="mb-3">
              <label class="form-label">Conta para recebimento</label>
              <div class="d-flex gap-2 align-items-center">
                <SelectInput v-model="form.accountId" class="form-select">
                  <option value="">Nenhuma</option>
                  <option v-for="acc in accounts" :key="acc.id" :value="acc.id">{{ acc.name }}</option>
                </SelectInput>
                <router-link to="/financial/accounts" class="text-nowrap small text-primary">Incluir nova</router-link>
              </div>
            </div>
          </div>

          <!-- TAB: Informações Fiscais -->
          <div v-show="tab === 'fiscal'" v-if="hasFiscal">
            <div class="mb-3">
              <label class="form-label">Nome fantasia do intermediador de transação</label>
              <TextInput v-model="form.intermediaryName" placeholder="Ex: PagSeguro, Stone" inputClass="form-control" />
            </div>

            <div class="mb-3">
              <label class="form-label">CNPJ do intermediador</label>
              <TextInput v-model="form.intermediaryCnpj" placeholder="00.000.000/0000-00" inputClass="form-control" />
            </div>

            <div class="mb-3">
              <label class="form-label">Código de usuário na plataforma de intermediação</label>
              <TextInput v-model="form.platformUserCode" placeholder="Código identificador" inputClass="form-control" />
            </div>
          </div>

          <div class="d-flex gap-2 mt-3">
            <button class="btn btn-primary" :disabled="saving">Salvar</button>
            <button class="btn btn-secondary" type="button" @click="resetForm">Limpar</button>
          </div>

          <div v-if="error" class="alert alert-danger mt-2">{{ error }}</div>
          <div v-if="success" class="alert alert-success mt-2">{{ success }}</div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'
import Swal from 'sweetalert2'
import { useModulesStore } from '../stores/modules.js'

const route = useRoute()
const router = useRouter()
const modules = useModulesStore()
const id = route.params.id || null
const isEdit = Boolean(id)

const loading = ref(false)
const saving = ref(false)
const error = ref('')
const success = ref('')
const tab = ref('basic')
const accounts = ref([])

const hasFinancial = computed(() => modules.has('financial'))
const hasFiscal = computed(() => modules.has('fiscal'))

const defaultForm = () => ({
  id: null, name: '', description: '', code: '', isActive: true, isOnline: false,
  noChange: false, paymentType: '', cardBrand: '', taxRate: null, fixedFee: null,
  transferFormat: '', daysToReceive: null, accountId: '',
  intermediaryName: '', intermediaryCnpj: '', platformUserCode: '',
  config: {}
})

const form = ref(defaultForm())

async function load() {
  if (!isEdit) return
  loading.value = true
  try {
    const res = await api.get(`/menu/payment-methods/${id}`)
    const d = res.data || {}
    form.value = { ...defaultForm(), ...d }
  } catch (e) { console.error(e); Swal.fire({ icon: 'error', text: 'Falha ao carregar forma' }) }
  finally { loading.value = false }
}

async function loadAccounts() {
  try {
    const res = await api.get('/financial/accounts')
    accounts.value = res.data || []
  } catch { /* module may not be active */ }
}

function resetForm() {
  form.value = defaultForm()
  error.value = ''
  success.value = ''
  tab.value = 'basic'
}

async function save() {
  error.value = ''
  success.value = ''
  saving.value = true
  try {
    if (!form.value.name || !form.value.code) { error.value = 'Nome e código são obrigatórios'; return }
    const payload = {
      name: form.value.name,
      description: form.value.description || null,
      code: form.value.code,
      isActive: form.value.isActive,
      isOnline: form.value.isOnline,
      noChange: form.value.noChange,
      paymentType: form.value.paymentType || null,
      cardBrand: form.value.cardBrand || null,
      taxRate: form.value.taxRate != null && form.value.taxRate !== '' ? Number(form.value.taxRate) : null,
      fixedFee: form.value.fixedFee != null && form.value.fixedFee !== '' ? Number(form.value.fixedFee) : null,
      transferFormat: form.value.transferFormat || null,
      daysToReceive: form.value.daysToReceive != null && form.value.daysToReceive !== '' ? Number(form.value.daysToReceive) : null,
      accountId: form.value.accountId || null,
      intermediaryName: form.value.intermediaryName || null,
      intermediaryCnpj: form.value.intermediaryCnpj || null,
      platformUserCode: form.value.platformUserCode || null,
      config: form.value.config || {}
    }
    if (isEdit) {
      await api.patch(`/menu/payment-methods/${id}`, payload)
      success.value = 'Atualizado'
    } else {
      await api.post('/menu/payment-methods', payload)
      success.value = 'Criado'
    }
    setTimeout(() => router.push('/settings/payment-methods'), 600)
  } catch (e) { console.error(e); error.value = e?.response?.data?.message || e.message }
  finally { saving.value = false }
}

onMounted(async () => {
  await modules.fetchEnabled()
  load()
  if (hasFinancial.value) loadAccounts()
})
</script>

<style scoped>
</style>
