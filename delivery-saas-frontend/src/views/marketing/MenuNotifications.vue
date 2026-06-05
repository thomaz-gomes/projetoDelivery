<template>
  <div class="container py-4">
    <h2 class="mb-3">Avisos no Cardápio</h2>

    <div class="row mb-4">
      <div class="col-md-6">
        <label class="form-label">Cardápio</label>
        <SelectInput v-model="menuId" @update:modelValue="loadAnnouncement">
          <option v-if="!menus.length" value="">Nenhum cardápio disponível</option>
          <option v-for="m in menus" :key="m.id" :value="m.id">{{ m.name }}</option>
        </SelectInput>
      </div>
    </div>

    <div v-if="loading" class="text-muted">
      <span class="spinner-border spinner-border-sm me-2"></span> Carregando...
    </div>

    <template v-else-if="menuId">
      <!-- popup card (T8 will replace with real markup) -->
      <PopupSection v-model="form" />
      <!-- banner card (T9 will replace with real markup) -->
      <BannerSection v-model="form" />

      <div class="position-sticky bottom-0 bg-white py-3 border-top">
        <button class="btn btn-primary" :disabled="saving" @click="save">
          <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
          {{ saving ? 'Salvando...' : 'Salvar' }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import Swal from 'sweetalert2'
import api from '../../api'
import SelectInput from '../../components/form/select/SelectInput.vue'

// Sections are added in later tasks (T8/T9) — for this step, render placeholder divs.
// Kept inline (not extracted) per plan.
const PopupSection = {
  template: '<div class="card mb-3"><div class="card-body">popup-here</div></div>',
}
const BannerSection = {
  template: '<div class="card mb-3"><div class="card-body">banner-here</div></div>',
}

const menus = ref([])
const menuId = ref('')
const form = ref(defaults())
const loading = ref(false)
const saving = ref(false)

function defaults() {
  return {
    popupEnabled: false,
    popupTitle: '',
    popupMessage: '',
    popupButtonText: 'Entendi',
    popupCtaUrl: '',
    popupCtaLabel: '',
    popupImageUrl: null,
    bannerEnabled: false,
    bannerText: '',
    bannerBgColor: '#0d6efd',
  }
}

onMounted(async () => {
  try {
    const { data } = await api.get('/menu/menus')
    menus.value = Array.isArray(data) ? data : (data?.items || [])
  } catch (e) {
    Swal.fire({ icon: 'error', text: 'Falha ao carregar cardápios' })
    return
  }
  if (menus.value.length) {
    menuId.value = menus.value[0].id
    await loadAnnouncement()
  }
})

async function loadAnnouncement() {
  if (!menuId.value) return
  loading.value = true
  try {
    const { data } = await api.get(`/menu-announcements/${menuId.value}`)
    form.value = data ? { ...defaults(), ...data } : defaults()
  } catch (e) {
    form.value = defaults()
    Swal.fire({
      icon: 'error',
      text: e?.response?.data?.error || 'Falha ao carregar avisos',
    })
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!menuId.value) return
  saving.value = true
  try {
    const { data } = await api.put(`/menu-announcements/${menuId.value}`, form.value)
    form.value = { ...defaults(), ...data }
    Swal.fire({
      icon: 'success',
      text: 'Salvo',
      timer: 1500,
      showConfirmButton: false,
    })
  } catch (e) {
    Swal.fire({
      icon: 'error',
      text: e?.response?.data?.error || 'Erro ao salvar',
    })
  } finally {
    saving.value = false
  }
}
</script>
