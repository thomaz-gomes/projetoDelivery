<script setup>
import { ref, onMounted } from 'vue';
import api from '../api';
import ListCard from '../components/ListCard.vue';

const ranking = ref([]);
const loading = ref(false);
const now = new Date();
const filterFrom = ref(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
const filterTo = ref(now.toISOString().slice(0, 10));

async function load() {
  loading.value = true;
  try {
    const { data } = await api.get('/riders/ranking', { params: { from: filterFrom.value, to: filterTo.value + 'T23:59:59' } });
    ranking.value = data.ranking || data;
  } catch (e) { console.error(e); }
  finally { loading.value = false; }
}

function medalClass(pos) {
  if (pos === 1) return 'bi-trophy-fill text-warning';
  if (pos === 2) return 'bi-trophy-fill text-secondary';
  if (pos === 3) return 'bi-trophy-fill text-bronze';
  return '';
}

function fmt(val) {
  if (val == null) return '-';
  return Math.round(val) + '%';
}

onMounted(load);
</script>

<template>
  <ListCard title="Ranking de Entregadores" icon="bi-trophy" subtitle="Classificacao por desempenho no periodo">
    <template #filters>
      <div class="d-flex flex-wrap gap-2 align-items-end">
        <div>
          <label class="form-label mb-1 small">De</label>
          <input type="date" class="form-control form-control-sm" v-model="filterFrom" />
        </div>
        <div>
          <label class="form-label mb-1 small">Ate</label>
          <input type="date" class="form-control form-control-sm" v-model="filterTo" />
        </div>
        <button class="btn btn-primary btn-sm" @click="load" :disabled="loading">
          <i class="bi-search me-1"></i>Filtrar
        </button>
      </div>
    </template>

    <div v-if="loading" class="text-center py-4">
      <div class="spinner-border spinner-border-sm text-primary"></div>
      <span class="ms-2 text-muted">Carregando...</span>
    </div>

    <div v-else-if="!ranking.length" class="text-center text-muted py-4">
      Nenhum entregador encontrado no periodo.
    </div>

    <div v-else class="table-responsive">
      <table class="table table-hover align-middle mb-0">
        <thead>
          <tr>
            <th style="width:50px">#</th>
            <th>Nome</th>
            <th class="text-center">Entregas</th>
            <th class="text-center">Tempo Medio</th>
            <th class="text-center">Pontualidade</th>
            <th class="text-center">Codigo iFood</th>
            <th class="text-center">Conclusao</th>
            <th class="text-center">Score</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in ranking" :key="r.riderId">
            <td>
              <i v-if="medalClass(i + 1)" :class="medalClass(i + 1)" style="font-size:1.2rem"></i>
              <span v-else class="fw-semibold">{{ i + 1 }}</span>
            </td>
            <td class="fw-semibold">{{ r.riderName }}</td>
            <td class="text-center">{{ r.totalDeliveries }}</td>
            <td class="text-center">{{ r.avgDeliveryTime != null ? Math.round(r.avgDeliveryTime) + ' min' : '-' }}</td>
            <td class="text-center">{{ fmt(r.punctualityRate) }}</td>
            <td class="text-center">{{ fmt(r.ifoodCodeRate) }}</td>
            <td class="text-center">{{ fmt(r.completionRate) }}</td>
            <td class="text-center fw-bold">{{ r.score != null ? Math.round(r.score) : '-' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </ListCard>
</template>

<style scoped>
.text-bronze { color: #cd7f32; }
</style>
