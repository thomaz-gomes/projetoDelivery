<template>
  <div class="container py-4">
    <h3>Configurações de Cashback</h3>
    <div class="card mb-3">
      <div class="card-body">
        <div class="form-check form-switch mb-2">
          <input class="form-check-input" type="checkbox" v-model="settings.enabled" id="cbEnabled">
          <label class="form-check-label" for="cbEnabled">Ativar módulo de cashback</label>
        </div>
        <div class="mb-2">
          <label class="form-label">Percentual padrão (%)</label>
          <input class="form-control" v-model.number="settings.defaultPercent" type="number" step="0.01">
        </div>
        <div class="mb-2">
          <label class="form-label">Valor mínimo para resgate (R$)</label>
          <input class="form-control" v-model.number="settings.minRedeemValue" type="number" step="0.01">
        </div>
        <div class="d-flex gap-2">
          <button class="btn btn-primary" @click="save">Salvar</button>
        </div>
      </div>
    </div>

    <div v-if="settings.enabled" class="card">
      <div class="card-body">
        <h5>Cashback por Produto</h5>
        <p class="small text-muted">Se o produto não estiver nesta lista, será aplicado o percentual padrão do cashback.</p>
        <table class="table">
          <thead><tr><th>Produto</th><th>Percentual (%)</th><th>Ações</th></tr></thead>
          <tbody>
            <tr v-for="r in rules" :key="r.id">
              <td>{{ r._productName || r.productName || r.productId }}</td>
              <td>{{ Number(r.cashbackPercent) }}</td>
              <td><button class="btn btn-sm btn-danger" @click="removeRule(r.id)">Remover</button></td>
            </tr>
          </tbody>
        </table>
        <hr>
        <div class="alert alert-info small">Defina o cashback específico de cada produto na tela de cadastro/edição de produto.</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../api'
import Swal from 'sweetalert2'

const settings = ref({ enabled: false, defaultPercent: 0, minRedeemValue: 0 })
const rules = ref([])

// helper to validate numeric percent
function normPercent(v){ const n = Number(v||0); if(Number.isNaN(n) || n < 0) return 0; return Math.round(n*100)/100 }

async function load(){
  try{
    const r = await api.get('/cashback/settings')
    settings.value = Object.assign({}, settings.value, r.data)
  }catch(e){ console.warn('load settings', e) }
  try{ const pr = await api.get('/cashback/product-rules'); rules.value = pr.data }catch(e){ console.warn('load rules', e) }
}
onMounted(load)

async function save(){
  try{
    settings.value.defaultPercent = normPercent(settings.value.defaultPercent)
    await api.put('/cashback/settings', settings.value)
    Swal.fire({ icon: 'success', title: 'Salvo', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 })
  }catch(e){
    const msg = e?.response?.data?.message || 'Erro ao salvar'
    Swal.fire({ icon: 'error', title: 'Erro', text: msg })
  }
}

// product-level rules are managed on the product edit screen; adding via this UI removed

async function removeRule(id){ if(!confirm('Remover regra?')) return; try{ await api.delete(`/cashback/product-rules/${id}`); rules.value = rules.value.filter(r=>r.id!==id) }catch(e){ alert('Erro ao remover') } }
</script>

<style scoped>
</style>
