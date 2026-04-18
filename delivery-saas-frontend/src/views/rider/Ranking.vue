<script setup>
import { ref, onMounted, computed } from 'vue';
import api from '../../api';
import RiderHeader from '../../components/rider/RiderHeader.vue';
import MobileBottomNav from '../../components/MobileBottomNav.vue';
import SwipeableViews from '../../components/rider/SwipeableViews.vue';

const activeTab = ref('goals');
const goals = ref([]);
const achievements = ref([]);
const loading = ref(false);

const ruleIcons = {
  DELIVERY_COUNT: 'bi-box-seam',
  AVG_DELIVERY_TIME: 'bi-speedometer2',
  CANCELLATION_RATE: 'bi-x-circle',
  CODE_COMPLETION_RATE: 'bi-check2-circle',
  CONSECUTIVE_CHECKINS: 'bi-calendar-check',
};

function ruleIcon(ruleType) {
  return ruleIcons[ruleType] || 'bi-trophy';
}

function progressBarColor(pct) {
  if (pct > 80) return 'bg-success';
  if (pct > 50) return 'bg-warning';
  return 'bg-danger';
}

function formatReward(goal) {
  const parts = [];
  if (goal.rewardType === 'MONEY' && goal.rewardAmount) {
    parts.push('R$ ' + Number(goal.rewardAmount).toFixed(2).replace('.', ','));
  }
  if (goal.rewardDescription) {
    parts.push(goal.rewardDescription);
  }
  return parts.join(' + ') || '';
}

function formatCycle(start, end) {
  if (!start || !end) return '';
  const s = new Date(start);
  const e = new Date(end);
  const fmt = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return fmt(s) + ' - ' + fmt(e);
}

function remaining(goal) {
  if (!goal.progress || goal.progress.achieved) return null;
  const diff = Math.abs(goal.progress.target - goal.progress.current);
  const unit = goal.progress.unit || '';
  return 'Faltam ' + (Number.isInteger(diff) ? diff : diff.toFixed(1)) + (unit ? ' ' + unit : '');
}

function statusBadge(status) {
  if (status === 'CREDITED') return { label: 'Creditado', cls: 'bg-success' };
  if (status === 'PENDING') return { label: 'Pendente', cls: 'bg-warning text-dark' };
  return { label: status, cls: 'bg-secondary' };
}

async function loadGoals() {
  loading.value = true;
  try {
    const [goalsRes, achievementsRes] = await Promise.all([
      api.get('/riders/me/goals'),
      api.get('/riders/me/achievements'),
    ]);
    goals.value = goalsRes.data || [];
    achievements.value = achievementsRes.data || [];
  } catch (e) {
    console.error('Failed to load goals:', e);
  } finally {
    loading.value = false;
  }
}

onMounted(loadGoals);
</script>

<template>
  <RiderHeader />
  <SwipeableViews>
    <div class="rider-goals" style="padding: calc(var(--rider-header-height, 56px) + 12px) 12px 12px">

      <!-- Tabs -->
      <ul class="nav nav-pills nav-fill mb-3">
        <li class="nav-item">
          <button class="nav-link" :class="{ active: activeTab === 'goals' }" @click="activeTab = 'goals'">
            <i class="bi-bullseye me-1"></i>Metas
          </button>
        </li>
        <li class="nav-item">
          <button class="nav-link" :class="{ active: activeTab === 'achievements' }" @click="activeTab = 'achievements'">
            <i class="bi-trophy me-1"></i>Conquistas
          </button>
        </li>
      </ul>

      <!-- Loading -->
      <div v-if="loading" class="text-center py-5">
        <div class="spinner-border spinner-border-sm text-primary"></div>
        <div class="text-muted mt-2">Carregando...</div>
      </div>

      <!-- Goals Tab -->
      <div v-else-if="activeTab === 'goals'">
        <div v-if="!goals.length" class="text-center py-5 text-muted">
          <i class="bi-bullseye d-block mb-2" style="font-size: 2.5rem"></i>
          Nenhuma meta disponivel no momento.
        </div>

        <div v-else class="d-grid gap-3">
          <div v-for="goal in goals" :key="goal.id" class="card">
            <div class="card-body">
              <!-- Header: icon + name + difficulty -->
              <div class="d-flex align-items-start justify-content-between mb-2">
                <div class="d-flex align-items-center gap-2">
                  <i :class="ruleIcon(goal.ruleType)" class="text-primary" style="font-size: 1.4rem"></i>
                  <div>
                    <div class="fw-semibold">{{ goal.name }}</div>
                    <div class="text-muted small">{{ goal.description }}</div>
                  </div>
                </div>
                <!-- Difficulty stars -->
                <div class="d-flex gap-0 flex-shrink-0 ms-2">
                  <i
                    v-for="s in 3" :key="s"
                    :class="s <= (goal.difficulty || 0) ? 'bi-star-fill text-warning' : 'bi-star text-muted'"
                    style="font-size: 0.85rem"
                  ></i>
                </div>
              </div>

              <!-- Progress bar -->
              <div v-if="goal.progress" class="mb-2">
                <div class="progress" style="height: 10px; border-radius: 5px">
                  <div
                    class="progress-bar"
                    :class="progressBarColor(goal.progress.percentage)"
                    role="progressbar"
                    :style="{ width: Math.min(goal.progress.percentage, 100) + '%' }"
                    :aria-valuenow="goal.progress.percentage"
                    aria-valuemin="0"
                    aria-valuemax="100"
                  ></div>
                </div>
                <div class="d-flex justify-content-between align-items-center mt-1">
                  <span class="small text-muted">
                    {{ goal.progress.current }}{{ goal.progress.unit ? ' ' + goal.progress.unit : '' }}
                    /
                    {{ goal.progress.target }}{{ goal.progress.unit ? ' ' + goal.progress.unit : '' }}
                  </span>
                  <span v-if="goal.progress.achieved" class="badge bg-success">
                    <i class="bi-check-lg me-1"></i>Meta!
                  </span>
                  <span v-else-if="remaining(goal)" class="small text-danger fw-semibold">
                    {{ remaining(goal) }}
                  </span>
                </div>
              </div>

              <!-- Reward -->
              <div v-if="formatReward(goal)" class="d-flex align-items-center gap-1 mb-1">
                <i class="bi-gift text-success" style="font-size: 0.9rem"></i>
                <span class="small fw-semibold text-success">{{ formatReward(goal) }}</span>
              </div>

              <!-- Achievement status -->
              <div v-if="goal.achievementStatus" class="mb-1">
                <span class="badge" :class="statusBadge(goal.achievementStatus).cls">
                  {{ statusBadge(goal.achievementStatus).label }}
                </span>
              </div>

              <!-- Cycle dates -->
              <div v-if="goal.progress" class="small text-muted">
                <i class="bi-calendar3 me-1"></i>{{ formatCycle(goal.progress.cycleStart, goal.progress.cycleEnd) }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Achievements Tab -->
      <div v-else-if="activeTab === 'achievements'">
        <div v-if="!achievements.length" class="text-center py-5 text-muted">
          <i class="bi-trophy d-block mb-2" style="font-size: 2.5rem"></i>
          Nenhuma conquista ainda. Continue se esforçando!
        </div>

        <div v-else class="d-grid gap-2">
          <div v-for="ach in achievements" :key="ach.id" class="card">
            <div class="card-body p-3 d-flex align-items-center gap-3">
              <i
                :class="ruleIcon(ach.goal?.ruleType)"
                class="text-primary flex-shrink-0"
                style="font-size: 1.5rem"
              ></i>
              <div class="flex-grow-1">
                <div class="fw-semibold">{{ ach.goal?.name || 'Meta' }}</div>
                <div class="text-muted small">{{ formatCycle(ach.cycleStart, ach.cycleEnd) }}</div>
              </div>
              <div class="text-end flex-shrink-0">
                <span class="badge" :class="statusBadge(ach.status).cls">
                  {{ statusBadge(ach.status).label }}
                </span>
                <div v-if="ach.rewardAmount" class="small fw-semibold text-success mt-1">
                  R$ {{ Number(ach.rewardAmount).toFixed(2).replace('.', ',') }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="mobile-nav-spacer d-lg-none"></div>
    </div>
  </SwipeableViews>
  <MobileBottomNav />
</template>

<style scoped>
.rider-goals {
  max-width: 600px;
  margin: 0 auto;
}
</style>
