<template>
  <div class="media-feedback">
    <div class="feedback-btn-group">
      <button
        type="button"
        class="btn btn-sm"
        :class="likedFeedback ? 'btn-success' : 'btn-outline-light'"
        :title="likedFeedback ? 'Remover curtida' : 'Curtir'"
        :disabled="submitting"
        @click.stop="toggleLike"
      >
        <i class="bi bi-hand-thumbs-up-fill"></i>
      </button>
      <button
        type="button"
        class="btn btn-sm btn-outline-light ms-1"
        title="Reportar problema"
        :disabled="submitting"
        @click.stop="openNegativeModal"
      >
        <i class="bi bi-hand-thumbs-down"></i>
      </button>
    </div>

    <span v-if="likedFeedback" class="badge-status bg-success">
      <i class="bi bi-check-circle me-1"></i>Curtida
    </span>
    <span
      v-else-if="negativeFeedbacks.length"
      class="badge-status bg-secondary"
      :title="negativeTooltip"
    >
      <i class="bi bi-flag-fill me-1"></i>Feedback enviado
    </span>

    <!-- Mini-modal de feedback negativo -->
    <Teleport to="body">
      <div
        v-if="modalOpen"
        class="modal show d-block media-feedback-modal"
        style="background:rgba(0,0,0,.45)"
        @click.self="cancelModal"
      >
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h6 class="modal-title">O que está errado nesta imagem?</h6>
              <button type="button" class="btn-close" @click="cancelModal"></button>
            </div>
            <div class="modal-body">
              <div v-for="r in NEGATIVE_REASONS" :key="r.value" class="form-check mb-1">
                <input
                  class="form-check-input"
                  type="radio"
                  :id="`fb-${mediaId}-${r.value}`"
                  :value="r.value"
                  v-model="selectedReason"
                />
                <label class="form-check-label" :for="`fb-${mediaId}-${r.value}`">{{ r.label }}</label>
              </div>
              <div class="mt-3">
                <label class="form-label small mb-1">
                  Observação
                  <span v-if="selectedReason === 'OTHER'" class="text-danger">*</span>
                  <span v-else class="text-muted">(opcional)</span>
                </label>
                <textarea
                  class="form-control form-control-sm"
                  rows="2"
                  maxlength="500"
                  v-model="note"
                  placeholder="Descreva brevemente..."
                ></textarea>
              </div>
              <div v-if="error" class="alert alert-danger py-1 small mt-2 mb-0">{{ error }}</div>
            </div>
            <div class="modal-footer py-2">
              <button
                type="button"
                class="btn btn-sm btn-secondary"
                :disabled="submitting"
                @click="cancelModal"
              >
                Cancelar
              </button>
              <button
                type="button"
                class="btn btn-sm btn-primary"
                :disabled="submitting"
                @click="submitNegative"
              >
                <span v-if="submitting" class="spinner-border spinner-border-sm me-1" role="status"></span>
                Confirmar
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import api from '../api'

const NEGATIVE_REASONS = [
  { value: 'FOOD_DEFORMED', label: 'Comida deformada / ingredientes errados' },
  { value: 'SCENE_REPETITIVE', label: 'Cenário repetitivo / sem graça' },
  { value: 'OFF_BRAND', label: 'Não combina com a marca da loja' },
  { value: 'WRONG_COLOR', label: 'Cor / textura / iluminação ruim' },
  { value: 'OTHER', label: 'Outro motivo' },
]

const NEGATIVE_LABELS = {
  FOOD_DEFORMED: 'Comida deformada',
  SCENE_REPETITIVE: 'Cenário repetitivo',
  OFF_BRAND: 'Fora da marca',
  WRONG_COLOR: 'Cor/textura',
  OTHER: 'Outro',
}

const props = defineProps({
  mediaId: { type: String, required: true },
  existingFeedbacks: { type: Array, default: () => [] },
})
const emit = defineEmits(['update', 'deleted'])

const localFeedbacks = ref([...props.existingFeedbacks])

// Keep local state in sync if parent reloads
watch(
  () => props.existingFeedbacks,
  (next) => {
    localFeedbacks.value = Array.isArray(next) ? [...next] : []
  },
)

const modalOpen = ref(false)
const selectedReason = ref(NEGATIVE_REASONS[0].value)
const note = ref('')
const error = ref('')
const submitting = ref(false)

const likedFeedback = computed(() => localFeedbacks.value.find(f => f.reason === 'LIKED'))
const negativeFeedbacks = computed(() => localFeedbacks.value.filter(f => f.reason !== 'LIKED'))
const negativeTooltip = computed(() =>
  negativeFeedbacks.value.map(f => NEGATIVE_LABELS[f.reason] || f.reason).join(', '),
)

async function toggleLike() {
  if (submitting.value) return
  submitting.value = true
  try {
    if (likedFeedback.value) {
      const fbId = likedFeedback.value.id
      await api.delete(`/media/${props.mediaId}/feedback/${fbId}`)
      localFeedbacks.value = localFeedbacks.value.filter(f => f.id !== fbId)
      emit('update')
    } else {
      const r = await api.post(`/media/${props.mediaId}/feedback`, { reason: 'LIKED' })
      localFeedbacks.value.push(r.data)
      emit('update')
    }
  } catch (e) {
    console.error('Failed to toggle LIKED feedback', e)
  } finally {
    submitting.value = false
  }
}

function openNegativeModal() {
  selectedReason.value = NEGATIVE_REASONS[0].value
  note.value = ''
  error.value = ''
  modalOpen.value = true
}

function cancelModal() {
  if (submitting.value) return
  modalOpen.value = false
}

async function submitNegative() {
  error.value = ''
  if (selectedReason.value === 'OTHER' && (!note.value || !note.value.trim())) {
    error.value = 'Observação é obrigatória quando o motivo é "Outro".'
    return
  }
  submitting.value = true
  try {
    const r = await api.post(`/media/${props.mediaId}/feedback`, {
      reason: selectedReason.value,
      note: note.value ? note.value.trim() : undefined,
    })
    localFeedbacks.value.push(r.data)
    modalOpen.value = false
    emit('update')
  } catch (e) {
    error.value = e?.response?.data?.message || 'Falha ao enviar feedback.'
    return
  } finally {
    submitting.value = false
  }
  // Após salvar o feedback negativo, oferece apagar a imagem. A IA já registrou
  // o motivo da rejeição (continua aprendendo); deletar é opcional para o op.
  const shouldDelete = window.confirm(
    'Feedback enviado. Deseja apagar esta imagem da galeria?\n\n' +
    'O feedback fica registrado para a IA aprender; apagar só remove a imagem da sua biblioteca.'
  )
  if (!shouldDelete) return
  try {
    await api.delete(`/media/${props.mediaId}`)
    emit('deleted', props.mediaId)
  } catch (e) {
    console.error('Failed to delete media after negative feedback', e)
    window.alert(e?.response?.data?.message || 'Falha ao apagar a imagem.')
  }
}
</script>

<style scoped>
.media-feedback {
  position: absolute;
  bottom: 6px;
  right: 6px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  z-index: 3;
}

.feedback-btn-group {
  display: flex;
}

.feedback-btn-group .btn {
  padding: .2rem .4rem;
  line-height: 1;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
}

.feedback-btn-group .btn-outline-light {
  background: rgba(0, 0, 0, 0.55);
  border-color: rgba(255, 255, 255, 0.6);
  color: #fff;
}

.feedback-btn-group .btn-outline-light:hover {
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
}

.badge-status {
  font-size: 0.7rem;
  padding: .2rem .4rem;
  border-radius: .4rem;
  color: #fff;
}

.media-feedback-modal {
  z-index: 1080;
}
</style>
