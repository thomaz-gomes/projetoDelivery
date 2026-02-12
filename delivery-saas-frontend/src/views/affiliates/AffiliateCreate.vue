<template>
  <div class="affiliate-page">
    <h1>Criar Afiliado</h1>
    <AffiliateForm @saved="onSaved" @cancel="onCancel" />
  </div>
</template>

<script>
import AffiliateForm from '@/components/AffiliateForm.vue'
import { useRouter } from 'vue-router'

export default {
  name: 'AffiliateCreate',
  components: { AffiliateForm },
  setup() {
    const router = useRouter()

    const onSaved = (saved) => {
      // After creating, navigate to listing
      router.push('/affiliates')
    }

    const onCancel = () => {
      router.push('/affiliates')
    }

    return {
      onSaved,
      onCancel
    }
  }
}
</script>

<style scoped>
.affiliate-page { padding: 20px }
</style>
