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

const form = ref({ timezone: DEFAULT_TZ })
const loading = ref(false)
const saving = ref(false)

async function load() {
  loading.value = true
  try {
    const r = await api.get('/settings/company')
    form.value.timezone = r.data?.timezone || DEFAULT_TZ
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

onMounted(load)
</script>

<style scoped></style>
