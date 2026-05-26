<script setup>
import { ref, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../../api'
import RuleBuilder from '../../components/marketing/RuleBuilder.vue'
import BaseButton from '../../components/BaseButton.vue'
import Swal from 'sweetalert2'

const route = useRoute()
const router = useRouter()
const isEdit = !!route.params.id

const form = ref({
  name: '',
  description: '',
  ruleJson: {
    rule: { all: [{ field: 'totalSpent', op: '>=', value: 0 }] },
  },
})
const preview = ref({ count: null, sample: [], loading: false })
const saving = ref(false)

onMounted(async () => {
  if (isEdit) {
    try {
      const { data } = await api.get(`/marketing/segments/${route.params.id}`)
      if (data) {
        form.value.name = data.name
        form.value.description = data.description || ''
        form.value.ruleJson = data.ruleJson
      }
    } catch (e) { /* ignore */ }
  }
  refreshPreview()
})

let previewTimer = null
watch(() => form.value.ruleJson, () => {
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(refreshPreview, 500)
}, { deep: true })

async function refreshPreview() {
  preview.value.loading = true
  try {
    const { data } = await api.post('/marketing/segments/preview', { ruleJson: form.value.ruleJson })
    preview.value.count = data.count
    preview.value.sample = data.sample
  } catch (e) {
    preview.value.count = null
  } finally { preview.value.loading = false }
}

async function save() {
  if (!form.value.name) {
    Swal.fire({ icon: 'warning', text: 'Informe um nome para o segmento' })
    return
  }
  saving.value = true
  try {
    if (isEdit) {
      await api.patch(`/marketing/segments/${route.params.id}`, form.value)
    } else {
      await api.post('/marketing/segments', form.value)
    }
    router.push('/marketing/segments')
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Falha ao salvar' })
  } finally { saving.value = false }
}
</script>

<template>
  <div class="container py-4">
    <h2 class="h4 mb-4">{{ isEdit ? 'Editar segmento' : 'Novo segmento' }}</h2>

    <div class="card mb-3">
      <div class="card-body">
        <div class="mb-3">
          <label class="form-label">Nome</label>
          <input v-model="form.name" class="form-control" placeholder="Ex: Clientes inativos 30d" />
        </div>
        <div class="mb-3">
          <label class="form-label">Descrição (opcional)</label>
          <input v-model="form.description" class="form-control" />
        </div>
      </div>
    </div>

    <div class="card mb-3">
      <div class="card-body">
        <h6 class="card-title">Condições</h6>
        <RuleBuilder
          :rule="form.ruleJson.rule"
          :depth="0"
          @update:rule="form.ruleJson.rule = $event"
        />
      </div>
    </div>

    <div class="card mb-3" style="background:#fafafa">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-center">
          <div>
            <strong v-if="preview.loading">
              <span class="spinner-border spinner-border-sm me-2"></span>Calculando...
            </strong>
            <strong v-else-if="preview.count !== null">📊 {{ preview.count }} clientes correspondem</strong>
            <strong v-else class="text-danger">Erro ao avaliar regras</strong>
          </div>
          <details v-if="preview.sample.length">
            <summary class="small">Ver amostra (10)</summary>
            <ul class="small mt-2">
              <li v-for="s in preview.sample" :key="s.id">{{ s.fullName }} ({{ s.whatsapp }})</li>
            </ul>
          </details>
        </div>
      </div>
    </div>

    <div class="d-flex gap-2">
      <BaseButton variant="primary" :loading="saving" @click="save">Salvar segmento</BaseButton>
      <BaseButton variant="outline" @click="router.push('/marketing/segments')">Cancelar</BaseButton>
    </div>
  </div>
</template>
