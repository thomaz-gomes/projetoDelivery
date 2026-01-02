<template>
  <div class="d-flex gap-2 align-items-center">
    <div>
      <label class="form-label mb-0">Data início</label>
      <DateInput v-model="localFrom" :inputClass="inputClass" />
    </div>
    <div>
      <label class="form-label mb-0">Data fim</label>
      <DateInput v-model="localTo" :inputClass="inputClass" />
    </div>
    <button class="btn btn-sm btn-outline-secondary" @click="onClear">Limpar</button>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import DateInput from '../../components/form/date/DateInput.vue';

const props = defineProps({ from: { type: String, default: '' }, to: { type: String, default: '' }, inputClass: { type: String, default: 'form-control' } });
const emit = defineEmits(['update:from', 'update:to', 'clear']);

const localFrom = ref(props.from);
const localTo = ref(props.to);

watch(() => props.from, v => localFrom.value = v);
watch(() => props.to, v => localTo.value = v);

watch(localFrom, (v) => emit('update:from', v));
watch(localTo, (v) => emit('update:to', v));

function onClear(){
  localFrom.value = '';
  localTo.value = '';
  emit('clear');
}
</script>

<style scoped>
.form-label { display:block; }
</style>
