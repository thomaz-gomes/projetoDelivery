<template>
  <div class="container py-4">
    <div class="card mb-5">
      <div class="card-body">
        <h4 class="card-title">Painel do Afiliado</h4>
        <p class="lead">Bem-vindo(a), <strong>{{ affiliate.name || user?.name }}</strong></p>
        <div class="row">
          <div class="col-12 col-md-8">
            <p>Use este painel para ver seu saldo, extrato e cupons.</p>
          </div>
          <div class="col-12 col-md-4">
            <div class="card p-2">
              <div><strong>Cupom</strong></div>
              <div class="monospace">{{ affiliate.couponCode || '-' }}</div>
              <div class="mt-2"><strong>Comissão</strong></div>
              <div>{{ commissionPercent }}</div>
            </div>
          </div>
        </div>

        <div class="mt-3">
          <button class="btn btn-outline-secondary me-2" @click="goStatementSelf">Meu Extrato</button>
              </div>
      </div>
    </div>

    <AffiliateFooter />
  </div>
</template>
    <script setup>
    import { computed, ref, onMounted } from 'vue'
    import { useAuthStore } from '../../stores/auth'
    import { useRouter } from 'vue-router'
    import api from '@/api'
    import AffiliateFooter from '../../components/AffiliateFooter.vue'

    const auth = useAuthStore()
    const router = useRouter()
    const user = computed(() => auth.user)

    const affiliate = ref({ id: '', name: '', couponCode: '', commissionRate: 0 })

    async function loadAffiliate() {
      try {
        const id = auth.user?.affiliateId || auth.user?.id
        if (!id) return
        const res = await api.get(`/affiliates/${id}`)
        affiliate.value = res.data || affiliate.value
      } catch (e) {
        console.warn('Failed to load affiliate details', e)
      }
    }

    onMounted(() => { loadAffiliate() })

    const commissionPercent = computed(() => {
      const pct = Number(affiliate.value.commissionRate || 0) * 100
      return `${pct.toFixed(1)}%`
    })

    function goStatement() {
      const id = auth.user?.affiliateId || auth.user?.id
      if (id) router.push(`/affiliates/${id}/statement`)
    }
    function goStatementSelf() { router.push('/affiliate/statement') }
    function goAccount() { router.push('/settings/users') }

    </script>

    <style scoped>
    .lead { margin-bottom: 12px; }
    .monospace { font-family: monospace; font-size: 14px; word-break: break-all; overflow-wrap: anywhere }
    .card { word-break: break-word }
    /* ensure no horizontal scroll */
    .container { max-width: 100%; padding-left: 12px; padding-right: 12px }
    @media (max-width: 600px) {
      .card .card-body { padding: 12px }
      .lead { font-size: 15px }
    }
    </style>
