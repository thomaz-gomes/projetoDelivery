<template>
  <div class="container py-5 text-center">
    <div v-if="loading">Redirecionando…</div>
    <div v-else-if="error" class="alert alert-danger">{{ error }}</div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'

const route = useRoute()
const router = useRouter()
const slug = route.params.storeSlug
const loading = ref(true)
const error = ref('')

onMounted(async () => {
  try {
    const res = await api.get(`/public/${encodeURIComponent(slug)}`)
    const data = res.data || {}
    // prefer explicit menuId -> navigate to menu scoped view
    if (data.menuId && data.companyId) {
      const q = {}
      if (data.menuId) q.menuId = data.menuId
      if (data.storeId) q.storeId = data.storeId
      await router.replace({ path: `/public/${data.companyId}/menu`, query: q })
      return
    }
    // store-only resolution
    if (data.companyId && data.storeId) {
      await router.replace({ path: `/public/${data.companyId}/menu`, query: { storeId: data.storeId } })
      return
    }
    // company-only resolution
    if (data.companyId) {
      await router.replace({ path: `/public/${data.companyId}/menu` })
      return
    }
    error.value = 'Página pública não encontrada.'
  } catch (e) {
    console.error('Slug resolve failed', e)
    // If backend redirected (non-JSON) axios may have followed and returned JSON menu payload.
    // Try to extract company id from response if possible
    try {
      const d = e?.response?.data
      if (d && d.company && d.company.id) {
        // we have menu payload; navigate to canonical route using company id
        await router.replace({ path: `/public/${d.company.id}/menu` })
        return
      }
    } catch (inner) { /* ignore */ }
    error.value = e?.response?.data?.message || e.message || 'Erro ao resolver link público.'
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.container { max-width: 720px }
</style>
