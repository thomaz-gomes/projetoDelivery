<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import AppHeader from './components/AppHeader.vue'
import IfoodFrame from './components/IfoodFrame.vue'
import SettingsModal from './components/SettingsModal.vue'

const status = ref({ status: 'disconnected', reason: 'boot' })
const queueCount = ref(0)
const failureCount = ref(0)
const showSettings = ref(false)
const showFailures = ref(false)
const reloadKey = ref(0)   // bumped to force iframe reload (C3 will use it)
const ifoodFrameRef = ref(null)

let unsubStatus = null
let unsubChat = null

async function refreshFailureCount() {
  if (window.agentApi && window.agentApi.getFailures) {
    const list = await window.agentApi.getFailures()
    failureCount.value = Array.isArray(list) ? list.length : 0
  }
}

function onReloadIfood() {
  reloadKey.value++
}

function onOpenSettings() {
  showSettings.value = true
}

function onOpenFailures() {
  showFailures.value = true
}

function onQueueChange(n) {
  queueCount.value = n
}

async function onCloseSettings() {
  showSettings.value = false
  // settings might have changed config — refresh failures, status updates come via subscription
  await refreshFailureCount()
}

async function onCloseFailures() {
  showFailures.value = false
  await refreshFailureCount()
}

onMounted(async () => {
  if (window.agentApi) {
    if (window.agentApi.onSocketStatus) {
      unsubStatus = window.agentApi.onSocketStatus((st) => {
        status.value = st || { status: 'disconnected' }
      })
    }
    if (window.agentApi.onChatMessage) {
      unsubChat = window.agentApi.onChatMessage((payload) => {
        if (ifoodFrameRef.value && payload) {
          ifoodFrameRef.value.pushMessage(payload)
        }
      })
    }

    // If no config yet, open onboarding modal automatically.
    const cfg = await window.agentApi.getConfig()
    if (!cfg || !cfg.backendUrl || !cfg.ifoodAgentToken || !cfg.companyId) {
      showSettings.value = true
    }
  }

  await refreshFailureCount()
})

onUnmounted(() => {
  if (unsubStatus) unsubStatus()
  if (unsubChat) unsubChat()
})
</script>

<template>
  <div class="app">
    <AppHeader
      :status="status"
      :queue-count="queueCount"
      :failure-count="failureCount"
      @reload-ifood="onReloadIfood"
      @open-settings="onOpenSettings"
      @open-failures="onOpenFailures"
    />

    <main class="app-main">
      <IfoodFrame
        ref="ifoodFrameRef"
        :reload-key="reloadKey"
        @queue-change="onQueueChange"
      />
    </main>

    <div v-if="showSettings" class="modal-backdrop" @click.self="onCloseSettings">
      <div class="modal-card">
        <SettingsModal @close="onCloseSettings" />
      </div>
    </div>

    <!-- FailuresPanel goes here in C5. Placeholder. -->
    <div v-if="showFailures" class="panel-backdrop" @click.self="onCloseFailures">
      <aside class="panel-card">
        <header>
          <h2>Falhas</h2>
          <button class="btn ghost" @click="onCloseFailures">×</button>
        </header>
        <p>FailuresPanel será implementado em C5.</p>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.app { display: flex; flex-direction: column; height: 100vh; }
.app-main { flex: 1; min-height: 0; display: flex; }

.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.45);
  display: flex; align-items: center; justify-content: center;
  z-index: 10;
}
.modal-card {
  background: var(--bg-header); color: var(--fg);
  padding: 1.25rem; border-radius: 6px; min-width: 320px;
  border: 1px solid var(--border);
}

.panel-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.25);
  display: flex; justify-content: flex-end;
  z-index: 10;
}
.panel-card {
  background: var(--bg-header); color: var(--fg);
  padding: 1rem; width: 380px; height: 100%; overflow-y: auto;
  border-left: 1px solid var(--border);
}
.panel-card header { display: flex; align-items: center; justify-content: space-between; }

.btn {
  font-size: 0.85rem; padding: 0.35rem 0.7rem;
  border: 1px solid var(--border); background: transparent; color: var(--fg);
  border-radius: 4px;
}
.btn:hover { background: rgba(127,127,127,0.1); }
.btn.ghost { background: transparent; border: none; }
</style>
