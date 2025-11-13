<template>
  <ListCard title="Afiliados" icon="bi bi-handshake" :subtitle="affiliates?.length ? `${affiliates.length} itens` : ''">
    <template #actions>
      <button @click="goNewAffiliate" class="btn btn-primary"><i class="bi bi-person-plus me-1"></i> Novo Afiliado</button>
    </template>

    <template #default>
      <div v-if="loading" class="text-center py-4">Carregando afiliados...</div>
      <div v-else-if="error" class="alert alert-danger d-flex align-items-center justify-content-between">
        <div><i class="bi bi-exclamation-triangle me-2"></i>{{ error }}</div>
        <button @click="loadAffiliates" class="btn btn-outline-secondary">Tentar novamente</button>
      </div>
      <div v-else>
        <div class="table-responsive">
          <table class="table table-striped align-middle mb-0">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Cupom</th>
                <th>Comissão</th>
                <th>Saldo</th>
                <th>Vendas</th>
                <th>Status</th>
                <th style="width:160px">Ações</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="affiliate in affiliates" :key="affiliate.id">
                <td>
                  <div><strong>{{ affiliate.name }}</strong></div>
                  <div class="small text-muted">
                    <span v-if="affiliate.email"><i class="bi bi-envelope me-1"></i>{{ affiliate.email }}</span>
                    <span v-if="affiliate.whatsapp" class="ms-2"><i class="bi bi-whatsapp me-1"></i>{{ affiliate.whatsapp }}</span>
                  </div>
                </td>
                <td><span class="badge bg-light text-primary">{{ affiliate.couponCode }}</span></td>
                <td>{{ (affiliate.commissionRate * 100).toFixed(1) }}%</td>
                <td><strong class="" :class="Number(affiliate.currentBalance) > 0 ? 'text-success' : ''">R$ {{ Number(affiliate.currentBalance || 0).toFixed(2) }}</strong></td>
                <td>{{ affiliate._Count?.sales || affiliate._count?.sales || 0 }} vendas</td>
                <td><span :class="affiliate.isActive ? 'text-success' : 'text-danger'">{{ affiliate.isActive ? 'Ativo' : 'Inativo' }}</span></td>
                <td>
                  <div class="d-flex">
                    <button @click="editAffiliate(affiliate)" class="btn btn-sm btn-light me-2"><i class="bi bi-pencil-square"></i></button>
                    <button @click="viewDetails(affiliate)" class="btn btn-sm btn-outline-secondary me-2"><i class="bi bi-eye"></i></button>
                    <button @click="goToStatement(affiliate)" class="btn btn-sm btn-outline-info me-2"><i class="bi bi-file-earmark-text"></i></button>
                    <button v-if="Number(affiliate.currentBalance || 0) > 0" @click="goToPayment(affiliate)" class="btn btn-sm btn-success me-2"><i class="bi bi-credit-card"></i></button>
                    <button @click="addManualSale(affiliate)" class="btn btn-sm btn-primary"><i class="bi bi-receipt"></i></button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="affiliates.length === 0" class="text-center py-4 text-secondary">
          <i class="bi bi-handshake" style="font-size:32px"></i>
          <p class="mt-3">Nenhum afiliado cadastrado</p>
          <button @click="goNewAffiliate" class="btn btn-primary"><i class="bi bi-person-plus me-1"></i> Cadastrar primeiro afiliado</button>
        </div>
      </div>
    </template>
  </ListCard>
</template>

<script>
import { ref, onMounted } from 'vue'
import Swal from 'sweetalert2'
import { bindLoading } from '../state/globalLoading.js'
import AffiliateSaleForm from '@/components/AffiliateSaleForm.vue'
import { useRouter } from 'vue-router'
import api from '@/api.js'
import ListCard from '@/components/ListCard.vue'

export default {
  name: 'AffiliateListing',
  components: { AffiliateSaleForm, ListCard },
  setup() {
    const affiliates = ref([])
  const loading = ref(false)
  bindLoading(loading)
    const error = ref('')
    const router = useRouter()
    
    // Payment handled on dedicated page /affiliates/:id/payments/new

    // Sale modal
    const showSaleForm = ref(false)
    const saleAffiliate = ref(null)
    const saleLoading = ref(false)
    const saleForm = ref({
      saleAmount: '',
      note: ''
    })

    const loadAffiliates = async () => {
      loading.value = true
      error.value = ''
      try {
          const response = await api.get('/affiliates')
        // Normalize numeric fields to avoid runtime type errors (Prisma Decimal/string)
        affiliates.value = (response.data || []).map(a => ({
          ...a,
          currentBalance: Number(a.currentBalance || 0),
          commissionRate: Number(a.commissionRate || 0)
        }))
      } catch (err) {
          error.value = err.response?.data?.message || 'Erro ao carregar afiliados'
          console.error('Error loading affiliates:', err)
          await Swal.fire({ icon: 'error', text: err.response?.data?.message || 'Erro ao carregar afiliados' })
      } finally {
        loading.value = false
      }
    }

    const editAffiliate = (affiliate) => {
      router.push(`/affiliates/${affiliate.id}/edit`)
    }

    const viewDetails = (affiliate) => {
      router.push(`/affiliates/${affiliate.id}`)
    }

    // Payment modal removed; navigation to payment page is handled by button router.push

    const addManualSale = (affiliate) => {
      router.push(`/affiliates/${affiliate.id}/sales/new`)
    }

    const goToPayment = (affiliate) => {
      router.push(`/affiliates/${affiliate.id}/payments/new`)
    }

    const goToStatement = (affiliate) => {
      router.push(`/affiliates/${affiliate.id}/statement`)
    }

    const goNewAffiliate = () => {
      router.push('/affiliates/new')
    }

    // processPayment moved to dedicated payment page

    const processSaleFromModal = async (payload) => {
      if (!saleAffiliate.value) return

      saleLoading.value = true
      try {
        const response = await api.post(`/affiliates/${saleAffiliate.value.id}/sales`, payload)

        // Update affiliate balance locally
        const affiliate = affiliates.value.find(a => a.id === saleAffiliate.value.id)
        if (affiliate && response.data.affiliate) {
          affiliate.currentBalance = Number(response.data.affiliate.currentBalance || 0)
          affiliate._count = affiliate._count || {}
          affiliate._count.sales = (affiliate._count.sales || 0) + 1
        }

        closeSaleModal()
        // Could show success toast here
      } catch (err) {
          await Swal.fire({ icon: 'error', text: err.response?.data?.message || 'Erro ao registrar venda' })
      } finally {
        saleLoading.value = false
      }
    }

    // onAffiliateSaved/inline form logic removed; use separate pages for create/edit

    // closePaymentModal removed (payment page handles closing/navigation)

    const closeSaleModal = () => {
      showSaleForm.value = false
      saleAffiliate.value = null
      saleForm.value = { saleAmount: '', note: '' }
    }

    const toggleStatus = async (affiliate) => {
      const newStatus = !affiliate.isActive
      const action = newStatus ? 'ativar' : 'desativar'
      
        const conf = await Swal.fire({ title: 'Confirmação', text: `Tem certeza que deseja ${action} o afiliado ${affiliate.name}?`, icon: 'question', showCancelButton: true, confirmButtonText: 'Sim', cancelButtonText: 'Cancelar' })
        if(!conf.isConfirmed) return

      try {
        const response = await api.put(`/affiliates/${affiliate.id}`, {
          isActive: newStatus
        })
        
        // Update local state
        const index = affiliates.value.findIndex(a => a.id === affiliate.id)
        if (index !== -1) {
          affiliates.value[index] = response.data
        }
        
        // Could show success toast here
      } catch (err) {
          await Swal.fire({ icon: 'error', text: err.response?.data?.message || `Erro ao ${action} afiliado` })
      }
    }

    onMounted(() => {
      loadAffiliates()
    })

    return {
      affiliates,
      loading,
      error,
  // router helpers
  goNewAffiliate,
  showSaleForm,
      saleAffiliate,
      saleLoading,
      saleForm,
      loadAffiliates,
      editAffiliate,
      viewDetails,
  addManualSale,
  goToPayment,
  goToStatement,
  processSaleFromModal,
      closeSaleModal,
      toggleStatus
    }
  }
}
</script>

<style scoped>
.affiliate-listing {
  padding: 20px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.header h1 {
  margin: 0;
  color: #333;
}

.loading, .error {
  text-align: center;
  padding: 40px;
  color: #666;
}

.error {
  color: #e74c3c;
}

.affiliates-table {
  background: white;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
}

table {
  width: 100%;
  border-collapse: collapse;
}

th, td {
  padding: 12px;
  text-align: left;
  border-bottom: 1px solid #eee;
}

th {
  background-color: #f8f9fa;
  font-weight: 600;
  color: #555;
}

.affiliate-info strong {
  display: block;
  margin-bottom: 4px;
}

.contact-info {
  font-size: 0.85em;
  color: #666;
}

.contact-info span {
  display: block;
  margin-bottom: 2px;
}

.coupon-code {
  background: #e3f2fd;
  color: #1976d2;
  padding: 4px 8px;
  border-radius: 4px;
  font-family: monospace;
  font-weight: bold;
}

.balance {
  font-weight: bold;
}

.balance.positive {
  color: #27ae60;
}

.status {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.85em;
  font-weight: bold;
}

.status.active {
  background: #d4edda;
  color: #155724;
}

.status.inactive {
  background: #f8d7da;
  color: #721c24;
}

.actions {
  display: flex;
  gap: 5px;
}

.btn-icon {
  padding: 6px 8px;
  border: none;
  border-radius: 4px;
  background: #f8f9fa;
  color: #666;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-icon:hover {
  background: #e9ecef;
  color: #333;
}

.btn-payment {
  background: #27ae60;
  color: white;
}

.btn-payment:hover {
  background: #219a52;
}

.btn-sale {
  background: #3498db;
  color: white;
}

.btn-sale:hover {
  background: #2980b9;
}

.btn-edit {
  background: #f39c12;
  color: white;
}

.btn-edit:hover {
  background: #e67e22;
}

.btn-view {
  background: #95a5a6;
  color: white;
}

.btn-view:hover {
  background: #7f8c8d;
}

.btn-activate {
  background: #27ae60;
  color: white;
}

.btn-activate:hover {
  background: #219a52;
}

.btn-deactivate {
  background: #e74c3c;
  color: white;
}

.btn-deactivate:hover {
  background: #c0392b;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #666;
}

.empty-state i {
  font-size: 48px;
  margin-bottom: 16px;
  color: #ddd;
}

.form-section {
  background: white;
  border-radius: 8px;
  margin-bottom: 20px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
  border: 2px solid #3498db;
}

.form-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid #eee;
  background: #f8f9fa;
  border-radius: 8px 8px 0 0;
}

.form-header h2 {
  margin: 0;
  color: #333;
}

.form-container {
  max-width: none;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  backdrop-filter: blur(2px);
}

.modal {
  background: white;
  border-radius: 8px;
  width: 90%;
  max-width: 500px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 10px 30px rgba(0,0,0,0.3);
  z-index: 10000;
  position: relative;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid #eee;
}

.modal-header h2 {
  margin: 0;
  color: #333;
}

.btn-close {
  background: none;
  border: none;
  font-size: 18px;
  color: #666;
  cursor: pointer;
  padding: 5px;
}

.modal-body {
  padding: 20px;
}

.payment-modal {
  max-width: 500px;
}

.sale-info {
  background: #f8f9fa;
  padding: 15px;
  border-radius: 6px;
  margin-bottom: 20px;
}

.commission-preview {
  background: #e8f5e8;
  color: #27ae60;
  padding: 12px;
  border-radius: 6px;
  margin-bottom: 20px;
}

.payment-info {
  background: #f8f9fa;
  padding: 15px;
  border-radius: 6px;
  margin-bottom: 20px;
}

.contact-info {
  margin: 5px 0;
  font-size: 14px;
  color: #666;
}

.contact-info i {
  margin-right: 5px;
  width: 15px;
}

.btn-max {
  background: #3498db;
  color: white;
  border: none;
  padding: 5px 10px;
  border-radius: 4px;
  margin-left: 10px;
  cursor: pointer;
  font-size: 12px;
}

.btn-max:hover {
  background: #2980b9;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-weight: 500;
  color: #333;
}

.form-group input,
.form-group select,
.form-group textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
}

.form-group input:focus,
.form-group select:focus,
.form-group textarea:focus {
  outline: none;
  border-color: #3498db;
}

.commission-preview {
  background: #e8f5e8;
  padding: 12px;
  border-radius: 6px;
  margin-bottom: 20px;
  color: #27ae60;
}

.form-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 20px;
}

.btn-primary, .btn-secondary {
  padding: 10px 20px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
}

.btn-primary {
  background: #3498db;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #2980b9;
}

.btn-primary:disabled {
  background: #bdc3c7;
  cursor: not-allowed;
}

.btn-secondary {
  background: #f8f9fa;
  color: #666;
  border: 1px solid #ddd;
}

.btn-secondary:hover {
  background: #e9ecef;
}
</style>