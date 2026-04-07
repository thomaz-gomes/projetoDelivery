<template>
  <div class="d-flex align-items-center gap-1 flex-wrap">
    <span
      v-for="tag in tags"
      :key="tag"
      class="badge d-flex align-items-center gap-1"
      :style="{ backgroundColor: colorForTag(tag), color: 'white', fontSize: '0.7rem' }"
    >
      {{ tag }}
      <i class="bi bi-x" style="cursor: pointer;" @click="removeTag(tag)"></i>
    </span>
    <div v-if="adding">
      <input
        ref="inputRef"
        v-model="newTag"
        type="text"
        list="tag-suggestions"
        class="form-control form-control-sm"
        style="width: 100px; font-size: 0.7rem;"
        @keydown.enter.prevent="addTag"
        @keydown.esc="cancelAdd"
        @blur="addTag"
      />
      <datalist id="tag-suggestions">
        <option v-for="t in inboxStore.allTags" :key="t.tag" :value="t.tag" />
      </datalist>
    </div>
    <button v-else class="btn btn-sm p-0 text-muted" style="font-size: 0.7rem;" @click="startAdd">
      <i class="bi bi-plus"></i> tag
    </button>
  </div>
</template>

<script setup>
import { ref, nextTick, onMounted } from 'vue';
import { useInboxStore } from '@/stores/inbox';

const props = defineProps({
  conversationId: { type: String, required: true },
  tags: { type: Array, default: () => [] },
});

const inboxStore = useInboxStore();
const adding = ref(false);
const newTag = ref('');
const inputRef = ref(null);

const TAG_COLORS = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#34495e'];
function colorForTag(tag) {
  let hash = 0;
  for (const c of tag) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}

function startAdd() {
  adding.value = true;
  nextTick(() => inputRef.value?.focus());
}

function cancelAdd() {
  adding.value = false;
  newTag.value = '';
}

async function addTag() {
  const t = newTag.value.trim().toLowerCase();
  if (t && !props.tags.includes(t)) {
    const updated = [...props.tags, t];
    await inboxStore.updateTags(props.conversationId, updated);
  }
  cancelAdd();
}

async function removeTag(tag) {
  const updated = props.tags.filter(t => t !== tag);
  await inboxStore.updateTags(props.conversationId, updated);
}

onMounted(() => {
  if (!inboxStore.allTags.length) inboxStore.fetchAllTags();
});
</script>
