<script setup>
import { computed } from 'vue'

const props = defineProps({
  rule: { type: Object, required: true },
  depth: { type: Number, default: 0 },
})
const emit = defineEmits(['update:rule', 'remove'])

const FIELDS = [
  { value: 'lastOrderAt',      label: 'Última compra',         valueType: 'duration', ops: ['olderThan', 'newerThan'] },
  { value: 'totalSpent',       label: 'Total gasto',           valueType: 'number',   ops: ['>=', '>', '<=', '<'] },
  { value: 'orderCount',       label: 'Qtde de pedidos',       valueType: 'number',   ops: ['>=', '>', '<=', '<'] },
  { value: 'avgTicket',        label: 'Ticket médio',          valueType: 'number',   ops: ['>=', '<='] },
  { value: 'orderedProductId', label: 'Comprou produto',       valueType: 'list',     ops: ['in', 'notIn'] },
  { value: 'orderedCategoryId',label: 'Comprou categoria',     valueType: 'list',     ops: ['in', 'notIn'] },
  { value: 'neighborhood',     label: 'Bairro de entrega',     valueType: 'list',     ops: ['in', 'notIn'] },
  { value: 'birthdayInDays',   label: 'Aniversário em (dias)', valueType: 'int',      ops: ['=', '<='] },
  { value: 'customerGroupId',  label: 'Membro do grupo',       valueType: 'list',     ops: ['in', 'notIn'] },
  { value: 'optInMarketing',   label: 'Opt-in marketing',      valueType: 'bool',     ops: ['='] },
]

const OP_LABELS = {
  olderThan: 'há mais de', newerThan: 'nos últimos',
  '>=': '≥', '>': '>', '<=': '≤', '<': '<', '=': '=',
  in: 'inclui', notIn: 'não inclui',
}

const isGroup = computed(() => !!props.rule.all || !!props.rule.any)
const groupKey = computed(() => props.rule.all ? 'all' : (props.rule.any ? 'any' : null))
const fieldSpec = computed(() => FIELDS.find(f => f.value === props.rule.field))

function updateLeaf(patch) {
  emit('update:rule', { ...props.rule, ...patch })
}

function addCondition() {
  const newChild = { field: 'totalSpent', op: '>=', value: 0 }
  const key = groupKey.value
  emit('update:rule', { [key]: [...(props.rule[key] || []), newChild] })
}

function addSubgroup(kind) {
  const key = groupKey.value
  const newChild = { [kind]: [{ field: 'totalSpent', op: '>=', value: 0 }] }
  emit('update:rule', { [key]: [...(props.rule[key] || []), newChild] })
}

function updateChild(idx, newRule) {
  const arr = [...props.rule[groupKey.value]]
  arr[idx] = newRule
  emit('update:rule', { [groupKey.value]: arr })
}

function removeChild(idx) {
  const arr = props.rule[groupKey.value].filter((_, i) => i !== idx)
  emit('update:rule', { [groupKey.value]: arr })
}

function onValueInput(e) {
  const raw = e.target.value
  const t = fieldSpec.value?.valueType
  let v
  if (t === 'number' || t === 'int') {
    v = raw === '' ? '' : Number(raw)
  } else if (t === 'bool') {
    v = raw === 'true'
  } else if (t === 'list') {
    v = raw.split(',').map(s => s.trim()).filter(Boolean)
  } else {
    v = raw
  }
  updateLeaf({ value: v })
}

function onFieldChange(e) {
  const newField = e.target.value
  const spec = FIELDS.find(f => f.value === newField)
  updateLeaf({ field: newField, op: spec.ops[0], value: spec.valueType === 'bool' ? false : '' })
}

function displayValue(value) {
  if (Array.isArray(value)) return value.join(', ')
  return value
}
</script>

<template>
  <div :class="['rule-builder', isGroup ? 'rule-group' : 'rule-leaf']">
    <div v-if="isGroup" :style="`margin-left:${depth * 16}px`">
      <div class="d-flex align-items-center gap-2 mb-2">
        <span class="badge" :class="groupKey === 'all' ? 'bg-primary' : 'bg-warning text-dark'">
          {{ groupKey === 'all' ? 'TODAS (E)' : 'QUALQUER (OU)' }}
        </span>
        <button v-if="depth > 0" class="btn btn-sm btn-link p-0 text-danger" @click="emit('remove')">
          <i class="bi bi-x-circle"></i>
        </button>
      </div>
      <div class="border-start ps-3">
        <RuleBuilder
          v-for="(child, idx) in rule[groupKey]"
          :key="idx"
          :rule="child"
          :depth="depth + 1"
          @update:rule="updateChild(idx, $event)"
          @remove="removeChild(idx)"
        />
        <div class="d-flex gap-2 mt-2 flex-wrap">
          <button class="btn btn-sm btn-outline-primary" @click="addCondition">+ Condição</button>
          <button class="btn btn-sm btn-outline-secondary" @click="addSubgroup(groupKey === 'all' ? 'any' : 'all')">
            + Subgrupo {{ groupKey === 'all' ? 'OU' : 'E' }}
          </button>
        </div>
      </div>
    </div>
    <div v-else class="d-flex align-items-center gap-2 mb-2 flex-wrap" :style="`margin-left:${depth * 16}px`">
      <select :value="rule.field" class="form-select form-select-sm" style="max-width:200px" @change="onFieldChange">
        <option v-for="f in FIELDS" :key="f.value" :value="f.value">{{ f.label }}</option>
      </select>
      <select :value="rule.op" class="form-select form-select-sm" style="max-width:140px" @change="updateLeaf({ op: $event.target.value })">
        <option v-for="op in fieldSpec?.ops || []" :key="op" :value="op">{{ OP_LABELS[op] || op }}</option>
      </select>
      <input
        v-if="fieldSpec?.valueType !== 'bool'"
        :value="displayValue(rule.value)"
        class="form-control form-control-sm"
        style="max-width:220px"
        :placeholder="fieldSpec?.valueType === 'list' ? 'separe por vírgula' : (fieldSpec?.valueType === 'duration' ? '30d, 2w, 6h' : '')"
        @input="onValueInput"
      />
      <select v-else :value="rule.value" class="form-select form-select-sm" style="max-width:120px" @change="updateLeaf({ value: $event.target.value === 'true' })">
        <option value="true">verdadeiro</option>
        <option value="false">falso</option>
      </select>
      <button class="btn btn-sm btn-link p-0 text-danger" @click="emit('remove')">
        <i class="bi bi-x-circle"></i>
      </button>
    </div>
  </div>
</template>
