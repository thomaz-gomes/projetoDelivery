<template>
  <div class="container p-3">
    <div class="d-flex align-items-center justify-content-between mb-3">
      <div>
        <h3 class="mb-0">{{ isNew ? 'Novo grupo' : 'Editar grupo' }}</h3>
        <small class="text-muted">Configurar membros e regras</small>
      </div>
      <div>
        <router-link class="btn btn-secondary me-2" :to="{ path: '/customer-groups' }">Voltar</router-link>
        <button class="btn btn-primary" @click="save" :disabled="saving">Salvar</button>
      </div>
    </div>

    <div class="card mb-3 p-3">
      <div class="row g-2">
        <div class="col-md-6">
          <label class="form-label">Nome</label>
          <input v-model="form.name" class="form-control" />
        </div>
        <div class="col-md-6">
          <label class="form-label">Ativo</label>
          <select v-model="form.active" class="form-select">
            <option :value="true">Sim</option>
            <option :value="false">Não</option>
          </select>
        </div>
        <div class="col-12 mt-2">
          <label class="form-label">Descrição</label>
          <input v-model="form.description" class="form-control" />
        </div>
      </div>
    </div>

    <div class="row">
      <div class="col-md-6">
        <div class="card p-3 mb-3">
          <h5>Membros</h5>
          <div class="mb-2 d-flex">
            <input v-model="memberQuery" @keyup.enter="addMemberByQuery" placeholder="Buscar cliente (telefone/nome)" class="form-control me-2" />
            <button class="btn btn-outline-primary" @click="addMemberByQuery">Adicionar</button>
          </div>
          <div v-if="membersLoading" class="small text-muted">Buscando...</div>
          <ul class="list-group">
            <li v-for="m in form.members" :key="m.id" class="list-group-item d-flex justify-content-between align-items-center">
              <div>
                <div><strong>{{ m.customer.fullName }}</strong></div>
                <div class="small text-muted">{{ m.customer.whatsapp || m.customer.phone || '' }}</div>
              </div>
              <button class="btn btn-sm btn-outline-danger" @click="removeMember(m)">Remover</button>
            </li>
            <li v-if="(form.members||[]).length===0" class="list-group-item text-muted">Sem membros</li>
          </ul>
        </div>
      </div>

      <div class="col-md-6">
        <div class="card p-3 mb-3">
          <h5>Regras</h5>
          <div class="mb-2">
            <button class="btn btn-sm btn-outline-primary" @click="addRule">Adicionar regra</button>
          </div>
          <div v-for="(r, idx) in form.rules" :key="r.id || idx" class="border rounded p-2 mb-2">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <strong>Regra {{ idx+1 }}</strong>
              <button class="btn btn-sm btn-outline-danger" @click="removeRule(idx)">Remover</button>
            </div>
            <div class="row g-2">
              <div class="col-6">
                <label class="form-label">Tipo</label>
                <select v-model="r.type" class="form-select">
                  <option value="PERCENT">Percentual</option>
                  <option value="FIXED">Valor fixo</option>
                </select>
              </div>
              <div class="col-6">
                <label class="form-label">Alvo</label>
                <select v-model="r.target" class="form-select">
                  <option value="ORDER">Pedido</option>
                  <option value="PRODUCT">Produto</option>
                  <option value="CATEGORY">Categoria</option>
                </select>
              </div>
              <div class="col-6">
                <label class="form-label">Valor</label>
                <input v-model.number="r.value" type="number" class="form-control" />
              </div>
              <div class="col-6">
                <label class="form-label">Tipo de entrega</label>
                <select v-model="r.deliveryType" class="form-select">
                  <option value="ANY">Qualquer tipo</option>
                  <option value="DELIVERY">Somente delivery</option>
                  <option value="PICKUP">Somente retirada</option>
                </select>
              </div>
              <div class="col-6">
                <label class="form-label">Min. subtotal</label>
                <input v-model.number="r.minSubtotal" type="number" class="form-control" />
              </div>
              <div class="col-12">
                <div v-if="r.target==='CATEGORY'" class="mb-2">
                  <label class="form-label">Categoria</label>
                  <select v-model="r.targetRef" class="form-select">
                    <option :value="null">-- Selecione uma categoria --</option>
                    <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
                  </select>
                </div>
                <div v-if="r.target==='PRODUCT'" class="mb-2">
                  <label class="form-label">Produto</label>
                  <select v-model="r.targetRef" class="form-select">
                    <option :value="null">-- Selecione um produto --</option>
                    <option v-for="p in products" :key="p.id" :value="p.id">{{ p.name }}{{ p.price ? ' — ' + p.price : '' }}</option>
                  </select>
                </div>

                <div class="form-check form-switch mt-2">
                  <input class="form-check-input" type="checkbox" v-model="r.alwaysAvailable" :id="`rule-always-${idx}`" />
                  <label class="form-check-label" :for="`rule-always-${idx}`">Sempre disponível (24h)</label>
                </div>

                <div class="form-check mt-2">
                  <input class="form-check-input" type="checkbox" v-model="r.noCoupon" :id="`rule-nocupom-${idx}`" />
                  <label class="form-check-label" :for="`rule-nocupom-${idx}`">Não acumular com cupom (priorizar cupom)</label>
                </div>

                <div v-if="!r.alwaysAvailable" class="mt-2">
                  <div class="table-responsive">
                    <table class="table table-sm">
                      <thead>
                        <tr>
                          <th>Dia</th>
                          <th style="width:80px">Ativo</th>
                          <th>Horário de</th>
                          <th>até</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="d in weekDays" :key="d.value">
                          <td>{{ d.label }}</td>
                          <td><input type="checkbox" v-model="r.weeklySchedule[d.value].enabled" /></td>
                          <td><input type="time" class="form-control form-control-sm" v-model="r.weeklySchedule[d.value].from" :disabled="!r.weeklySchedule[d.value].enabled" /></td>
                          <td><input type="time" class="form-control form-control-sm" v-model="r.weeklySchedule[d.value].to" :disabled="!r.weeklySchedule[d.value].enabled" /></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-if="(form.rules||[]).length===0" class="text-muted">Nenhuma regra definida</div>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'

const route = useRoute()
const router = useRouter()
const id = route.params.id || null
const isNew = !id
const saving = ref(false)
const membersLoading = ref(false)

// default weekly schedule template (0=Sunday..6=Saturday)
const defaultWeek = Array.from({ length: 7 }).map((_, i) => ({ day: i, enabled: false, from: '', to: '' }))
const weekDays = [
  { value: 0, label: 'Domingo' },
  { value: 1, label: 'Segunda-feira' },
  { value: 2, label: 'Terça-feira' },
  { value: 3, label: 'Quarta-feira' },
  { value: 4, label: 'Quinta-feira' },
  { value: 5, label: 'Sexta-feira' },
  { value: 6, label: 'Sábado' }
]

const categories = ref([])
const products = ref([])

const form = ref({ name: '', description: '', active: true, members: [], rules: [] })
const memberQuery = ref('')

async function load(){
  if(!id) return
  try{
    const { data } = await api.get(`/customer-groups/${id}`)
    form.value = {
      name: data.name,
      description: data.description,
      active: data.active,
      members: (data.members || []).map(m=>({ id: m.id, customer: m.customer })),
      rules: (data.rules || []).map(r=>({
        id: r.id,
        type: r.type,
        target: r.target,
        targetRef: r.targetRef || null,
        value: Number(r.value || 0),
        minSubtotal: r.minSubtotal,
        deliveryType: r.deliveryType || 'ANY',
        noCoupon: !!r.noCoupon,
        alwaysAvailable: r.alwaysAvailable === undefined ? true : !!r.alwaysAvailable,
        weeklySchedule: Array.isArray(r.weeklySchedule) ? r.weeklySchedule : JSON.parse(JSON.stringify(defaultWeek))
      }))
    }
  }catch(e){ console.error('Failed to load group', e) }
}

async function loadLists(){
  try{
    const cr = await api.get('/menu/categories')
    categories.value = cr.data || []
  }catch(e){ categories.value = [] }
  try{
    const pr = await api.get('/menu/products')
    products.value = pr.data || []
  }catch(e){ products.value = [] }
}

onMounted(async ()=>{ await loadLists(); load() })

async function save(){
  saving.value = true
  try{
    const payload = { name: form.value.name, description: form.value.description, active: form.value.active }
    let res
    // always include rules when creating/updating
    const body = { ...payload, rules: form.value.rules }
    if(isNew) res = await api.post('/customer-groups', body)
    else res = await api.patch(`/customer-groups/${id}`, body)
    // on create, backend returned created group with rules; navigate to edit
    const gid = res.data && (res.data.id || id)
    router.push(`/customer-groups/${gid}`)
  }catch(e){ alert('Falha ao salvar'); console.error(e) }
  saving.value = false
}

async function addMemberByQuery(){
  const q = (memberQuery.value || '').trim()
  if(!q) return
  membersLoading.value = true
  try{
    // try search customers by q
    const { data } = await api.get('/customers', { params: { q, take: 5 } })
    const pick = (data.rows || [])[0]
    if(!pick) { alert('Cliente não encontrado'); membersLoading.value=false; return }
    // if group exists persist member
    if(!isNew){
      const res = await api.post(`/customer-groups/${id}/members`, { customerId: pick.id })
      form.value.members.push(res.data)
    } else {
      // for new group, just append to local members list and mark with customer
      form.value.members.push({ id: `tmp-${Date.now()}`, customer: pick })
    }
    memberQuery.value = ''
  }catch(e){ console.error(e); alert('Falha ao buscar/adicionar') }
  membersLoading.value = false
}

async function removeMember(m){
  if(!confirm('Remover membro?')) return
  try{
    if(m.id && String(m.id).startsWith('tmp-')){
      form.value.members = form.value.members.filter(x=>x.id!==m.id)
      return
    }
    await api.delete(`/customer-groups/${id}/members/${m.id}`)
    form.value.members = form.value.members.filter(x=>x.id!==m.id)
  }catch(e){ alert('Falha ao remover') }
}

function addRule(){
  form.value.rules.push({ type: 'PERCENT', target: 'ORDER', targetRef: null, value: 0, minSubtotal: null, deliveryType: 'ANY', noCoupon: false, alwaysAvailable: true, weeklySchedule: JSON.parse(JSON.stringify(defaultWeek)) })
}

function removeRule(idx){ form.value.rules.splice(idx,1) }

</script>

<style scoped>
</style>
