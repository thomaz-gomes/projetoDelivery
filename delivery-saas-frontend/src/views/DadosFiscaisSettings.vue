<template>
  <div class="container py-4">
    <div class="d-flex align-items-center justify-content-between mb-3">
      <h2 class="m-0">Dados Fiscais</h2>
      <div>
        <router-link class="btn btn-primary" to="/settings/dados-fiscais/new">Criar novo</router-link>
      </div>
    </div>

    <div v-if="loading" class="text-center py-3">Carregando...</div>
    <div v-else>
      <div class="table-responsive">
        <table class="table table-striped">
          <thead>
            <tr>
              <th>Descrição</th>
              <th>NCM</th>
              <th>CFOPs</th>
              <th style="width:200px">Ações</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="list.length === 0">
              <td colspan="4" class="text-center text-muted py-3">Nenhum dado fiscal cadastrado.</td>
            </tr>
            <tr v-for="item in list" :key="item.id">
              <td><strong>{{ item.descricao }}</strong></td>
              <td class="text-muted">{{ item.ncm || '—' }}</td>
              <td class="text-muted">{{ formatCfops(item.cfops) }}</td>
              <td>
                <router-link class="btn btn-sm btn-outline-primary me-2" :to="`/settings/dados-fiscais/${item.id}`">Editar</router-link>
                <button class="btn btn-sm btn-danger" @click="remove(item)">Remover</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../api'
import Swal from 'sweetalert2'

const list = ref([])
const loading = ref(false)

function formatCfops(raw) {
  if (!raw) return '—'
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(arr)) return '—'
    return arr.map(c => typeof c === 'string' ? c : c.code).join(', ') || '—'
  } catch { return '—' }
}

async function load() {
  loading.value = true
  try {
    const r = await api.get('/settings/dados-fiscais')
    list.value = r.data || []
  } catch (e) {
    Swal.fire({ icon: 'error', text: 'Falha ao carregar dados fiscais' })
  } finally {
    loading.value = false
  }
}

async function remove(item) {
  const r = await Swal.fire({
    title: 'Excluir?',
    text: `Remover "${item.descricao}"? Categorias e produtos vinculados perderão a referência fiscal.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sim, excluir',
    cancelButtonText: 'Cancelar'
  })
  if (!r.isConfirmed) return
  try {
    await api.delete(`/settings/dados-fiscais/${item.id}`)
    await load()
    Swal.fire({ icon: 'success', toast: true, position: 'top-end', showConfirmButton: false, timer: 1600, text: 'Removido' })
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Erro ao remover' })
  }
}

onMounted(load)
</script>
