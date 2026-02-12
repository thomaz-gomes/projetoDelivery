<template>
  <div class="affiliate-page">
    <h1>Editar Afiliado</h1>
    <div v-if="loading">Carregando...</div>
    <div v-else>
      <AffiliateForm :affiliate="affiliate" @saved="onSaved" @cancel="onCancel" />
    </div>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/api.js'
import { bindLoading } from '../../state/globalLoading.js'
import AffiliateForm from '@/components/AffiliateForm.vue'

export default {
  name: 'AffiliateEdit',
  components: { AffiliateForm },
  setup() {
    const route = useRoute()
    const router = useRouter()
    const affiliate = ref(null)
  const loading = ref(true)
  const notFound = ref(false)
  bindLoading(loading)

    const load = async () => {
      loading.value = true
      try {
        const res = await api.get(`/affiliates/${route.params.id}`)
        affiliate.value = res.data
        notFound.value = false
      } catch (err) {
        console.error('Failed to load affiliate', err)
        if (err?.response?.status === 404) {
          notFound.value = true
        }
      } finally {
        loading.value = false
      }
    }

    const onSaved = (saved) => {
      router.push('/affiliates')
    }

    const onCancel = () => router.push('/affiliates')

    onMounted(load)

    return { affiliate, loading, notFound, onSaved, onCancel }
  }
}
</script>

<style scoped>
.affiliate-page { padding: 20px }
</style>
