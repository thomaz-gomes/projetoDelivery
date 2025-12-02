<script setup>
import { useRouter } from 'vue-router';
import MobileBottomNav from '../../components/MobileBottomNav.vue';

const router = useRouter();
function go(path) { router.push(path); }
</script>

<template>
  <div class="p-3 rider-dashboard">
    <h3 class="h5 mb-3">Área do Entregador</h3>

    <div class="d-grid gap-3">
      <div class="card p-3 nav-card" @click="go('/rider/orders')" role="button">
        <div class="d-flex justify-content-between align-items-center">
          <div>
            <div class="fw-semibold">Pedidos</div>
            <div class="small text-muted">Acompanhe e gerencie suas entregas</div>
          </div>
          <div class="badge bg-secondary">Ir</div>
        </div>
      </div>

      <div class="card p-3 nav-card" @click="go('/rider/account')" role="button">
        <div class="d-flex justify-content-between align-items-center">
          <div>
            <div class="fw-semibold">Meu Extrato</div>
            <div class="small text-muted">Visualize suas transações e saldo</div>
          </div>
          <div class="badge bg-secondary">Ir</div>
        </div>
      </div>

      <div class="card p-3 nav-card" @click="go('/rider/home')" role="button">
        <div class="d-flex justify-content-between align-items-center">
          <div>
            <div class="fw-semibold">Leitor de QR</div>
            <div class="small text-muted">Abra a câmera para capturar códigos</div>
          </div>
          <div class="badge bg-secondary">Ir</div>
        </div>
      </div>
    </div>

    <div style="height:84px"></div>
    <MobileBottomNav />
  </div>
</template>

<style scoped>
.rider-dashboard .nav-card { cursor: pointer; border-radius: 10px; }
.rider-dashboard .nav-card:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(0,0,0,0.06); }
</style>
