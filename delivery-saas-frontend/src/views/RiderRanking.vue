<script setup>
import { ref, computed, onMounted } from 'vue';
import api from '../api';
import ListCard from '../components/ListCard.vue';

const goals = ref([]);
const achievements = ref([]);
const loading = ref(false);

const ruleTypeLabels = {
  DELIVERY_COUNT: 'Entregas',
  DELIVERY_STREAK: 'Sequência',
  RATING: 'Avaliação',
  PUNCTUALITY: 'Pontualidade',
  ONLINE_TIME: 'Tempo Online',
};

const activeGoalsCount = computed(() => goals.value.length);

const pendingApprovals = computed(() =>
  achievements.value.filter(a => a.status === 'PENDING_APPROVAL').length
);

const achievementsThisMonth = computed(() => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  return achievements.value.filter(a => {
    const d = new Date(a.createdAt);
    return d.getFullYear() === y && d.getMonth() === m;
  }).length;
});

async function load() {
  loading.value = true;
  try {
    const [goalsRes, achRes] = await Promise.all([
      api.get('/riders/goals', { params: { active: true } }),
      api.get('/riders/goals/achievements'),
    ]);
    goals.value = goalsRes.data;
    achievements.value = achRes.data;
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <ListCard title="Ranking / Metas" icon="bi-trophy" subtitle="Visão geral das metas de entregadores">
    <template #actions>
      <router-link to="/settings/rider-goals" class="btn btn-primary btn-sm">
        <i class="bi-bullseye me-1"></i>Gerenciar Metas
      </router-link>
    </template>

    <div v-if="loading" class="text-center py-4">
      <div class="spinner-border spinner-border-sm text-primary"></div>
      <span class="ms-2 text-muted">Carregando...</span>
    </div>

    <template v-else>
      <!-- Summary cards -->
      <div class="stat-grid mb-4 px-3 pt-3">
        <div class="stat-card">
          <div class="stat-icon stat-icon--primary"><i class="bi-flag"></i></div>
          <div class="stat-body">
            <div class="stat-label">Metas Ativas</div>
            <div class="stat-value">{{ activeGoalsCount }}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon stat-icon--warning"><i class="bi-hourglass-split"></i></div>
          <div class="stat-body">
            <div class="stat-label">Aprovações Pendentes</div>
            <div class="stat-value">{{ pendingApprovals }}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon stat-icon--success"><i class="bi-trophy"></i></div>
          <div class="stat-body">
            <div class="stat-label">Conquistas Este Mês</div>
            <div class="stat-value">{{ achievementsThisMonth }}</div>
          </div>
        </div>
      </div>

      <!-- Goals overview -->
      <div v-if="!goals.length" class="text-center text-muted py-4">
        Nenhuma meta ativa encontrada.
      </div>

      <div v-else class="px-3 pb-3">
        <h6 class="text-muted mb-3" style="font-size:0.85rem; font-weight:600;">Metas Ativas</h6>
        <div class="row g-3">
          <div v-for="goal in goals" :key="goal.id" class="col-12 col-md-6 col-xl-4">
            <div class="card h-100" style="border: 1px solid var(--border-color-soft);">
              <div class="card-body">
                <div class="d-flex align-items-start justify-content-between mb-2">
                  <h6 class="mb-0 fw-semibold" style="font-size:0.95rem;">{{ goal.name }}</h6>
                  <span class="badge bg-primary ms-2" style="font-size:0.72rem;">
                    {{ ruleTypeLabels[goal.ruleType] || goal.ruleType }}
                  </span>
                </div>
                <div class="d-flex gap-2 mb-2">
                  <span class="badge" :class="goal.scope === 'GLOBAL' ? 'bg-info' : 'bg-light text-dark'" style="font-size:0.72rem;">
                    {{ goal.scope === 'GLOBAL' ? 'Global' : 'Individual' }}
                  </span>
                </div>
                <div class="d-flex align-items-center justify-content-between" style="font-size:0.85rem;">
                  <span class="text-muted">
                    <i class="bi-gift me-1"></i>
                    <template v-if="goal.rewardType === 'BONUS'">Bônus R$ {{ Number(goal.rewardValue || 0).toFixed(2) }}</template>
                    <template v-else-if="goal.rewardType === 'BADGE'">Badge</template>
                    <template v-else>{{ goal.rewardType }}</template>
                  </span>
                  <span class="fw-semibold" style="color: var(--primary);">
                    <i class="bi-award me-1"></i>{{ goal._count?.achievements ?? 0 }} conquistas
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </ListCard>
</template>
