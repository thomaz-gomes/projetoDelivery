<template>
  <div class="list-card container py-4">
    <div class="card">
      <div class="card-body">
        <div class="d-flex align-items-center justify-content-between mb-3">
          <div>
            <h4 class="mb-0">
              <i v-if="icon" :class="icon + ' me-2'"></i>
              {{ title }}
            </h4>
            <div v-if="subtitle" class="small text-muted">{{ subtitle }}</div>
          </div>
          <div>
            <slot name="actions"></slot>
          </div>
        </div>

        <div v-if="$slots.filters" class="mb-3">
          <slot name="filters"></slot>
        </div>

        <slot></slot>

        <div v-if="$slots.footer" class="mt-3">
          <slot name="footer"></slot>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  icon: { type: String, default: '' }
})
</script>

<style scoped>
.list-card { padding-top: 16px }
</style>
