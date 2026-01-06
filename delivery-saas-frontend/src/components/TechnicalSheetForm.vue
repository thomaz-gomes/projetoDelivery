<script setup>
import { ref, watch } from 'vue';
import api from '../api';
import { useRouter } from 'vue-router';
import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';

const props = defineProps({ initial: { type: Object, default: () => ({ id: null, name: '', notes: '' }) } });
const emit = defineEmits(['saved','cancel']);

const form = ref({ id: null, name: '', notes: '' });
const saving = ref(false);
const error = ref('');

watch(() => props.initial, (v) => { form.value = { ...(v || { id: null, name: '', notes: '' }) }; }, { immediate: true });

const router = useRouter();

async function save(){
  saving.value = true; error.value = '';
  try{
    const payload = { name: form.value.name, notes: form.value.notes };
    let res;
    if(form.value.id) res = await api.patch(`/technical-sheets/${form.value.id}`, payload);
    else res = await api.post('/technical-sheets', payload);
    await Swal.fire({ icon: 'success', title: 'Salvo', text: 'Ficha técnica salva com sucesso' });
    emit('saved', res.data);
    router.push('/technical-sheets');
  }catch(e){
    const body = e?.response?.data;
    error.value = body?.message || (body ? JSON.stringify(body) : (e.message || String(e)));
    console.error('TechnicalSheetForm.save', e, body);
  }finally{ saving.value = false }
}

function onCancel(){ emit('cancel') }
</script>

<template>
  <div>
    <form @submit.prevent="save" class="row g-2">
      <div class="col-md-6"><TextInput v-model="form.name" inputClass="form-control" placeholder="Nome da ficha" required /></div>
      <div class="col-md-6"><TextInput v-model="form.notes" inputClass="form-control" placeholder="Observações (opcional)" /></div>
      <div class="col-12 mt-2">
        <div class="d-flex gap-2">
          <button class="btn btn-primary" :disabled="saving">Salvar</button>
          <button type="button" class="btn btn-outline-secondary" @click="onCancel">Cancelar</button>
        </div>
        <div v-if="error" class="text-danger small mt-2">{{ error }}</div>
      </div>
    </form>
  </div>
</template>
