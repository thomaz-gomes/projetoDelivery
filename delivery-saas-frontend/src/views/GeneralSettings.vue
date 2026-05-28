<template>
  <div class="container py-4">
    <h3 class="mb-4">Configurações Gerais</h3>

    <div class="card">
      <div class="card-body">
        <h5 class="mb-3">
          <i class="bi-globe me-2"></i>Fuso Horário
        </h5>
        <p class="small text-muted mb-3">
          Define o fuso horário usado em relatórios, agrupamentos por dia (faturamento, dashboards) e
          filtros de data. Sem esse ajuste, vendas registradas no fim do dia podem aparecer como
          receita do dia seguinte porque o servidor usa UTC.
        </p>

        <div class="row g-3">
          <div class="col-md-6">
            <label class="form-label fw-semibold">Fuso horário da empresa</label>
            <select class="form-select" v-model="form.timezone" :disabled="loading">
              <option v-for="tz in TIMEZONES" :key="tz" :value="tz">{{ tz }}</option>
            </select>
            <div class="form-text">Padrão: <strong>America/Sao_Paulo</strong> (UTC−3, sem horário de verão).</div>
          </div>
        </div>

        <div class="d-flex gap-2 mt-4">
          <button class="btn btn-primary" :disabled="saving || loading" @click="save">
            <span v-if="saving" class="spinner-border spinner-border-sm me-2"></span>
            Salvar
          </button>
        </div>
      </div>
    </div>

    <div class="card mt-3">
      <div class="card-body">
        <h5 class="mb-3">
          <i class="bi-megaphone me-2"></i>Marketing
        </h5>
        <p class="small text-muted mb-3">
          Limite de mensagens de marketing que cada cliente pode receber numa janela rolante de 7 dias,
          somando todas as campanhas. Acima deste limite, o cliente é silenciosamente excluído da próxima
          campanha (proteção anti-spam, ajuda a manter a qualidade da conta no WhatsApp).
        </p>

        <div class="row g-3 align-items-end">
          <div class="col-md-4">
            <label class="form-label fw-semibold">Limite por cliente / 7 dias</label>
            <input
              type="number"
              class="form-control"
              min="0"
              max="50"
              :placeholder="`Padrão (${DEFAULT_FREQ_CAP})`"
              v-model="form.marketingFrequencyCapPerWeek"
              :disabled="loading"
            />
            <div class="form-text">
              <span v-if="form.marketingFrequencyCapPerWeek === '' || form.marketingFrequencyCapPerWeek == null">
                Usando o padrão do sistema: <strong>{{ DEFAULT_FREQ_CAP }}</strong>.
              </span>
              <span v-else-if="Number(form.marketingFrequencyCapPerWeek) === 0">
                <strong class="text-danger">0</strong> bloqueia todo envio de marketing.
              </span>
              <span v-else>Cada cliente recebe no máximo <strong>{{ form.marketingFrequencyCapPerWeek }}</strong> mensagens por semana.</span>
            </div>
          </div>
        </div>

        <div class="d-flex gap-2 mt-4">
          <button class="btn btn-primary" :disabled="saving || loading" @click="saveMarketing">
            <span v-if="saving" class="spinner-border spinner-border-sm me-2"></span>
            Salvar
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../api'
import Swal from 'sweetalert2'

const DEFAULT_TZ = 'America/Sao_Paulo'

// IANA timezone options (mirrors the list in StoreForm.vue).
const TIMEZONES = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Belem',
  'America/Fortaleza',
  'America/Recife',
  'America/Bahia',
  'America/Cuiaba',
  'America/Campo_Grande',
  'America/Porto_Velho',
  'America/Rio_Branco',
  'America/Noronha',
  'UTC',
]

const DEFAULT_FREQ_CAP = 2

const form = ref({ timezone: DEFAULT_TZ, marketingFrequencyCapPerWeek: '' })
const loading = ref(false)
const saving = ref(false)

async function load() {
  loading.value = true
  try {
    const r = await api.get('/settings/company')
    form.value.timezone = r.data?.timezone || DEFAULT_TZ
    form.value.marketingFrequencyCapPerWeek = r.data?.marketingFrequencyCapPerWeek ?? ''
  } catch (e) {
    console.warn('Falha ao carregar configurações da empresa', e)
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    await api.patch('/settings/company', { timezone: form.value.timezone })
    Swal.fire({ icon: 'success', title: 'Salvo', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 })
  } catch (e) {
    const msg = e?.response?.data?.message || 'Erro ao salvar'
    Swal.fire({ icon: 'error', title: 'Erro', text: msg })
  } finally {
    saving.value = false
  }
}

async function saveMarketing() {
  saving.value = true
  try {
    const v = form.value.marketingFrequencyCapPerWeek
    const payload = { marketingFrequencyCapPerWeek: (v === '' || v == null) ? null : Number(v) }
    await api.patch('/settings/company', payload)
    Swal.fire({ icon: 'success', title: 'Salvo', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 })
  } catch (e) {
    const msg = e?.response?.data?.message || 'Erro ao salvar'
    Swal.fire({ icon: 'error', title: 'Erro', text: msg })
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped></style>
