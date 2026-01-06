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
              <td>{{ (r._productName || (productsMap[r.productId] && productsMap[r.productId].name) || r.productId) }}</td>
              <td>{{ Number(r.cashbackPercent) }}</td>
              <td><button class="btn btn-sm btn-danger" @click="removeRule(r.id)">Remover</button></td>
            </tr>
          </tbody>
        </table>
        <hr>
        <h6>Adicionar regra</h6>
            <div class="row g-2">
              <div class="col-md-6">
                <label class="form-label visually-hidden">Produto</label>
                <select class="form-select" v-model="newRule.productId">
                  <option value="">-- Escolha um produto --</option>
                  <optgroup v-for="m in menusWithProducts" :key="m.id" :label="m.name">
                    <option v-for="p in m.products" :key="p.id" :value="p.id">{{ (p._categoryName ? p._categoryName + ' › ' : '') + p.name }}</option>
                  </optgroup>
                </select>
              </div>
              <div class="col-md-3"><input class="form-control" type="number" step="0.01" v-model.number="newRule.cashbackPercent"></div>
              <div class="col-md-3"><button class="btn btn-success w-100" @click="addRule">Adicionar</button></div>
            </div>
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
const newRule = ref({ productId: '', cashbackPercent: 0 })

const menusWithProducts = ref([]) // [{id,name,products:[{id,name,categoryId,_categoryName}]}]
const productsMap = ref({})

// helper to validate numeric percent
function normPercent(v){ const n = Number(v||0); if(Number.isNaN(n) || n < 0) return 0; return Math.round(n*100)/100 }

async function load(){
  try{
    const r = await api.get('/cashback/settings')
    settings.value = Object.assign({}, settings.value, r.data)
  }catch(e){ console.warn('load settings', e) }
  try{ const pr = await api.get('/cashback/product-rules'); rules.value = pr.data }catch(e){ console.warn('load rules', e) }

  // load menus + products + categories to populate select
  try{
    const menusResp = await api.get('/menu/menus')
    const menus = Array.isArray(menusResp.data) ? menusResp.data : []
    const out = []
    for(const m of menus){
      try{
        const params = { params: { menuId: m.id } }
        const [prodResp, catResp] = await Promise.all([api.get('/menu/products', params), api.get('/menu/categories', params)])
        const prods = Array.isArray(prodResp.data) ? prodResp.data : []
        const cats = Array.isArray(catResp.data) ? catResp.data : []
        const catById = {}
        cats.forEach(c => { if(c && c.id) catById[c.id] = c.name })
        prods.forEach(p => { productsMap.value[String(p.id)] = p; p._categoryName = catById[p.categoryId] || (p.category && p.category.name) || '' })
        out.push({ id: m.id, name: m.name || `Menu ${m.id}`, products: prods })
      }catch(e){ /* ignore per-menu errors */ }
    }
    menusWithProducts.value = out
  }catch(e){ console.warn('failed to load menus/products', e) }
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

async function addRule(){
  if(!newRule.value.productId) return alert('Selecione um produto')
  try{
    newRule.value.cashbackPercent = normPercent(newRule.value.cashbackPercent)
    const payload = { productId: newRule.value.productId, cashbackPercent: newRule.value.cashbackPercent }
    const res = await api.post('/cashback/product-rules', payload)
    // enrich rule with product name when available
    const created = res.data || {}
    if(created && created.productId && productsMap.value[String(created.productId)]) created._productName = productsMap.value[String(created.productId)].name
    rules.value.unshift(created)
    newRule.value.productId = ''
    newRule.value.cashbackPercent = 0
  }catch(e){ alert('Erro ao adicionar regra') }
}

async function removeRule(id){ if(!confirm('Remover regra?')) return; try{ await api.delete(`/cashback/product-rules/${id}`); rules.value = rules.value.filter(r=>r.id!==id) }catch(e){ alert('Erro ao remover') } }
</script>

<style scoped>
</style>
