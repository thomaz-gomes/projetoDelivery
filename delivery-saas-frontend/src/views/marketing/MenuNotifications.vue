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
      <!-- popup card -->
      <div class="card mb-3">
        <div class="card-body">
          <div class="form-check form-switch mb-3">
            <input class="form-check-input" type="checkbox" id="popupOn" v-model="form.popupEnabled" />
            <label class="form-check-label" for="popupOn"><strong>Modal de aviso (1x/dia)</strong></label>
          </div>

          <div v-if="form.popupEnabled" class="row">
            <div class="col-lg-7">
              <div class="mb-3">
                <TextInput label="Título (opcional)" v-model="form.popupTitle" :maxlength="100" />
              </div>
              <div class="mb-3">
                <label class="form-label"><strong>Mensagem</strong></label>
                <textarea class="form-control" rows="4" maxlength="500" v-model="form.popupMessage"></textarea>
                <small class="text-muted">{{ (form.popupMessage || '').length }}/500</small>
              </div>
              <div class="mb-3">
                <TextInput label="Texto do botão" v-model="form.popupButtonText" :maxlength="100" placeholder="Entendi" />
              </div>
              <div class="mb-3">
                <TextInput label="Link CTA (opcional)" v-model="form.popupCtaUrl" placeholder="https://..." />
              </div>
              <div class="mb-3">
                <TextInput label="Label do CTA" v-model="form.popupCtaLabel" :maxlength="100" placeholder="Saiba mais" />
              </div>
              <div class="mb-3">
                <label class="form-label d-block"><strong>Imagem (opcional)</strong></label>
                <div v-if="form.popupImageUrl" class="mb-2">
                  <img :src="assetUrl(form.popupImageUrl)" class="img-thumbnail" style="max-width:200px" />
                  <button class="btn btn-sm btn-outline-danger ms-2" :disabled="uploading" @click="removeImage">Remover</button>
                </div>
                <input type="file" class="form-control" accept="image/png,image/jpeg,image/webp" :disabled="uploading" @change="uploadImage" />
                <small v-if="uploading" class="text-muted">Enviando...</small>
              </div>
            </div>

            <div class="col-lg-5">
              <div class="text-muted small mb-1">Preview</div>
              <div class="border rounded p-3" style="max-width:340px">
                <img v-if="form.popupImageUrl" :src="assetUrl(form.popupImageUrl)" class="img-fluid mb-2" />
                <h5 v-if="form.popupTitle">{{ form.popupTitle }}</h5>
                <p class="mb-2" style="white-space:pre-wrap">{{ form.popupMessage }}</p>
                <div class="d-flex gap-2">
                  <button type="button" class="btn btn-primary btn-sm">{{ form.popupButtonText || 'Entendi' }}</button>
                  <a v-if="form.popupCtaUrl && form.popupCtaLabel" class="btn btn-outline-secondary btn-sm">
                    {{ form.popupCtaLabel }}
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
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
import TextInput from '../../components/form/input/TextInput.vue'
import { assetUrl } from '../../utils/assetUrl.js'

// Banner section is added in T9 — for this step, render placeholder div.
const BannerSection = {
  template: '<div class="card mb-3"><div class="card-body">banner-here</div></div>',
}

const menus = ref([])
const menuId = ref('')
const form = ref(defaults())
const loading = ref(false)
const saving = ref(false)
const uploading = ref(false)

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

async function uploadImage(e) {
  const file = e.target.files?.[0]
  if (!file || !menuId.value) return
  uploading.value = true
  try {
    const fd = new FormData()
    fd.append('file', file)
    const { data } = await api.post(`/menu-announcements/${menuId.value}/image`, fd)
    form.value.popupImageUrl = data?.url || null
  } catch (err) {
    Swal.fire({
      icon: 'error',
      text: err?.response?.data?.error || 'Falha no upload',
    })
  } finally {
    uploading.value = false
    // reset input so re-selecting the same file fires @change
    try { e.target.value = '' } catch (_) {}
  }
}

async function removeImage() {
  if (!menuId.value) return
  try {
    await api.delete(`/menu-announcements/${menuId.value}/image`)
    form.value.popupImageUrl = null
  } catch (err) {
    Swal.fire({
      icon: 'error',
      text: err?.response?.data?.error || 'Falha ao remover imagem',
    })
  }
}
</script>
