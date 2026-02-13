<template>
  <div v-if="visible" class="modal-backdrop-custom" @click.self="$emit('close')">
    <div class="wizard-container">
      <!-- Header -->
      <div class="wizard-header d-flex justify-content-between align-items-center">
        <h5 class="mb-0"><i class="bi bi-cash-stack me-2"></i>Fechamento de Caixa</h5>
        <button class="btn btn-sm btn-outline-secondary" @click="$emit('close')" title="Fechar">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>

      <!-- Stepper -->
      <div class="wizard-stepper d-flex border-bottom">
        <button
          v-for="(step, idx) in steps"
          :key="idx"
          class="step-btn flex-fill text-center py-2 border-0"
          :class="{
            'step-active': currentStep === idx,
            'step-done': currentStep > idx,
            'step-pending': currentStep < idx,
          }"
          @click="goToStep(idx)"
          :disabled="idx > currentStep + 1"
        >
          <small class="d-block">
            <i :class="step.icon" class="me-1"></i>{{ step.label }}
          </small>
        </button>
      </div>

      <!-- Body -->
      <div class="wizard-body p-3">
        <!-- STEP 0: Dinheiro -->
        <div v-if="currentStep === 0">
          <h6 class="mb-3">Contagem de Dinheiro</h6>
          <p class="text-muted small mb-3">
            {{ isBlindClose ? 'Informe o valor em dinheiro contado no caixa.' : 'Confira o valor em dinheiro no caixa.' }}
          </p>

          <div class="mb-3">
            <CurrencyInput
              v-model="declaredValues['Dinheiro']"
              label="Valor em Dinheiro (R$)"
              labelClass="form-label"
              placeholder="0,00"
              inputClass="form-control-lg"
            />
          </div>

          <div v-if="!isBlindClose && expectedValues['Dinheiro'] != null" class="mt-3">
            <div class="d-flex justify-content-between align-items-center bg-light rounded p-2">
              <span class="text-muted small">Esperado: <strong>{{ formatCurrency(expectedValues['Dinheiro']) }}</strong></span>
              <DifferenceIndicator
                :declared="Number(declaredValues['Dinheiro'] || 0)"
                :expected="Number(expectedValues['Dinheiro'] || 0)"
              />
            </div>
          </div>
        </div>

        <!-- STEP 1: Cartões / Apps -->
        <div v-if="currentStep === 1">
          <h6 class="mb-3">Conferência de Cartões / Apps</h6>
          <p class="text-muted small mb-3">
            {{ isBlindClose ? 'Informe os valores recebidos em cada forma.' : 'Confira os valores recebidos por forma de pagamento eletrônica.' }}
          </p>

          <div v-if="electronicMethods.length === 0" class="text-muted text-center py-4">
            <i class="bi bi-info-circle me-1"></i>Nenhum pagamento eletrônico nesta sessão.
          </div>

          <div v-for="method in electronicMethods" :key="method" class="mb-3">
            <CurrencyInput
              v-model="declaredValues[method]"
              :label="method + ' (R$)'"
              labelClass="form-label"
              placeholder="0,00"
            />
            <div v-if="!isBlindClose && expectedValues[method] != null" class="mt-1">
              <div class="d-flex justify-content-between align-items-center bg-light rounded p-2">
                <span class="text-muted small">Esperado: <strong>{{ formatCurrency(expectedValues[method]) }}</strong></span>
                <DifferenceIndicator
                  :declared="Number(declaredValues[method] || 0)"
                  :expected="Number(expectedValues[method] || 0)"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- STEP 2: Sangrias de Última Hora -->
        <div v-if="currentStep === 2">
          <h6 class="mb-3">Sangrias / Reforços de Última Hora</h6>
          <p class="text-muted small mb-3">
            Registre movimentos de última hora antes de finalizar o caixa.
          </p>

          <!-- Existing last-minute movements -->
          <div v-if="lastMinuteMovements.length > 0" class="mb-3">
            <div
              v-for="(mv, idx) in lastMinuteMovements"
              :key="idx"
              class="d-flex align-items-center border rounded p-2 mb-2"
            >
              <span :class="mv.type === 'WITHDRAWAL' ? 'text-danger' : 'text-success'" class="me-2">
                <i :class="mv.type === 'WITHDRAWAL' ? 'bi bi-arrow-down-circle' : 'bi bi-arrow-up-circle'"></i>
              </span>
              <span class="flex-grow-1">
                <strong>{{ mv.type === 'WITHDRAWAL' ? 'Sangria' : 'Reforço' }}</strong>
                <small class="text-muted ms-2">{{ mv.note || '' }}</small>
              </span>
              <span class="fw-semibold me-2">{{ formatCurrency(mv.amount) }}</span>
              <button class="btn btn-sm btn-outline-danger" @click="removeLastMinute(idx)" title="Remover">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </div>

          <!-- Add new movement form -->
          <div class="border rounded p-3 bg-light">
            <div class="row g-2">
              <div class="col-md-4">
                <SelectInput
                  v-model="newMovement.type"
                  label="Tipo"
                  :options="movementTypeOptions"
                />
              </div>
              <div class="col-md-4">
                <CurrencyInput
                  v-model="newMovement.amount"
                  label="Valor (R$)"
                  labelClass="form-label"
                  placeholder="0,00"
                />
              </div>
              <div class="col-md-4">
                <TextInput
                  v-model="newMovement.note"
                  label="Descrição"
                  placeholder="Motivo..."
                />
              </div>
            </div>
            <div class="mt-2 text-end">
              <button class="btn btn-sm btn-primary" @click="addLastMinute" :disabled="!newMovement.amount">
                <i class="bi bi-plus-lg me-1"></i>Adicionar
              </button>
            </div>
          </div>
        </div>

        <!-- STEP 3: Resumo -->
        <div v-if="currentStep === 3">
          <h6 class="mb-3">Resumo do Fechamento</h6>

          <!-- Always show expected values (blind close reveal) -->
          <div class="table-responsive">
            <table class="table table-sm table-bordered mb-3">
              <thead class="table-light">
                <tr>
                  <th>Forma</th>
                  <th class="text-end">Esperado</th>
                  <th class="text-end">Declarado</th>
                  <th class="text-end">Diferença</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="method in allMethods" :key="method">
                  <td>{{ method }}</td>
                  <td class="text-end">{{ formatCurrency(expectedValues[method] || 0) }}</td>
                  <td class="text-end">{{ formatCurrency(declaredValues[method] || 0) }}</td>
                  <td class="text-end">
                    <DifferenceIndicator
                      :declared="Number(declaredValues[method] || 0)"
                      :expected="Number(expectedValues[method] || 0)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Alert for critical differences -->
          <div v-if="hasCriticalDifferences" class="alert alert-warning d-flex align-items-center mb-3">
            <i class="bi bi-exclamation-triangle-fill me-2"></i>
            <span>Diferenças acima de R$ 5,00 detectadas. Revise os valores antes de finalizar.</span>
          </div>

          <!-- Last-minute movements summary -->
          <div v-if="lastMinuteMovements.length > 0" class="mb-3">
            <h6 class="small text-muted">Movimentos de última hora:</h6>
            <ul class="list-unstyled small">
              <li v-for="(mv, idx) in lastMinuteMovements" :key="idx">
                <i :class="mv.type === 'WITHDRAWAL' ? 'bi bi-arrow-down text-danger' : 'bi bi-arrow-up text-success'" class="me-1"></i>
                {{ mv.type === 'WITHDRAWAL' ? 'Sangria' : 'Reforço' }}: {{ formatCurrency(mv.amount) }}
                <span class="text-muted">{{ mv.note || '' }}</span>
              </li>
            </ul>
          </div>

          <!-- Closing note -->
          <div class="mb-3">
            <TextInput
              v-model="closingNote"
              label="Observações (opcional)"
              placeholder="Notas sobre o fechamento..."
            />
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="wizard-footer d-flex justify-content-between align-items-center p-3 border-top">
        <button
          v-if="currentStep > 0"
          class="btn btn-outline-secondary"
          @click="currentStep--"
        >
          <i class="bi bi-arrow-left me-1"></i>Voltar
        </button>
        <div v-else></div>

        <div>
          <button class="btn btn-outline-secondary me-2" @click="$emit('close')">Cancelar</button>
          <button
            v-if="currentStep < steps.length - 1"
            class="btn btn-primary"
            @click="currentStep++"
          >
            Avançar<i class="bi bi-arrow-right ms-1"></i>
          </button>
          <button
            v-else
            class="btn btn-success"
            @click="finalize"
            :disabled="submitting"
          >
            <span v-if="submitting" class="spinner-border spinner-border-sm me-1"></span>
            <i v-else class="bi bi-check-lg me-1"></i>Finalizar Fechamento
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import api from '../api.js';
import { formatCurrency } from '../utils/formatters.js';
import CurrencyInput from './form/input/CurrencyInput.vue';
import TextInput from './form/input/TextInput.vue';
import SelectInput from './form/select/SelectInput.vue';
import DifferenceIndicator from './DifferenceIndicator.vue';

const props = defineProps({
  visible: { type: Boolean, default: false },
  session: { type: Object, default: null },
});

const emit = defineEmits(['close', 'completed']);

const currentStep = ref(0);
const submitting = ref(false);
const isBlindClose = ref(false);
const declaredValues = ref({});
const expectedValues = ref({});
const paymentsByMethod = ref({});
const closingNote = ref('');
const lastMinuteMovements = ref([]);
const newMovement = ref({ type: 'WITHDRAWAL', amount: null, note: '' });

const steps = [
  { label: 'Dinheiro', icon: 'bi bi-cash' },
  { label: 'Cartões', icon: 'bi bi-credit-card' },
  { label: 'Sangrias', icon: 'bi bi-arrow-down-up' },
  { label: 'Resumo', icon: 'bi bi-clipboard-check' },
];

const movementTypeOptions = [
  { value: 'WITHDRAWAL', label: 'Sangria' },
  { value: 'REINFORCEMENT', label: 'Reforço' },
];

const electronicMethods = computed(() => {
  const all = new Set([
    ...Object.keys(expectedValues.value || {}),
    ...Object.keys(paymentsByMethod.value || {}),
  ]);
  all.delete('Dinheiro');
  return [...all].sort();
});

const allMethods = computed(() => {
  const all = new Set([
    'Dinheiro',
    ...Object.keys(expectedValues.value || {}),
    ...Object.keys(declaredValues.value || {}),
  ]);
  return ['Dinheiro', ...[...all].filter(m => m !== 'Dinheiro').sort()];
});

const hasCriticalDifferences = computed(() => {
  for (const method of allMethods.value) {
    const d = Number(declaredValues.value[method] || 0);
    const e = Number(expectedValues.value[method] || 0);
    if (Math.abs(d - e) > 5) return true;
  }
  return false;
});

function goToStep(idx) {
  if (idx <= currentStep.value + 1) {
    currentStep.value = idx;
  }
}

function addLastMinute() {
  if (!newMovement.value.amount) return;
  lastMinuteMovements.value.push({
    type: newMovement.value.type,
    amount: Number(newMovement.value.amount),
    note: newMovement.value.note || '',
  });
  newMovement.value = { type: 'WITHDRAWAL', amount: null, note: '' };
}

function removeLastMinute(idx) {
  lastMinuteMovements.value.splice(idx, 1);
}

async function loadSummary() {
  try {
    const { data } = await api.get('/cash/summary/current');
    if (data) {
      expectedValues.value = data.inRegisterByMethod || {};
      paymentsByMethod.value = data.paymentsByMethod || {};
      // Pre-fill declared with expected for convenience
      const declared = {};
      for (const [m, v] of Object.entries(data.inRegisterByMethod || {})) {
        declared[m] = Number(v || 0);
      }
      declaredValues.value = declared;
    }
  } catch (e) {
    console.error('Failed to load cash summary:', e);
  }
}

async function loadSettings() {
  try {
    const { data } = await api.get('/cash/settings');
    isBlindClose.value = data?.blindCloseDefault || false;
  } catch (e) {
    // Default to non-blind
    isBlindClose.value = false;
  }
}

async function finalize() {
  submitting.value = true;
  try {
    const { data } = await api.post('/cash/close/finalize', {
      declaredValues: declaredValues.value,
      closingNote: closingNote.value || null,
      blindClose: isBlindClose.value,
      lastMinuteMovements: lastMinuteMovements.value,
    });
    emit('completed', data);
  } catch (e) {
    console.error('Finalize error:', e);
    alert('Erro ao finalizar fechamento: ' + (e.response?.data?.message || e.message));
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  loadSummary();
  loadSettings();
});
</script>

<style scoped>
.modal-backdrop-custom {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1050;
  display: flex;
  align-items: center;
  justify-content: center;
}

.wizard-container {
  background: white;
  border-radius: 12px;
  width: 95%;
  max-width: 640px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
}

.wizard-header {
  padding: 16px 20px;
  border-bottom: 1px solid #dee2e6;
}

.wizard-body {
  flex: 1;
  overflow-y: auto;
  min-height: 200px;
}

.step-btn {
  background: white;
  color: #6c757d;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s;
  border-bottom: 3px solid transparent;
}

.step-btn:hover:not(:disabled) {
  background: #f8f9fa;
}

.step-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.step-active {
  color: #0d6efd;
  border-bottom-color: #0d6efd !important;
  font-weight: 600;
}

.step-done {
  color: #198754;
  border-bottom-color: #198754 !important;
}
</style>
