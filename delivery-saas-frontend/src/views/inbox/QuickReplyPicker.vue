<template>
  <div
    class="border rounded bg-white shadow-sm mb-2"
    style="max-height: 200px; overflow-y: auto;"
  >
    <div v-if="!filtered.length" class="p-3 text-center text-muted small">
      Nenhuma resposta rapida
    </div>
    <div
      v-for="reply in filtered"
      :key="reply.id"
      class="px-3 py-2 border-bottom cursor-pointer hover-bg-light"
      style="cursor: pointer;"
      @click="$emit('select', reply)"
    >
      <div class="d-flex align-items-center gap-2">
        <span class="badge bg-secondary-subtle text-secondary">{{ reply.shortcut }}</span>
        <span class="fw-semibold small">{{ reply.title }}</span>
      </div>
      <small class="text-muted text-truncate d-block" style="max-width: 300px;">
        {{ reply.body }}
      </small>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useInboxStore } from '@/stores/inbox';

const props = defineProps({
  filter: { type: String, default: '' },
});

defineEmits(['select']);

const inboxStore = useInboxStore();

const filtered = computed(() => {
  const withShortcut = inboxStore.quickReplies.filter(r => r.shortcut);
  const q = (props.filter || '').toLowerCase();
  if (!q) return withShortcut;
  return withShortcut.filter(r =>
    r.shortcut.toLowerCase().includes(q) ||
    (r.title && r.title.toLowerCase().includes(q))
  );
});
</script>

<style scoped>
.hover-bg-light:hover {
  background-color: var(--bs-light);
}
</style>
