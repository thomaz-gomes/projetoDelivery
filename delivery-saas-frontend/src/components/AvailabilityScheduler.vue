<template>
  <fieldset class="mb-3 p-3 border rounded bg-light">
    <legend class="h6 text-muted mb-2"
      style="font-size:0.8rem; letter-spacing:0.04em; text-transform:uppercase;">
      Disponibilidade
    </legend>

    <div class="form-check form-switch mb-2">
      <input
        class="form-check-input"
        type="checkbox"
        :id="`always-${uid}`"
        :checked="alwaysAvailable"
        role="switch"
        @change="$emit('update:alwaysAvailable', $event.target.checked)"
      />
      <label class="form-check-label fw-semibold" :for="`always-${uid}`">
        Sempre disponível
      </label>
      <div class="small text-muted">
        {{ alwaysAvailable
          ? 'Sem restrição de horário — sempre visível'
          : 'Defina abaixo os dias e horários em que deve aparecer' }}
      </div>
    </div>

    <div v-if="!alwaysAvailable" class="table-responsive mt-3">
      <table class="table table-borderless align-middle mb-0">
        <thead>
          <tr>
            <th>Dia</th>
            <th class="text-center">Ativo</th>
            <th>De</th>
            <th>Até</th>
            <th style="width:48px"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(d, idx) in localSchedule" :key="idx">
            <td>{{ dayNames[idx] }}</td>
            <td class="text-center">
              <input
                class="form-check-input"
                type="checkbox"
                v-model="localSchedule[idx].enabled"
                @change="emitChange"
              />
            </td>
            <td>
              <input
                type="time"
                class="form-control form-control-sm"
                v-model="localSchedule[idx].from"
                :disabled="!localSchedule[idx].enabled"
                @change="emitChange"
              />
            </td>
            <td>
              <input
                type="time"
                class="form-control form-control-sm"
                v-model="localSchedule[idx].to"
                :disabled="!localSchedule[idx].enabled"
                @change="emitChange"
              />
            </td>
            <td class="text-end">
              <button
                type="button"
                class="btn btn-outline-secondary btn-sm"
                :disabled="idx === 0"
                @click="copyFromPrev(idx)"
                title="Copiar horário do dia acima"
              >
                <i class="bi bi-files"></i>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </fieldset>
</template>

<script setup>
import { ref, watch } from 'vue';

const props = defineProps({
  alwaysAvailable: { type: Boolean, default: true },
  schedule: { type: Array, default: () => [] },
});
const emit = defineEmits(['update:alwaysAvailable', 'update:schedule']);

const dayNames = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const uid = Math.random().toString(36).slice(2, 8);

function defaultSchedule() {
  return Array.from({ length: 7 }).map((_, i) => ({
    day: i, enabled: false, from: '', to: '',
  }));
}

function normalizeSchedule(input) {
  const base = defaultSchedule();
  if (Array.isArray(input)) {
    for (let i = 0; i < 7; i++) {
      const src = input[i] || {};
      base[i] = {
        day: i,
        enabled: !!src.enabled,
        from: src.from || '',
        to: src.to || '',
      };
    }
  }
  return base;
}

const localSchedule = ref(normalizeSchedule(props.schedule));

watch(() => props.schedule, (val) => {
  localSchedule.value = normalizeSchedule(val);
}, { deep: false });

function emitChange() {
  emit('update:schedule', JSON.parse(JSON.stringify(localSchedule.value)));
}

function copyFromPrev(idx) {
  if (idx <= 0) return;
  const prev = localSchedule.value[idx - 1];
  localSchedule.value[idx].enabled = !!prev.enabled;
  localSchedule.value[idx].from = prev.from || '';
  localSchedule.value[idx].to = prev.to || '';
  emitChange();
}
</script>
