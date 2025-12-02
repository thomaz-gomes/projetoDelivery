<template>
  <nav class="affiliate-footer d-md-none">
    <button class="btn-footer" @click="goHome">
      <i class="bi bi-house-fill"></i>
      <span>Home</span>
    </button>
    <button class="btn-footer" @click="goStatement">
      <i class="bi bi-list-check"></i>
      <span>Extrato</span>
    </button>
    <button class="btn-footer" @click="doLogout">
      <i class="bi bi-box-arrow-right"></i>
      <span>Sair</span>
    </button>
  </nav>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const auth = useAuthStore()

function goHome() {
  router.push('/affiliate')
}
function goStatement() {
  router.push('/affiliate/statement')
}
function doLogout() {
  auth.logout()
  router.push('/login')
}
</script>

<style scoped>
.affiliate-footer {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 64px;
  display: flex;
  gap: 8px;
  background: #fff;
  border-top: 1px solid #e6e6e6;
  padding: 6px 10px;
  justify-content: space-around;
  align-items: center;
  z-index: 1100;
}
.btn-footer {
  background: transparent;
  border: none;
  display:flex;
  flex-direction:column;
  align-items:center;
  font-size:12px;
  color: #333;
}
.btn-footer i { font-size:18px; margin-bottom:4px }
</style>
