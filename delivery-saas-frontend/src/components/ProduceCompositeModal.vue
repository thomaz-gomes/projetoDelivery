<template>
  <div class="modal d-block" tabindex="-1" role="dialog" @click.self="$emit('close')" style="background:rgba(0,0,0,0.5)">
    <div class="modal-dialog" role="document">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">
            <i class="bi bi-arrow-repeat me-2"></i>Produzir — {{ composite?.description }}
          </h5>
          <button type="button" class="btn-close" @click="$emit('close')" :disabled="submitting"></button>
        </div>

        <div class="modal-body">
          <div class="mb-3">
            <TextInput
              v-model="qty"
              :label="`Quantidade produzida (${composite?.yieldUnit || ''})`"
              type="number"
              required
            />
            <small class="text-muted d-block mt-1">
              Rendimento padrão da receita: {{ composite?.yieldQuantity }} {{ composite?.yieldUnit }}
            </small>
          </div>

          <div v-if="ratio > 0 && items.length">
            <p class="small fw-semibold mb-2">Consumo estimado dos insumos:</p>
            <ul class="list-unstyled small mb-0">
              <li
                v-for="item in items"
                :key="item.id"
                class="d-flex justify-content-between align-items-center py-1 border-bottom"
              >
                <span>{{ item.ingredient?.description }}</span>
                <span>
                  <span :class="{ 'text-danger fw-semibold': insufficientStock(item) }">
                    {{ (Number(item.quantity) * ratio).toFixed(3) }} {{ item.unit }}
                  </span>
                  <i
                    v-if="insufficientStock(item)"
                    class="bi bi-exclamation-triangle-fill text-danger ms-1"
                    title="Estoque insuficiente"
                  ></i>
                </span>
              </li>
            </ul>
          </div>

          <div v-if="error" class="alert alert-danger small mt-3 mb-0">{{ error }}</div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-outline-secondary" @click="$emit('close')" :disabled="submitting">
            Cancelar
          </button>
          <button
            class="btn btn-success"
            :disabled="!canSubmit || submitting"
            @click="submit"
          >
            <span v-if="submitting" class="spinner-border spinner-border-sm me-1"></span>
            Confirmar produção
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import api from '../api';

const props = defineProps({ composite: { type: Object, required: true } });
const emit = defineEmits(['close', 'produced']);

const qty = ref('');
const error = ref('');
const submitting = ref(false);

const items = computed(() => props.composite?.compositionItems || []);

const ratio = computed(() => {
  const q = Number(qty.value);
  const y = Number(props.composite?.yieldQuantity || 0);
  return q > 0 && y > 0 ? q / y : 0;
});

function insufficientStock(item) {
  if (!item.ingredient) return false;
  const needed = Number(item.quantity) * ratio.value;
  return Number(item.ingredient.currentStock || 0) < needed;
}

const canSubmit = computed(() => ratio.value > 0);

async function submit() {
  submitting.value = true;
  error.value = '';
  try {
    await api.post(`/ingredients/${props.composite.id}/produce`, { quantity: Number(qty.value) });
    emit('produced');
    emit('close');
  } catch (e) {
    error.value = e?.response?.data?.message || 'Erro ao registrar produção';
  } finally {
    submitting.value = false;
  }
}
</script>
