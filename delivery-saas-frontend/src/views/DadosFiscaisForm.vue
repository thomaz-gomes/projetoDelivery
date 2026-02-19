<template>
  <div class="container py-4">
    <div class="d-flex align-items-center justify-content-between mb-3">
      <h2 class="m-0">{{ isEdit ? 'Editar dados fiscais' : 'Novos dados fiscais' }}</h2>
      <div>
        <router-link class="btn btn-outline-secondary" to="/settings/dados-fiscais">Voltar</router-link>
      </div>
    </div>

    <div class="card p-4 mt-3">
      <form @submit.prevent="save">
        <!-- Identificação -->
        <div class="row mb-3">
          <div class="col-md-5">
            <label class="form-label">Descrição *</label>
            <TextInput v-model="form.descricao" inputClass="form-control" placeholder="Ex: Bebidas alcoólicas" required />
          </div>
          <div class="col-md-4">
            <label class="form-label">EAN (código de barras)</label>
            <TextInput v-model="form.ean" inputClass="form-control" placeholder="Ex: 7891000315507" />
          </div>
          <div class="col-md-3">
            <label class="form-label">Cód. Benefício Fiscal</label>
            <TextInput v-model="form.codBeneficio" inputClass="form-control" />
          </div>
        </div>

        <div class="row mb-3">
          <div class="col-md-6">
            <label class="form-label">Cód. Crédito Presumido</label>
            <TextInput v-model="form.codCredPresumido" inputClass="form-control" />
          </div>
          <div class="col-md-6">
            <label class="form-label">% Crédito Presumido</label>
            <input v-model.number="form.percCredPresumido" type="number" step="0.01" class="form-control" />
          </div>
        </div>

        <!-- NCM -->
        <div class="row mb-3">
          <div class="col-md-8">
            <label class="form-label">NCM</label>
            <div class="position-relative">
              <div class="form-control d-flex align-items-center justify-content-between ncm-trigger" role="button" @click="ncmOpen = !ncmOpen">
                <span :class="form.ncm ? '' : 'text-muted'">{{ form.ncm ? ncmLabel(form.ncm) : '-- Selecione --' }}</span>
                <i class="bi bi-caret-down-fill text-muted small"></i>
              </div>
              <div v-if="ncmOpen" class="position-absolute bg-white border rounded shadow-sm w-100" style="z-index:200;top:100%;max-height:280px;overflow-y:auto">
                <div class="p-2 sticky-top bg-white border-bottom">
                  <div class="input-group input-group-sm">
                    <span class="input-group-text"><i class="bi bi-search"></i></span>
                    <input v-model="ncmSearch" class="form-control" placeholder="Buscar por código ou descrição..." @click.stop />
                  </div>
                </div>
                <div v-for="n in filteredNcm" :key="n.code" class="dropdown-item-custom px-3 py-2" role="button" @click="selectNcm(n)">
                  <strong>{{ n.code }}</strong> — {{ n.desc }}
                </div>
                <div v-if="filteredNcm.length === 0" class="px-3 py-2 text-muted">Nenhum resultado</div>
              </div>
            </div>
          </div>
          <div class="col-md-4">
            <label class="form-label">Origem da Mercadoria</label>
            <SelectInput v-model="form.orig" class="form-select">
              <option :value="null">-- Selecione --</option>
              <option v-for="o in origemOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </SelectInput>
          </div>
        </div>

        <!-- Tabs -->
        <ul class="nav nav-tabs mb-4 mt-2">
          <li class="nav-item">
            <button type="button" class="nav-link" :class="{ active: tab === 'impostos' }" @click="tab = 'impostos'">Impostos</button>
          </li>
          <li class="nav-item">
            <button type="button" class="nav-link" :class="{ active: tab === 'cfops' }" @click="tab = 'cfops'">CFOPs</button>
          </li>
          <li class="nav-item">
            <button type="button" class="nav-link" :class="{ active: tab === 'cest' }" @click="tab = 'cest'">CEST</button>
          </li>
        </ul>

        <!-- IMPOSTOS tab -->
        <div v-if="tab === 'impostos'">
          <h6 class="text-muted text-uppercase small mb-2" style="letter-spacing:.05em">ICMS</h6>
          <div class="row mb-3">
            <div class="col-md-3">
              <label class="form-label">% Base</label>
              <input v-model.number="form.icmsPercBase" type="number" step="0.01" class="form-control" />
            </div>
            <div class="col-md-3">
              <label class="form-label">Alíquota (%)</label>
              <input v-model.number="form.icmsAliq" type="number" step="0.01" class="form-control" />
            </div>
            <div class="col-md-4">
              <label class="form-label">Modalidade BC</label>
              <select v-model="form.icmsModBC" class="form-select">
                <option :value="null">-- Selecione --</option>
                <option value="0">0 - Margem de Valor Agregado (%)</option>
                <option value="1">1 - Pauta (Valor)</option>
                <option value="2">2 - Preço Tabelado Máx. (Valor)</option>
                <option value="3">3 - Valor da Operação</option>
              </select>
            </div>
            <div class="col-md-2">
              <label class="form-label">FCP (%)</label>
              <input v-model.number="form.icmsFCP" type="number" step="0.01" class="form-control" />
            </div>
          </div>

          <h6 class="text-muted text-uppercase small mb-2" style="letter-spacing:.05em">ICMS ST</h6>
          <div class="row mb-3">
            <div class="col-md-3">
              <label class="form-label">% Base</label>
              <input v-model.number="form.icmsStPercBase" type="number" step="0.01" class="form-control" />
            </div>
            <div class="col-md-2">
              <label class="form-label">Alíquota (%)</label>
              <input v-model.number="form.icmsStAliq" type="number" step="0.01" class="form-control" />
            </div>
            <div class="col-md-3">
              <label class="form-label">Modalidade BC ST</label>
              <select v-model="form.icmsStModBCST" class="form-select">
                <option :value="null">-- Selecione --</option>
                <option value="0">0 - Preço Tabelado ou Máx. Sugerido</option>
                <option value="1">1 - Lista Negativa (Valor)</option>
                <option value="2">2 - Lista Positiva (Valor)</option>
                <option value="3">3 - Lista Neutra (Valor)</option>
                <option value="4">4 - Margem Valor Agregado (%)</option>
                <option value="5">5 - Pauta (Valor)</option>
              </select>
            </div>
            <div class="col-md-2">
              <label class="form-label">MVA (%)</label>
              <input v-model.number="form.icmsStMVA" type="number" step="0.01" class="form-control" />
            </div>
            <div class="col-md-2">
              <label class="form-label">FCP ST (%)</label>
              <input v-model.number="form.icmsStFCP" type="number" step="0.01" class="form-control" />
            </div>
          </div>

          <h6 class="text-muted text-uppercase small mb-2" style="letter-spacing:.05em">ICMS Efetivo</h6>
          <div class="row mb-3">
            <div class="col-md-3">
              <label class="form-label">% Base</label>
              <input v-model.number="form.icmsEfetPercBase" type="number" step="0.01" class="form-control" />
            </div>
            <div class="col-md-3">
              <label class="form-label">Alíquota (%)</label>
              <input v-model.number="form.icmsEfetAliq" type="number" step="0.01" class="form-control" />
            </div>
          </div>

          <h6 class="text-muted text-uppercase small mb-2" style="letter-spacing:.05em">PIS / COFINS / IPI</h6>
          <div class="row mb-3">
            <div class="col-md-4">
              <label class="form-label">Alíquota PIS (%)</label>
              <input v-model.number="form.pPIS" type="number" step="0.01" class="form-control" />
            </div>
            <div class="col-md-4">
              <label class="form-label">Alíquota COFINS (%)</label>
              <input v-model.number="form.pCOFINS" type="number" step="0.01" class="form-control" />
            </div>
            <div class="col-md-4">
              <label class="form-label">Alíquota IPI (%)</label>
              <input v-model.number="form.pIPI" type="number" step="0.01" class="form-control" />
            </div>
          </div>
        </div>

        <!-- CFOPS tab -->
        <div v-if="tab === 'cfops'">
          <div class="row mb-3 align-items-end">
            <div class="col-md-10 position-relative">
              <label class="form-label">Adicionar CFOP</label>
              <div class="form-control d-flex align-items-center justify-content-between ncm-trigger" role="button" @click="cfopOpen = !cfopOpen">
                <span class="text-muted">Buscar e adicionar CFOP...</span>
                <i class="bi bi-caret-down-fill text-muted small"></i>
              </div>
              <div v-if="cfopOpen" class="position-absolute bg-white border rounded shadow-sm w-100" style="z-index:200;top:100%;max-height:280px;overflow-y:auto">
                <div class="p-2 sticky-top bg-white border-bottom">
                  <div class="input-group input-group-sm">
                    <span class="input-group-text"><i class="bi bi-search"></i></span>
                    <input v-model="cfopSearch" class="form-control" placeholder="Buscar CFOP..." @click.stop />
                  </div>
                </div>
                <div v-for="c in filteredCfop" :key="c.code" class="dropdown-item-custom px-3 py-2" role="button" @click="addCfop(c)">
                  <strong>{{ c.code }}</strong> — {{ c.desc }}
                </div>
                <div v-if="filteredCfop.length === 0" class="px-3 py-2 text-muted">Nenhum resultado</div>
              </div>
            </div>
          </div>

          <div v-if="form.cfops && form.cfops.length > 0">
            <div v-for="(cfop, idx) in form.cfops" :key="idx" class="card mb-3">
              <div class="card-header d-flex align-items-center py-2">
                <strong>{{ cfop.code }}</strong>
                <span class="text-muted ms-2 small">— {{ cfopDesc(cfop.code) }}</span>
                <button type="button" class="btn btn-sm btn-danger ms-auto" @click="removeCfop(idx)">Remover CFOP</button>
              </div>
              <div class="card-body pb-2">
                <div class="row g-3">
                  <div class="col-md-6">
                    <label class="form-label">CSOSN</label>
                    <select v-model="cfop.csosn" class="form-select">
                      <option :value="null">-- Selecione --</option>
                      <option v-for="o in csosnOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
                    </select>
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">CST IPI</label>
                    <select v-model="cfop.cstIpi" class="form-select">
                      <option :value="null">-- Selecione --</option>
                      <option v-for="o in cstIpiOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
                    </select>
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">CST PIS</label>
                    <select v-model="cfop.cstPis" class="form-select">
                      <option :value="null">-- Selecione --</option>
                      <option v-for="o in cstPisCofinsOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
                    </select>
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">CST COFINS</label>
                    <select v-model="cfop.cstCofins" class="form-select">
                      <option :value="null">-- Selecione --</option>
                      <option v-for="o in cstPisCofinsOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="text-muted">Nenhum CFOP adicionado.</div>
        </div>

        <!-- CEST tab -->
        <div v-if="tab === 'cest'">
          <div v-if="!form.ncm" class="text-muted">Selecione uma NCM primeiro para ver os CESTs disponíveis.</div>
          <div v-else-if="cestList.length > 0">
            <p class="text-muted small">Selecione o CEST vinculado à NCM <strong>{{ form.ncm }}</strong>:</p>
            <div v-for="c in cestList" :key="c.code" class="form-check mb-2">
              <input class="form-check-input" type="radio" :id="'cest-'+c.code" :value="c.code" v-model="form.cest" />
              <label class="form-check-label" :for="'cest-'+c.code">{{ c.code }} — {{ c.desc }}</label>
            </div>
            <div v-if="form.cest" class="mt-2">
              <button type="button" class="btn btn-sm btn-link text-danger p-0" @click="form.cest = null">Remover seleção</button>
            </div>
          </div>
          <div v-else class="text-muted">A NCM selecionada não possui CEST vinculado.</div>
        </div>

        <!-- Actions -->
        <div class="d-flex justify-content-between mt-4">
          <router-link class="btn btn-secondary" to="/settings/dados-fiscais">Voltar</router-link>
          <button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? 'Salvando...' : 'Salvar' }}</button>
        </div>

        <div v-if="error" class="alert alert-danger mt-3">{{ error }}</div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import api from '../api'
import Swal from 'sweetalert2'
import TextInput from '../components/form/input/TextInput.vue'
import SelectInput from '../components/form/select/SelectInput.vue'

const router = useRouter()
const route = useRoute()
const id = route.params.id || null
const isEdit = Boolean(id)

const saving = ref(false)
const error = ref('')
const tab = ref('impostos')

// NCM / CFOP dropdowns
const ncmOpen = ref(false)
const ncmSearch = ref('')
const cfopOpen = ref(false)
const cfopSearch = ref('')
const ncmList = ref([])
const cfopList = ref([])
const cestList = ref([])

const csosnOptions = [
  { value: '102', label: '102 - Tributada pelo Simples Nacional sem permissão de crédito' },
  { value: '103', label: '103 - Isenção do ICMS no Simples Nacional para faixa de receita bruta' },
  { value: '203', label: '203 - Tributada pelo Simples Nacional com permissão de crédito e com cobrança do ICMS por ST' },
  { value: '300', label: '300 - Imune' },
  { value: '400', label: '400 - Não tributada pelo Simples Nacional' },
  { value: '500', label: '500 - ICMS cobrado anteriormente por substituição tributária (substituído) ou por antecipação' },
  { value: '900', label: '900 - Outros' },
]

const cstIpiOptions = [
  { value: '50', label: '50 - Saída tributada' },
  { value: '51', label: '51 - Saída tributável com alíquota zero' },
  { value: '52', label: '52 - Saída isenta' },
  { value: '53', label: '53 - Saída não-tributada' },
  { value: '54', label: '54 - Saída imune' },
  { value: '55', label: '55 - Saída com suspensão' },
  { value: '99', label: '99 - Outras saídas' },
]

const cstPisCofinsOptions = [
  { value: '01', label: '01 - Operação Tributável com Alíquota Básica' },
  { value: '02', label: '02 - Operação Tributável com Alíquota Diferenciada' },
  { value: '03', label: '03 - Operação Tributável com Alíquota por Unidade de Medida' },
  { value: '04', label: '04 - Operação Tributável Monofásica - Revenda a Alíquota Zero' },
  { value: '05', label: '05 - Operação Tributável por Substituição Tributária' },
  { value: '06', label: '06 - Operação Tributável a Alíquota Zero' },
  { value: '07', label: '07 - Operação Isenta da Contribuição' },
  { value: '08', label: '08 - Operação sem Incidência da Contribuição' },
  { value: '09', label: '09 - Operação com Suspensão da Contribuição' },
  { value: '49', label: '49 - Outras Operações de Saída' },
  { value: '99', label: '99 - Outras Operações' },
]

const origemOptions = [
  { value: '0', label: '0 - Nacional, exceto as indicadas nos códigos 3 a 5' },
  { value: '1', label: '1 - Estrangeira - Importação direta' },
  { value: '2', label: '2 - Estrangeira - Adquirida no mercado interno' },
  { value: '3', label: '3 - Nacional, Conteúdo de Importação superior a 40% e ≤ 70%' },
  { value: '4', label: '4 - Nacional, produção conforme processos produtivos básicos' },
  { value: '5', label: '5 - Nacional, Conteúdo de Importação ≤ 40%' },
  { value: '6', label: '6 - Estrangeira - Importação direta, sem similar nacional' },
  { value: '7', label: '7 - Estrangeira - Mercado interno, sem similar nacional' },
  { value: '8', label: '8 - Nacional, Conteúdo de Importação superior a 70%' },
]

const emptyForm = () => ({
  descricao: '',
  ean: '',
  codBeneficio: '',
  codCredPresumido: '',
  percCredPresumido: null,
  ncm: null,
  orig: null,
  icmsPercBase: 100,
  icmsAliq: 0,
  icmsModBC: null,
  icmsFCP: 0,
  icmsStPercBase: 100,
  icmsStAliq: 0,
  icmsStModBCST: null,
  icmsStMVA: 0,
  icmsStFCP: 0,
  icmsEfetPercBase: null,
  icmsEfetAliq: null,
  pPIS: 0,
  pCOFINS: 0,
  pIPI: 0,
  cfops: [],
  cest: null,
})

const form = ref(emptyForm())

const filteredNcm = computed(() => {
  const q = ncmSearch.value.toLowerCase()
  if (!q) return ncmList.value
  return ncmList.value.filter(n => n.code.toLowerCase().includes(q) || n.desc.toLowerCase().includes(q))
})

const filteredCfop = computed(() => {
  const q = cfopSearch.value.toLowerCase()
  const already = new Set((form.value.cfops || []).map(x => typeof x === 'string' ? x : x.code))
  const all = q ? cfopList.value.filter(c => c.code.includes(q) || c.desc.toLowerCase().includes(q)) : cfopList.value
  return all.filter(c => !already.has(c.code))
})

watch(() => form.value.ncm, async (ncm) => {
  cestList.value = []
  if (!ncm) return
  try {
    const r = await api.get('/fiscal/cest', { params: { ncm } })
    cestList.value = r.data || []
  } catch (e) { /* ignore */ }
})

async function loadRefData() {
  try {
    const [rn, rc] = await Promise.all([api.get('/fiscal/ncm'), api.get('/fiscal/cfop')])
    ncmList.value = rn.data || []
    cfopList.value = rc.data || []
  } catch (e) { /* ignore */ }
}

async function loadItem() {
  if (!isEdit) return
  try {
    const r = await api.get(`/settings/dados-fiscais`)
    const item = (r.data || []).find(d => d.id === id)
    if (!item) { error.value = 'Registro não encontrado'; return }
    form.value = {
      descricao: item.descricao || '',
      ean: item.ean || '',
      codBeneficio: item.codBeneficio || '',
      codCredPresumido: item.codCredPresumido || '',
      percCredPresumido: item.percCredPresumido ?? null,
      ncm: item.ncm || null,
      orig: item.orig ?? null,
      icmsPercBase: item.icmsPercBase ?? 100,
      icmsAliq: item.icmsAliq ?? 0,
      icmsModBC: item.icmsModBC ?? null,
      icmsFCP: item.icmsFCP ?? 0,
      icmsStPercBase: item.icmsStPercBase ?? 100,
      icmsStAliq: item.icmsStAliq ?? 0,
      icmsStModBCST: item.icmsStModBCST ?? null,
      icmsStMVA: item.icmsStMVA ?? 0,
      icmsStFCP: item.icmsStFCP ?? 0,
      icmsEfetPercBase: item.icmsEfetPercBase ?? null,
      icmsEfetAliq: item.icmsEfetAliq ?? null,
      pPIS: item.pPIS ?? 0,
      pCOFINS: item.pCOFINS ?? 0,
      pIPI: item.pIPI ?? 0,
      cfops: (() => {
        try {
          const arr = item.cfops ? (typeof item.cfops === 'string' ? JSON.parse(item.cfops) : item.cfops) : []
          if (!Array.isArray(arr)) return []
          return arr.map(c => typeof c === 'string'
            ? { code: c, csosn: null, cstIpi: null, cstPis: null, cstCofins: null }
            : c)
        } catch { return [] }
      })(),
      cest: item.cest || null,
    }
  } catch (e) {
    error.value = 'Falha ao carregar'
  }
}

function ncmLabel(code) {
  const found = ncmList.value.find(n => n.code === code)
  return found ? `${found.code} — ${found.desc}` : code
}

function cfopDesc(code) {
  const found = cfopList.value.find(c => c.code === code)
  return found ? found.desc : ''
}

function selectNcm(n) {
  form.value.ncm = n.code
  ncmOpen.value = false
  ncmSearch.value = ''
}

function addCfop(c) {
  if (!form.value.cfops) form.value.cfops = []
  if (!form.value.cfops.find(x => (typeof x === 'string' ? x : x.code) === c.code)) {
    form.value.cfops.push({ code: c.code, csosn: null, cstIpi: null, cstPis: null, cstCofins: null })
  }
  cfopOpen.value = false
  cfopSearch.value = ''
}

function removeCfop(idx) {
  form.value.cfops.splice(idx, 1)
}

async function save() {
  error.value = ''
  if (!form.value.descricao) { error.value = 'Descrição é obrigatória'; return }
  saving.value = true
  try {
    const payload = { ...form.value, cfops: form.value.cfops || [] }
    if (isEdit) {
      await api.patch(`/settings/dados-fiscais/${id}`, payload)
      Swal.fire({ icon: 'success', text: 'Dados fiscais atualizados' })
    } else {
      await api.post('/settings/dados-fiscais', payload)
      Swal.fire({ icon: 'success', text: 'Dados fiscais criados' })
    }
    router.push('/settings/dados-fiscais')
  } catch (e) {
    error.value = e?.response?.data?.message || e.message || 'Erro ao salvar'
  } finally {
    saving.value = false
  }
}

onMounted(() => { loadRefData(); loadItem() })
</script>

<style scoped>
.ncm-trigger { cursor: pointer; }
.dropdown-item-custom:hover { background: #f0f4fa; cursor: pointer; }
</style>
