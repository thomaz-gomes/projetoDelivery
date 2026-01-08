<template>
  <ul class="list-group mb-2">
    <li v-for="item in items" :key="item[itemKey]" :class="['list-group-item','p-2',{ selected: item[itemKey] === selectedId }]" @click="select(item)" style="cursor:pointer;">
      <div class="d-flex justify-content-between align-items-center w-100">
        <div class="d-flex align-items-center gap-3">
          <span class="radio-wrapper">
            <input type="radio" :value="item[itemKey]" :checked="item[itemKey] === selectedId" class="custom-radio" @click.stop="select(item)" aria-label="Selecionar item" />
          </span>
          <div>
            <slot name="primary" :item="item">
              <div><strong>{{ item.label || item.formatted || item.formattedAddress || item.name }}</strong></div>
              <div class="small text-muted" :title="item.fullDisplay || item.formatted || item.formattedAddress">
                {{ item.formatted || item.formattedAddress || (item.street ? (item.street + (item.number ? ', ' + item.number : '')) : '') }}<span v-if="item.number">, {{ item.number }}</span> — {{ item.neighborhood }}
              </div>
              <div v-if="item.complement" class="small text-muted">Comp.: {{ item.complement }}</div>
              <div v-if="item.reference" class="small text-muted">Ref.: {{ item.reference }}</div>
              <div v-if="item.observation" class="small text-muted">Obs.: {{ item.observation }}</div>
            </slot>
          </div>
        </div>
        <div class="d-flex align-items-center gap-2">
          <slot name="actions">
            <button v-if="showActions" class="btn btn-sm btn-outline-secondary btn-action" @click.stop.prevent="emitEdit(item)"><i class="bi bi-pencil"></i></button>
            <button v-if="showActions" class="btn btn-sm btn-outline-danger btn-delete" @click.stop.prevent="emitRemove(item)"><i class="bi bi-trash"></i></button>
          </slot>
        </div>
      </div>
    </li>
  </ul>
</template>

<script setup>
import { defineProps, defineEmits } from 'vue'

const props = defineProps({
  items: { type: Array, default: () => [] },
  itemKey: { type: String, default: 'id' },
  selectedId: { type: [String, Number, null], default: null },
  showActions: { type: Boolean, default: true }
})

const emit = defineEmits(['select','edit','remove'])

function select(item){
  emit('select', item[props.itemKey])
}

function emitEdit(item){ emit('edit', item[props.itemKey]) }
function emitRemove(item){ emit('remove', item[props.itemKey]) }
</script>

<style scoped>
.selected { background: rgba(13,110,253,0.04) }
.radio-wrapper { display:inline-flex; align-items:center; margin-right:8px }
</style>
