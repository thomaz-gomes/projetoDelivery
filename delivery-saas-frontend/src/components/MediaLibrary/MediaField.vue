<template>
  <div>
    <label v-if="label" class="form-label">{{ label }}</label>
    <div class="media-input-group">
      <div class="media-input-group__preview" :class="{ 'media-input-group__preview--empty': !modelValue }">
        <img v-if="modelValue" :src="assetUrl(modelValue)" alt="" />
        <i v-else class="bi bi-image"></i>
      </div>
      <div class="media-input-group__info">
        <div class="media-input-group__filename">{{ displayName }}</div>
      </div>
      <div class="media-input-group__actions">
        <button type="button" class="btn btn-sm btn-outline-primary" @click="openLibrary">
          <i class="bi bi-folder2-open me-1"></i>Selecionar
        </button>
        <button v-if="modelValue" type="button" class="btn btn-sm btn-outline-danger" @click="remove">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { assetUrl } from '../../utils/assetUrl.js'
import { useMediaLibrary } from '../../composables/useMediaLibrary.js'

const props = defineProps({
  modelValue: { type: String, default: null },
  label: { type: String, default: '' },
  fieldId: { type: String, required: true }
})

const emit = defineEmits(['update:modelValue'])

const { openFor } = useMediaLibrary()

const displayName = computed(() => {
  if (!props.modelValue) return 'Nenhuma imagem selecionada'
  const parts = props.modelValue.split('/')
  return parts[parts.length - 1] || props.modelValue
})

function openLibrary() {
  openFor(props.fieldId, (url) => {
    emit('update:modelValue', url)
  })
}

function remove() {
  emit('update:modelValue', null)
}
</script>
