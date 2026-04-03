<script setup>
import { useRouter } from 'vue-router';
import MobileBottomNav from '../../components/MobileBottomNav.vue';

const router = useRouter();
function go(path) { router.push(path); }
</script>

<template>
  <div class="rider-dashboard mx-auto px-3 pt-4 pb-5">
    <h5 class="mb-3 fw-bold">Meu Painel</h5>

    <div class="d-grid gap-2">
      <div class="card nav-card" @click="go('/rider/orders')" role="button">
        <div class="card-body d-flex align-items-center gap-3 py-3">
          <div class="nav-icon bg-primary bg-opacity-10 text-primary"><i class="bi bi-list-task"></i></div>
          <div class="flex-grow-1">
            <div class="fw-semibold">Meus Pedidos</div>
            <div class="small text-muted">Acompanhe e gerencie suas entregas</div>
          </div>
          <i class="bi bi-chevron-right text-muted"></i>
        </div>
      </div>

      <div class="card nav-card" @click="go('/rider/checkin')" role="button">
        <div class="card-body d-flex align-items-center gap-3 py-3">
          <div class="nav-icon bg-success bg-opacity-10 text-success"><i class="bi bi-geo-alt-fill"></i></div>
          <div class="flex-grow-1">
            <div class="fw-semibold">Check-in</div>
            <div class="small text-muted">Registre sua presença no turno</div>
          </div>
          <i class="bi bi-chevron-right text-muted"></i>
        </div>
      </div>

      <div class="card nav-card" @click="go('/rider/ranking')" role="button">
        <div class="card-body d-flex align-items-center gap-3 py-3">
          <div class="nav-icon bg-warning bg-opacity-10 text-warning"><i class="bi bi-trophy-fill"></i></div>
          <div class="flex-grow-1">
            <div class="fw-semibold">Ranking</div>
            <div class="small text-muted">Veja sua posição entre os entregadores</div>
          </div>
          <i class="bi bi-chevron-right text-muted"></i>
        </div>
      </div>

      <div class="card nav-card" @click="go('/rider/account')" role="button">
        <div class="card-body d-flex align-items-center gap-3 py-3">
          <div class="nav-icon bg-info bg-opacity-10 text-info"><i class="bi bi-wallet2"></i></div>
          <div class="flex-grow-1">
            <div class="fw-semibold">Meu Extrato</div>
            <div class="small text-muted">Visualize suas transações e saldo</div>
          </div>
          <i class="bi bi-chevron-right text-muted"></i>
        </div>
      </div>
    </div>

    <div style="height: 80px"></div>
    <MobileBottomNav />
  </div>
</template>

<style scoped>
.rider-dashboard { max-width: 500px; }
.nav-card { cursor: pointer; border-radius: 12px; border: 1px solid rgba(0,0,0,0.08); transition: transform 0.15s, box-shadow 0.15s; }
.nav-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.08); }
.nav-icon { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.25rem; flex-shrink: 0; }
</style>
