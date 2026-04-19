<template>
  <div v-if="showWidget" class="lucca-widget">
    <button
      v-if="!chatOpen"
      type="button"
      class="lucca-fab"
      title="Falar com o Lucca"
      @click="chatOpen = true"
    >
      <i class="bi bi-chat-dots-fill"></i>
    </button>

    <div v-if="chatOpen" class="lucca-panel">
      <div class="lucca-header">
        <div class="d-flex align-items-center gap-2">
          <div class="lucca-avatar">L</div>
          <div>
            <div class="fw-semibold text-white" style="font-size:0.95rem">Lucca</div>
            <div class="text-white-50" style="font-size:0.75rem">Assistente de suporte</div>
          </div>
        </div>
        <button type="button" class="btn btn-link text-white p-0" @click="chatOpen = false">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>

      <div ref="messagesEl" class="lucca-messages">
        <div
          v-for="(msg, i) in messages"
          :key="i"
          class="lucca-msg"
          :class="msg.role === 'user' ? 'lucca-msg--user' : 'lucca-msg--bot'"
        >
          <div class="lucca-bubble" v-html="renderMarkdown(msg.content)"></div>
        </div>
        <div v-if="loading" class="lucca-msg lucca-msg--bot">
          <div class="lucca-bubble lucca-typing">
            <span></span><span></span><span></span>
          </div>
        </div>
      </div>

      <form class="lucca-input" @submit.prevent="send">
        <input
          v-model="input"
          type="text"
          placeholder="Pergunte algo sobre o sistema..."
          :disabled="loading"
          class="form-control form-control-sm"
        />
        <button type="submit" class="btn btn-sm btn-success" :disabled="loading || !input.trim()">
          <i class="bi bi-send-fill"></i>
        </button>
      </form>
    </div>
  </div>
</template>

<script>
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import api from '@/api.js'

export default {
  name: 'LuccaChat',
  setup() {
    const route = useRoute()
    const chatOpen = ref(false)
    const input = ref('')
    const loading = ref(false)
    const messages = ref([])
    const messagesEl = ref(null)

    const showWidget = computed(() => {
      const p = route?.path || ''
      if (p.startsWith('/pedidos') || p.startsWith('/orders')) return false
      if (p.startsWith('/public')) return false
      if (p.startsWith('/login') || p === '/register') return false
      if (p.startsWith('/rider')) return false
      if (p === '/' || p.startsWith('/trial')) return false
      return true
    })

    onMounted(() => {
      try {
        const saved = sessionStorage.getItem('lucca-history')
        if (saved) messages.value = JSON.parse(saved)
      } catch (e) { /* ignore */ }
    })

    watch(messages, (val) => {
      try { sessionStorage.setItem('lucca-history', JSON.stringify(val)) } catch (e) { /* ignore */ }
    }, { deep: true })

    watch(messages, () => {
      nextTick(() => {
        if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
      })
    }, { deep: true })

    watch(chatOpen, (open) => {
      if (open && messages.value.length === 0) {
        messages.value.push({
          role: 'assistant',
          content: 'Olá! Sou o **Lucca**, seu assistente de suporte. Como posso te ajudar?'
        })
      }
      if (open) {
        nextTick(() => {
          if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
        })
      }
    })

    async function send() {
      const text = input.value.trim()
      if (!text || loading.value) return

      messages.value.push({ role: 'user', content: text })
      input.value = ''
      loading.value = true

      try {
        const res = await api.post('/lucca/chat', {
          message: text,
          currentPage: route?.path || '',
          history: messages.value.slice(0, -1)
        })
        messages.value.push({ role: 'assistant', content: res.data.reply })
      } catch (e) {
        messages.value.push({
          role: 'assistant',
          content: 'Desculpe, não consegui processar sua pergunta. Tente novamente em alguns instantes.'
        })
      } finally {
        loading.value = false
      }
    }

    function renderMarkdown(text) {
      if (!text) return ''
      return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n(\d+)\.\s/g, '<br/>$1. ')
        .replace(/\n- /g, '<br/>• ')
        .replace(/\n/g, '<br/>')
    }

    return { showWidget, chatOpen, input, loading, messages, messagesEl, send, renderMarkdown }
  }
}
</script>

<style scoped>
.lucca-widget {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 1050;
  font-family: inherit;
}

.lucca-fab {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #89d136;
  color: #fff;
  border: none;
  box-shadow: 0 4px 16px rgba(0,0,0,0.2);
  font-size: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}
.lucca-fab:hover {
  transform: scale(1.08);
  box-shadow: 0 6px 24px rgba(0,0,0,0.3);
}

.lucca-panel {
  width: 360px;
  max-width: calc(100vw - 32px);
  height: 500px;
  max-height: calc(100vh - 100px);
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.18);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.lucca-header {
  background: #89d136;
  padding: 14px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.lucca-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255,255,255,0.25);
  color: #fff;
  font-weight: 700;
  font-size: 1.1rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.lucca-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.lucca-msg { display: flex; }
.lucca-msg--user { justify-content: flex-end; }
.lucca-msg--bot { justify-content: flex-start; }

.lucca-bubble {
  max-width: 85%;
  padding: 10px 14px;
  border-radius: 14px;
  font-size: 0.875rem;
  line-height: 1.45;
  word-break: break-word;
}
.lucca-msg--user .lucca-bubble {
  background: #89d136;
  color: #fff;
  border-bottom-right-radius: 4px;
}
.lucca-msg--bot .lucca-bubble {
  background: #f1f3f5;
  color: #212529;
  border-bottom-left-radius: 4px;
}

.lucca-typing {
  display: flex;
  gap: 4px;
  padding: 12px 18px;
}
.lucca-typing span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #adb5bd;
  animation: lucca-bounce 1.2s infinite;
}
.lucca-typing span:nth-child(2) { animation-delay: 0.2s; }
.lucca-typing span:nth-child(3) { animation-delay: 0.4s; }

@keyframes lucca-bounce {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-6px); }
}

.lucca-input {
  padding: 12px;
  border-top: 1px solid #e9ecef;
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.lucca-input .form-control {
  border-radius: 20px;
  font-size: 0.875rem;
}
.lucca-input .btn {
  border-radius: 50%;
  width: 34px;
  height: 34px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

@media (max-width: 575.98px) {
  .lucca-widget { bottom: 76px; right: 12px; }
  .lucca-panel {
    width: calc(100vw - 24px);
    height: calc(100vh - 140px);
    border-radius: 12px;
  }
}
</style>
