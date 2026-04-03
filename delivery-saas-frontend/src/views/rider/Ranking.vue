<script setup>
import { ref, onMounted, computed } from 'vue';
import api from '../../api';
import MobileBottomNav from '../../components/MobileBottomNav.vue';

const ranking = ref([]);
const myRiderId = ref(null);
const loading = ref(false);
const now = new Date();
const filterFrom = ref(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
const filterTo = ref(now.toISOString().slice(0, 10));

async function load() {
  loading.value = true;
  try {
    const { data } = await api.get('/riders/ranking', { params: { from: filterFrom.value, to: filterTo.value + 'T23:59:59' } });
    ranking.value = data.ranking || [];
    myRiderId.value = data.myRiderId || null;
  } catch (e) { console.error(e); }
  finally { loading.value = false; }
}

const myRanking = computed(() => ranking.value.find(r => r.riderId === myRiderId.value));
const myPosition = computed(() => {
  const idx = ranking.value.findIndex(r => r.riderId === myRiderId.value);
  return idx >= 0 ? idx + 1 : null;
});

function medalClass(pos) {
  if (pos === 1) return 'bi-trophy-fill text-warning';
  if (pos === 2) return 'bi-trophy-fill text-secondary';
  if (pos === 3) return 'bi-trophy-fill text-bronze';
  return '';
}

function medalLabel(pos) {
  if (pos === 1) return 'Ouro';
  if (pos === 2) return 'Prata';
  if (pos === 3) return 'Bronze';
  return '';
}

function fmt(val) {
  if (val == null) return 0;
  return Math.round(val);
}

onMounted(load);
</script>

<template>
  <div class="p-3 rider-ranking">
    <h5 class="mb-3"><i class="bi-trophy me-2"></i>Ranking de Entregadores</h5>

    <!-- Period filter -->
    <div class="d-flex flex-wrap gap-2 align-items-end mb-3">
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

    <div v-if="loading" class="text-center py-4">
      <div class="spinner-border spinner-border-sm text-primary"></div>
      <span class="ms-2 text-muted">Carregando...</span>
    </div>

    <template v-else>
      <!-- My position card -->
      <div v-if="myRanking" class="card mb-3 border-primary">
        <div class="card-body text-center">
          <div class="mb-1 text-muted small">Sua posicao</div>
          <div class="d-flex justify-content-center align-items-center gap-2 mb-2">
            <span class="display-4 fw-bold text-primary">{{ myPosition }}</span>
            <i v-if="medalClass(myPosition)" :class="medalClass(myPosition)" style="font-size:2rem"></i>
          </div>
          <div v-if="medalLabel(myPosition)" class="badge bg-warning text-dark mb-2">{{ medalLabel(myPosition) }}</div>
          <div class="fw-semibold mb-1">{{ myRanking.riderName }}</div>
          <div class="h4 mb-0">Score: <strong>{{ Math.round(myRanking.score || 0) }}</strong></div>
        </div>
      </div>

      <!-- My metrics cards -->
      <div v-if="myRanking" class="row g-2 mb-3">
        <div class="col-6">
          <div class="card h-100">
            <div class="card-body p-2 text-center">
              <div class="small text-muted">Entregas</div>
              <div class="fw-bold">{{ myRanking.totalDeliveries }}</div>
            </div>
          </div>
        </div>
        <div class="col-6">
          <div class="card h-100">
            <div class="card-body p-2 text-center">
              <div class="small text-muted">Tempo Medio</div>
              <div class="fw-bold">{{ myRanking.avgDeliveryTime != null ? Math.round(myRanking.avgDeliveryTime) + ' min' : '-' }}</div>
            </div>
          </div>
        </div>
        <div class="col-4">
          <div class="card h-100">
            <div class="card-body p-2 text-center">
              <div class="small text-muted">Pontualidade</div>
              <div class="fw-bold">{{ fmt(myRanking.punctualityRate) }}%</div>
              <div class="progress mt-1" style="height:6px">
                <div class="progress-bar bg-success" :style="{ width: fmt(myRanking.punctualityRate) + '%' }"></div>
              </div>
            </div>
          </div>
        </div>
        <div class="col-4">
          <div class="card h-100">
            <div class="card-body p-2 text-center">
              <div class="small text-muted">Cod. iFood</div>
              <div class="fw-bold">{{ fmt(myRanking.ifoodCodeRate) }}%</div>
              <div class="progress mt-1" style="height:6px">
                <div class="progress-bar bg-info" :style="{ width: fmt(myRanking.ifoodCodeRate) + '%' }"></div>
              </div>
            </div>
          </div>
        </div>
        <div class="col-4">
          <div class="card h-100">
            <div class="card-body p-2 text-center">
              <div class="small text-muted">Conclusao</div>
              <div class="fw-bold">{{ fmt(myRanking.completionRate) }}%</div>
              <div class="progress mt-1" style="height:6px">
                <div class="progress-bar bg-primary" :style="{ width: fmt(myRanking.completionRate) + '%' }"></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Full ranking list -->
      <h6 class="text-muted mb-2">Ranking completo</h6>
      <div v-if="!ranking.length" class="text-center text-muted py-3">Nenhum entregador no periodo.</div>
      <div v-else class="d-grid gap-2">
        <div
          v-for="(r, i) in ranking"
          :key="r.riderId"
          class="card"
          :class="r.riderId === myRiderId ? 'bg-success bg-opacity-10 border-success' : ''"
        >
          <div class="card-body p-2 d-flex align-items-center gap-2">
            <div class="text-center" style="min-width:36px">
              <i v-if="medalClass(i + 1)" :class="medalClass(i + 1)" style="font-size:1.2rem"></i>
              <span v-else class="fw-bold text-muted">{{ i + 1 }}</span>
            </div>
            <div class="flex-grow-1">
              <div class="fw-semibold small">{{ r.riderName }}</div>
              <div class="text-muted" style="font-size:0.75rem">
                {{ r.totalDeliveries }} entregas &middot; {{ r.avgDeliveryTime != null ? Math.round(r.avgDeliveryTime) + ' min' : '-' }}
              </div>
            </div>
            <div class="text-end">
              <div class="fw-bold">{{ Math.round(r.score || 0) }}</div>
              <div class="text-muted" style="font-size:0.7rem">pts</div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <div style="height:84px"></div>
    <MobileBottomNav />
  </div>
</template>

<style scoped>
.text-bronze { color: #cd7f32; }
.rider-ranking { max-width: 600px; margin: 0 auto; }
</style>
