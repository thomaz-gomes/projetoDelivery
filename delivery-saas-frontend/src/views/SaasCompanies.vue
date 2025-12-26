<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'
import Swal from 'sweetalert2'

const companies = ref([])
const plans = ref([])

const form = ref({ name: '', masterName: '', masterEmail: '', masterPassword: '', planId: '' })

async function load(){
  const [cRes, pRes] = await Promise.all([
    api.get('/saas/companies'),
    api.get('/saas/plans')
  ])
  companies.value = cRes.data || []
  plans.value = pRes.data || []
}

onMounted(load)

async function createCompany(){
  if(!form.value.name || !form.value.masterName || !form.value.masterEmail || !form.value.masterPassword) return
  await api.post('/saas/companies', form.value)
  form.value = { name: '', masterName: '', masterEmail: '', masterPassword: '', planId: '' }
  await load()
}

const router = useRouter()
function editCompany(c){
  router.push(`/saas/companies/${c.id}/edit`)
}

async function toggleSuspend(c){
  try{
    const action = await api.get(`/saas/subscription/${c.id}`).then(()=>null).catch(()=>null)
    // ask whether to suspend or reactivate
    const confirmSuspend = window.confirm(`Suspender empresa "${c.name}"? Ao suspender, acessos serão limitados.`)
    if (!confirmSuspend) return
    await api.post(`/saas/companies/${c.id}/suspend`, { suspend: true })
    await load()
  }catch(e){ console.error(e) }
}

async function deleteCompany(c){
  try{
    if (!window.confirm(`Excluir empresa "${c.name}"? Esta ação fará desativação (soft-delete). Continuar?`)) return
    await api.delete(`/saas/companies/${c.id}`)
    await load()
  }catch(e){ console.error(e) }
}

async function changePassword(c){
  try{
    const res = await Swal.fire({
      title: `Trocar senha — ${c.name}`,
      html: `
        <input id="swal-pw" type="password" class="swal2-input" placeholder="Nova senha">
        <input id="swal-pw2" type="password" class="swal2-input" placeholder="Confirmar senha">
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Atualizar',
      preConfirm: () => {
        const pw = document.getElementById('swal-pw')?.value || ''
        const pw2 = document.getElementById('swal-pw2')?.value || ''
        if (!pw) {
          Swal.showValidationMessage('Senha obrigatória')
          return false
        }
        if (pw.length < 6) {
          Swal.showValidationMessage('Senha deve ter ao menos 6 caracteres')
          return false
        }
        if (pw !== pw2) {
          Swal.showValidationMessage('Senhas não coincidem')
          return false
        }
        return { password: pw }
      }
    })
    if (!res || !res.isConfirmed) return
    const payload = res.value || res
    await api.post(`/saas/companies/${c.id}/password`, { password: payload.password })
    await Swal.fire({ icon: 'success', title: 'Senha atualizada', timer: 1800, showConfirmButton: false })
  }catch(e){ console.error(e); Swal.fire({ icon: 'error', title: 'Erro', text: 'Falha ao atualizar senha. Veja console.' }) }
}
</script>

<template>
  <div class="container py-3">
    <h2 class="mb-3">Empresas (Clientes do SaaS)</h2>

    <div class="d-flex justify-content-between mb-3">
      <div>
        <h5 class="card-title">Empresas</h5>
        <div class="small text-muted">Gerencie clientes do SaaS</div>
      </div>
      <div>
        <router-link class="btn btn-primary" to="/saas/companies/new">Criar empresa</router-link>
      </div>
    </div>

    <div class="card">
      <div class="card-body">
        <h6>Empresas</h6>
        <table class="table table-sm">
          <thead>
            <tr><th>Nome</th><th>Slug</th><th>Criada em</th><th>Ações</th></tr>
          </thead>
          <tbody>
            <tr v-for="c in companies" :key="c.id">
              <td>{{ c.name }}</td>
              <td>{{ c.slug || '—' }}</td>
              <td>{{ new Date(c.createdAt).toLocaleString() }}</td>
              <td>
                <div class="btn-group">
                  <button class="btn btn-sm btn-outline-secondary" @click="editCompany(c)">Editar</button>
                  <button class="btn btn-sm btn-outline-secondary" @click="changePassword(c)">Trocar senha</button>
                  <button class="btn btn-sm btn-outline-warning" @click="toggleSuspend(c)">Suspender</button>
                  <button class="btn btn-sm btn-outline-danger" @click="deleteCompany(c)">Excluir</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
