<template>
  <div class="container-fluid py-3">
    <h4 class="mb-3">Emissão de NF-e</h4>

    <div v-if="loadingConfig" class="text-center py-5">
      <div class="spinner-border" role="status"></div>
    </div>

    <form v-else @submit.prevent="emitirNfe">
      <!-- Identificação (ide) -->
      <div class="card mb-3">
        <div class="card-header fw-semibold">Identificação</div>
        <div class="card-body">
          <div class="row g-2">
            <div class="col-md-3">
              <label class="form-label"><strong>Natureza da Operação</strong></label>
              <TextInput v-model="form.ide.natOp" placeholder="VENDA" required />
            </div>
            <div class="col-md-2">
              <label class="form-label"><strong>Modelo</strong></label>
              <SelectInput
                v-model="form.ide.mod"
                :options="[{ value: '55', label: '55 - NF-e' }, { value: '65', label: '65 - NFC-e' }]"
              />
            </div>
            <div class="col-md-2">
              <label class="form-label"><strong>Série</strong></label>
              <TextInput v-model="form.ide.serie" placeholder="1" required />
            </div>
            <div class="col-md-2">
              <label class="form-label"><strong>Número NF</strong></label>
              <TextInput v-model="form.ide.nNF" placeholder="1" required />
            </div>
            <div class="col-md-3">
              <label class="form-label"><strong>Ambiente</strong></label>
              <SelectInput
                v-model="form.ide.tpAmb"
                :options="[{ value: '2', label: 'Homologação' }, { value: '1', label: 'Produção' }]"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Emitente (emit) — pré-carregado -->
      <div class="card mb-3">
        <div class="card-header fw-semibold">Emitente</div>
        <div class="card-body">
          <div class="row g-2">
            <div class="col-md-4">
              <TextInput v-model="form.emit.CNPJ" label="CNPJ" placeholder="00000000000000" required />
            </div>
            <div class="col-md-4">
              <TextInput v-model="form.emit.xNome" label="Razão Social" required />
            </div>
            <div class="col-md-4">
              <TextInput v-model="form.emit.IE" label="Inscrição Estadual" placeholder="ISENTO" />
            </div>
          </div>
          <div class="row g-2 mt-1">
            <div class="col-md-3">
              <TextInput v-model="form.emit.enderEmit.xLgr" label="Logradouro" />
            </div>
            <div class="col-md-1">
              <TextInput v-model="form.emit.enderEmit.nro" label="Nro" />
            </div>
            <div class="col-md-2">
              <TextInput v-model="form.emit.enderEmit.xBairro" label="Bairro" />
            </div>
            <div class="col-md-2">
              <TextInput v-model="form.emit.enderEmit.cMun" label="Cód. Município" />
            </div>
            <div class="col-md-2">
              <TextInput v-model="form.emit.enderEmit.xMun" label="Município" />
            </div>
            <div class="col-md-1">
              <TextInput v-model="form.emit.enderEmit.UF" label="UF" maxlength="2" />
            </div>
            <div class="col-md-1">
              <TextInput v-model="form.emit.enderEmit.CEP" label="CEP" maxlength="8" />
            </div>
          </div>
        </div>
      </div>

      <!-- Destinatário (dest) -->
      <div class="card mb-3">
        <div class="card-header fw-semibold">Destinatário</div>
        <div class="card-body">
          <div class="row g-2">
            <div class="col-md-2">
              <label class="form-label"><strong>Tipo Doc.</strong></label>
              <SelectInput
                v-model="form.dest.tipoDoc"
                :options="[{ value: 'CPF', label: 'CPF' }, { value: 'CNPJ', label: 'CNPJ' }]"
              />
            </div>
            <div class="col-md-4">
              <TextInput v-model="form.dest.documento" label="CPF/CNPJ" :placeholder="form.dest.tipoDoc === 'CPF' ? '00000000000' : '00000000000000'" />
            </div>
            <div class="col-md-6">
              <TextInput v-model="form.dest.xNome" label="Nome / Razão Social" />
            </div>
          </div>
        </div>
      </div>

      <!-- Itens (det) -->
      <div class="card mb-3">
        <div class="card-header fw-semibold d-flex justify-content-between align-items-center">
          <span>Itens</span>
          <button type="button" class="btn btn-sm btn-primary" @click="addItem">
            <i class="bi bi-plus-lg"></i> Adicionar Item
          </button>
        </div>
        <div class="card-body p-0">
          <div class="table-responsive">
            <table class="table table-sm table-bordered mb-0">
              <thead class="table-light">
                <tr>
                  <th class="text-center" style="width:50px">#</th>
                  <th>Descrição</th>
                  <th style="width:110px">NCM</th>
                  <th style="width:80px">CFOP</th>
                  <th style="width:70px">Unid.</th>
                  <th style="width:80px">Qtd.</th>
                  <th style="width:110px">V. Unit.</th>
                  <th style="width:110px" class="text-end">V. Total</th>
                  <th style="width:80px">% ICMS</th>
                  <th style="width:100px" class="text-end">V. ICMS</th>
                  <th style="width:50px"></th>
                </tr>
              </thead>
              <tbody>
                <NfeItemRow
                  v-for="(it, idx) in form.itens"
                  :key="idx"
                  :index="idx"
                  :modelValue="it"
                  @update:modelValue="updateItem(idx, $event)"
                  @remove="removeItem(idx)"
                />
                <tr v-if="!form.itens.length">
                  <td colspan="11" class="text-center text-muted py-3">Nenhum item adicionado</td>
                </tr>
              </tbody>
              <tfoot class="table-light fw-semibold">
                <tr>
                  <td colspan="7" class="text-end">Totais:</td>
                  <td class="text-end">{{ formatCurrency(totais.vProd) }}</td>
                  <td></td>
                  <td class="text-end">{{ formatCurrency(totais.vICMS) }}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      <!-- Pagamento -->
      <div class="card mb-3">
        <div class="card-header fw-semibold">Pagamento</div>
        <div class="card-body">
          <div class="row g-2">
            <div class="col-md-4">
              <label class="form-label"><strong>Forma de Pagamento</strong></label>
              <SelectInput
                v-model="form.pagamento.tPag"
                :options="formasPagamento"
              />
            </div>
            <div class="col-md-4">
              <CurrencyInput v-model="form.pagamento.vPag" label="Valor Pago" />
            </div>
          </div>
        </div>
      </div>

      <!-- Retorno SEFAZ -->
      <div v-if="resultado" class="alert" :class="resultado.success ? 'alert-success' : 'alert-danger'" role="alert">
        <strong>{{ resultado.success ? 'Autorizada' : 'Rejeitada/Erro' }}</strong><br>
        <span v-if="resultado.cStat">cStat: {{ resultado.cStat }}</span><br>
        <span v-if="resultado.xMotivo">{{ resultado.xMotivo }}</span>
        <span v-if="resultado.nProt"><br>Protocolo: {{ resultado.nProt }}</span>
        <span v-if="resultado.error"><br>{{ resultado.error }}</span>
      </div>

      <!-- Ações -->
      <div class="d-flex gap-2">
        <button type="submit" class="btn btn-success" :disabled="emitindo || !form.itens.length">
          <span v-if="emitindo" class="spinner-border spinner-border-sm me-1"></span>
          {{ emitindo ? 'Emitindo...' : 'Emitir NF-e' }}
        </button>
      </div>
    </form>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import api from '@/api'
import TextInput from '@/components/form/input/TextInput.vue'
import CurrencyInput from '@/components/form/input/CurrencyInput.vue'
import SelectInput from '@/components/form/select/SelectInput.vue'
import NfeItemRow from '@/components/nfe/NfeItemRow.vue'
import { formatAmount } from '@/utils/formatters.js'

const loadingConfig = ref(false)
const emitindo = ref(false)
const resultado = ref(null)

const form = reactive({
  ide: {
    natOp: 'VENDA',
    mod: '65',
    serie: '1',
    nNF: '',
    tpAmb: '2'
  },
  emit: {
    CNPJ: '',
    xNome: '',
    IE: 'ISENTO',
    enderEmit: { xLgr: '', nro: '', xBairro: '', cMun: '', xMun: '', UF: '', CEP: '' }
  },
  dest: {
    tipoDoc: 'CPF',
    documento: '',
    xNome: ''
  },
  itens: [],
  pagamento: {
    tPag: '01',
    vPag: null
  }
})

const formasPagamento = [
  { value: '01', label: '01 - Dinheiro' },
  { value: '02', label: '02 - Cheque' },
  { value: '03', label: '03 - Cartão de Crédito' },
  { value: '04', label: '04 - Cartão de Débito' },
  { value: '05', label: '05 - Crédito Loja' },
  { value: '10', label: '10 - Vale Alimentação' },
  { value: '11', label: '11 - Vale Refeição' },
  { value: '12', label: '12 - Vale Presente' },
  { value: '13', label: '13 - Vale Combustível' },
  { value: '15', label: '15 - Boleto Bancário' },
  { value: '16', label: '16 - Depósito Bancário' },
  { value: '17', label: '17 - PIX' },
  { value: '99', label: '99 - Outros' }
]

const totais = computed(() => {
  let vProd = 0, vICMS = 0
  for (const it of form.itens) {
    vProd += Number(it.vProd) || 0
    vICMS += Number(it.vICMS) || 0
  }
  return {
    vProd: Math.round(vProd * 100) / 100,
    vICMS: Math.round(vICMS * 100) / 100,
    vNF: Math.round(vProd * 100) / 100
  }
})

function formatCurrency(val) {
  try { return formatAmount(val) } catch { return val?.toFixed(2) ?? '0,00' }
}

function createEmptyItem() {
  return {
    xProd: '',
    NCM: '00000000',
    CFOP: '5102',
    uCom: 'UN',
    qCom: 1,
    vUnCom: null,
    pICMS: 0,
    vProd: 0,
    vICMS: 0
  }
}

function addItem() {
  form.itens.push(createEmptyItem())
}

function removeItem(idx) {
  form.itens.splice(idx, 1)
}

function updateItem(idx, val) {
  form.itens[idx] = val
}

onMounted(async () => {
  loadingConfig.value = true
  try {
    const { data } = await api.get('/nfe/emitente-config')
    if (data?.config) {
      const c = data.config
      if (c.cnpj) form.emit.CNPJ = c.cnpj
      if (c.ie) form.emit.IE = c.ie
      if (c.xNome) form.emit.xNome = c.xNome
      if (c.nfeSerie) form.ide.serie = c.nfeSerie
      if (c.nfeEnvironment === 'production') form.ide.tpAmb = '1'
      if (c.enderEmit) Object.assign(form.emit.enderEmit, c.enderEmit)
    }
  } catch {
    // config not available yet — user fills manually
  } finally {
    loadingConfig.value = false
  }
})

async function emitirNfe() {
  if (!form.itens.length) return
  emitindo.value = true
  resultado.value = null
  try {
    const payload = {
      ide: { ...form.ide },
      emit: { ...form.emit },
      dest: {
        [form.dest.tipoDoc]: form.dest.documento,
        xNome: form.dest.xNome
      },
      det: form.itens.map((it, idx) => ({
        nItem: idx + 1,
        prod: {
          xProd: it.xProd,
          NCM: it.NCM,
          CFOP: it.CFOP,
          uCom: it.uCom,
          qCom: String(it.qCom),
          vUnCom: String(Number(it.vUnCom || 0).toFixed(2)),
          vProd: String((it.vProd || 0).toFixed(2))
        },
        imposto: {
          pICMS: Number(it.pICMS) || 0
        }
      })),
      total: {
        vProd: totais.value.vProd.toFixed(2),
        vICMS: totais.value.vICMS.toFixed(2),
        vNF: totais.value.vNF.toFixed(2)
      },
      pag: {
        tPag: form.pagamento.tPag,
        vPag: (Number(form.pagamento.vPag) || totais.value.vNF).toFixed(2)
      }
    }

    const { data } = await api.post('/nfe/emit', payload)
    resultado.value = data
  } catch (err) {
    resultado.value = { success: false, error: err.response?.data?.error || err.message }
  } finally {
    emitindo.value = false
  }
}
</script>
