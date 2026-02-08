<template>
  <div class="receipt-editor">
    <!-- Preview visual -->
    <div class="receipt-preview" @click.self="selectedIdx = -1">
      <div
        v-for="(block, idx) in blocks"
        :key="idx"
        class="receipt-block"
        :class="{
          'selected': selectedIdx === idx,
          'block-sep': block.t === 'sep',
          'block-special': ['items','payments','qr'].includes(block.t)
        }"
        @click.stop="selectedIdx = idx"
      >
        <!-- Separator -->
        <div v-if="block.t === 'sep'" class="sep-line">- - - - - - - - - - - - - - - - - - - -</div>

        <!-- Text / Cond -->
        <div
          v-else-if="block.t === 'text' || block.t === 'cond'"
          class="block-content"
          :style="blockStyle(block)"
        >
          <span v-if="block.t === 'cond'" class="cond-badge">SE</span>
          <span v-html="highlightPlaceholders(block.c || '')"></span>
        </div>

        <!-- Items -->
        <div v-else-if="block.t === 'items'" class="block-content block-fixed">
          <i class="bi bi-list-ul me-1"></i> Itens do pedido
          <span v-if="block.itemBold" class="ms-1 badge-fmt">N</span>
          <span v-if="block.itemSize && block.itemSize !== 'normal'" class="ms-1 badge-fmt">{{ sizeLabel(block.itemSize) }}</span>
        </div>

        <!-- Payments -->
        <div v-else-if="block.t === 'payments'" class="block-content block-fixed">
          <i class="bi bi-credit-card me-1"></i> Formas de pagamento
        </div>

        <!-- QR -->
        <div v-else-if="block.t === 'qr'" class="block-content block-fixed">
          <i class="bi bi-qr-code me-1"></i> QR Code (despacho)
        </div>
      </div>
    </div>

    <!-- Toolbar do bloco selecionado -->
    <div v-if="selectedIdx >= 0 && selectedBlock" class="block-toolbar mt-2">
      <div class="d-flex align-items-center gap-1 flex-wrap">
        <!-- Mover -->
        <button class="btn btn-sm btn-outline-secondary" @click="moveBlock(-1)" :disabled="selectedIdx <= 0" title="Mover para cima">
          <i class="bi bi-arrow-up"></i>
        </button>
        <button class="btn btn-sm btn-outline-secondary" @click="moveBlock(1)" :disabled="selectedIdx >= blocks.length - 1" title="Mover para baixo">
          <i class="bi bi-arrow-down"></i>
        </button>

        <span class="toolbar-divider"></span>

        <!-- Alinhamento (text/cond only) -->
        <template v-if="selectedBlock.t === 'text' || selectedBlock.t === 'cond'">
          <button class="btn btn-sm" :class="selectedBlock.a !== 'center' && selectedBlock.a !== 'right' ? 'btn-dark' : 'btn-outline-secondary'" @click="setAlign('left')" title="Esquerda">
            <i class="bi bi-text-left"></i>
          </button>
          <button class="btn btn-sm" :class="selectedBlock.a === 'center' ? 'btn-dark' : 'btn-outline-secondary'" @click="setAlign('center')" title="Centro">
            <i class="bi bi-text-center"></i>
          </button>
          <button class="btn btn-sm" :class="selectedBlock.a === 'right' ? 'btn-dark' : 'btn-outline-secondary'" @click="setAlign('right')" title="Direita">
            <i class="bi bi-text-right"></i>
          </button>

          <span class="toolbar-divider"></span>

          <!-- Negrito -->
          <button class="btn btn-sm" :class="selectedBlock.b ? 'btn-dark' : 'btn-outline-secondary'" @click="toggleBold()" title="Negrito">
            <strong>N</strong>
          </button>

          <span class="toolbar-divider"></span>

          <!-- Tamanho -->
          <button class="btn btn-sm" :class="(!selectedBlock.s || selectedBlock.s === 'normal') ? 'btn-dark' : 'btn-outline-secondary'" @click="setSize('normal')" title="Normal">
            N
          </button>
          <button class="btn btn-sm" :class="selectedBlock.s === 'sm' ? 'btn-dark' : 'btn-outline-secondary'" @click="setSize('sm')" title="Pequeno">
            <small>S</small>
          </button>
          <button class="btn btn-sm" :class="selectedBlock.s === 'lg' ? 'btn-dark' : 'btn-outline-secondary'" @click="setSize('lg')" title="Grande">
            <span style="font-size:1.1em">A</span>
          </button>
          <button class="btn btn-sm" :class="selectedBlock.s === 'xl' ? 'btn-dark' : 'btn-outline-secondary'" @click="setSize('xl')" title="Extra grande">
            <span style="font-size:1.3em">A</span><small>A</small>
          </button>
        </template>

        <!-- Items formatting -->
        <template v-if="selectedBlock.t === 'items'">
          <button class="btn btn-sm" :class="selectedBlock.itemBold ? 'btn-dark' : 'btn-outline-secondary'" @click="selectedBlock.itemBold = !selectedBlock.itemBold; emitUpdate()" title="Itens em negrito">
            <strong>N</strong>
          </button>
          <button class="btn btn-sm" :class="selectedBlock.itemSize === 'lg' ? 'btn-dark' : 'btn-outline-secondary'" @click="selectedBlock.itemSize = selectedBlock.itemSize === 'lg' ? 'normal' : 'lg'; emitUpdate()" title="Itens grandes">
            <span style="font-size:1.1em">A</span>
          </button>
        </template>

        <span class="toolbar-divider"></span>

        <!-- Editar conteúdo -->
        <template v-if="selectedBlock.t === 'text' || selectedBlock.t === 'cond'">
          <input
            v-model="selectedBlock.c"
            class="form-control form-control-sm toolbar-input"
            placeholder="Conteudo do bloco..."
            @input="emitUpdate()"
          />
        </template>
        <template v-if="selectedBlock.t === 'cond'">
          <input
            v-model="selectedBlock.key"
            class="form-control form-control-sm toolbar-key-input"
            placeholder="Variavel"
            @input="emitUpdate()"
          />
        </template>

        <!-- Deletar -->
        <button class="btn btn-sm btn-outline-danger ms-auto" @click="deleteBlock()" title="Remover bloco">
          <i class="bi bi-trash"></i>
        </button>
      </div>
    </div>

    <!-- Adicionar bloco + Inserir placeholder -->
    <div class="d-flex align-items-center gap-2 mt-2 flex-wrap">
      <div class="dd-wrap" v-click-outside="() => showAddMenu = false">
        <button class="btn btn-sm btn-outline-primary" @click="showAddMenu = !showAddMenu">
          + Adicionar bloco <i class="bi bi-chevron-down ms-1" style="font-size:10px"></i>
        </button>
        <ul v-show="showAddMenu" class="dd-menu">
          <li><a class="dd-item" href="#" @click.prevent="addBlock('text'); showAddMenu = false">Texto</a></li>
          <li><a class="dd-item" href="#" @click.prevent="addBlock('sep'); showAddMenu = false">Separador</a></li>
          <li><a class="dd-item" href="#" @click.prevent="addBlock('cond'); showAddMenu = false">Condicional</a></li>
          <li><hr class="dd-divider" /></li>
          <li><a class="dd-item" :class="{ disabled: hasBlock('items') }" href="#" @click.prevent="if(!hasBlock('items')){ addBlock('items'); showAddMenu = false }">Itens do pedido</a></li>
          <li><a class="dd-item" :class="{ disabled: hasBlock('payments') }" href="#" @click.prevent="if(!hasBlock('payments')){ addBlock('payments'); showAddMenu = false }">Formas de pagamento</a></li>
          <li><a class="dd-item" :class="{ disabled: hasBlock('qr') }" href="#" @click.prevent="if(!hasBlock('qr')){ addBlock('qr'); showAddMenu = false }">QR Code</a></li>
        </ul>
      </div>

      <div class="dd-wrap" v-if="selectedIdx >= 0 && selectedBlock && (selectedBlock.t === 'text' || selectedBlock.t === 'cond')" v-click-outside="() => showPhMenu = false">
        <button class="btn btn-sm btn-outline-secondary" @click="showPhMenu = !showPhMenu">
          Inserir placeholder <i class="bi bi-chevron-down ms-1" style="font-size:10px"></i>
        </button>
        <ul v-show="showPhMenu" class="dd-menu dd-menu-ph">
          <li v-for="cat in placeholderCategories" :key="cat.label">
            <div class="dd-header">{{ cat.label }}</div>
            <a
              v-for="ph in cat.items"
              :key="ph.key"
              class="dd-item small"
              href="#"
              @click.prevent="insertPlaceholder(ph.key); showPhMenu = false"
            >
              <code>{{ phWrap(ph.key) }}</code> <span class="text-muted ms-1">{{ ph.label }}</span>
            </a>
          </li>
        </ul>
      </div>

      <div class="ms-auto d-flex gap-2">
        <button class="btn btn-sm btn-outline-secondary" @click="restoreDefault()">
          <i class="bi bi-arrow-counterclockwise me-1"></i>Restaurar padrao
        </button>
        <button class="btn btn-sm btn-outline-primary" @click="$emit('test-print')">
          <i class="bi bi-printer me-1"></i>Imprimir teste
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';

const props = defineProps({
  modelValue: { type: String, default: '' }
});
const emit = defineEmits(['update:modelValue', 'test-print']);

const selectedIdx = ref(-1);
const showAddMenu = ref(false);
const showPhMenu = ref(false);

// v-click-outside directive
const vClickOutside = {
  mounted(el, binding) {
    el._clickOutside = (e) => {
      if (!el.contains(e.target)) binding.value(e);
    };
    document.addEventListener('click', el._clickOutside);
  },
  unmounted(el) {
    document.removeEventListener('click', el._clickOutside);
  }
};

const DEFAULT_BLOCKS = [
  { t: 'sep' },
  { t: 'text', c: '{{header_name}}', a: 'center', b: true, s: 'lg' },
  { t: 'text', c: '{{header_city}}', a: 'center' },
  { t: 'sep' },
  { t: 'text', c: 'PEDIDO #{{display_id}}', a: 'center', b: true, s: 'xl' },
  { t: 'text', c: 'Data: {{data_pedido}}  Hora: {{hora_pedido}}' },
  { t: 'cond', key: 'tipo_pedido', c: 'Tipo: {{tipo_pedido}}' },
  { t: 'sep' },
  { t: 'text', c: 'CLIENTE: {{nome_cliente}}', b: true },
  { t: 'text', c: 'Telefone: {{telefone_cliente}}' },
  { t: 'text', c: 'Endereco: {{endereco_cliente}}' },
  { t: 'sep' },
  { t: 'items', itemBold: true, itemSize: 'normal' },
  { t: 'sep' },
  { t: 'text', c: 'Qtd itens: {{total_itens_count}}' },
  { t: 'text', c: 'Subtotal: R$ {{subtotal}}' },
  { t: 'cond', key: 'taxa_entrega', c: 'Taxa entrega: R$ {{taxa_entrega}}' },
  { t: 'cond', key: 'desconto', c: 'Desconto: R$ {{desconto}}' },
  { t: 'text', c: 'TOTAL: R$ {{total}}', b: true, s: 'lg' },
  { t: 'sep' },
  { t: 'text', c: 'FORMAS DE PAGAMENTO', b: true },
  { t: 'payments' },
  { t: 'cond', key: 'observacoes', c: 'OBS: {{observacoes}}' },
  { t: 'qr' },
  { t: 'sep' },
  { t: 'text', c: 'Obrigado e bom apetite!', a: 'center' },
  { t: 'sep' }
];

const placeholderCategories = [
  {
    label: 'Dados da loja',
    items: [
      { key: 'header_name', label: 'Nome da loja' },
      { key: 'header_city', label: 'Cidade' }
    ]
  },
  {
    label: 'Pedido',
    items: [
      { key: 'display_id', label: 'N. Pedido' },
      { key: 'data_pedido', label: 'Data' },
      { key: 'hora_pedido', label: 'Hora' },
      { key: 'tipo_pedido', label: 'Tipo (DELIVERY/PICKUP)' },
      { key: 'observacoes', label: 'Obs. do pedido' }
    ]
  },
  {
    label: 'Cliente',
    items: [
      { key: 'nome_cliente', label: 'Nome do cliente' },
      { key: 'telefone_cliente', label: 'Telefone' },
      { key: 'endereco_cliente', label: 'Endereco' }
    ]
  },
  {
    label: 'Valores',
    items: [
      { key: 'total_itens_count', label: 'Qtd de itens' },
      { key: 'subtotal', label: 'Subtotal' },
      { key: 'taxa_entrega', label: 'Taxa de entrega' },
      { key: 'desconto', label: 'Desconto' },
      { key: 'total', label: 'Total' }
    ]
  }
];

// Parse initial value
const blocks = ref(parseModelValue(props.modelValue));

function parseModelValue(val) {
  if (!val) return JSON.parse(JSON.stringify(DEFAULT_BLOCKS));
  try {
    const parsed = JSON.parse(val);
    if (parsed && parsed.v === 2 && Array.isArray(parsed.blocks)) {
      return parsed.blocks;
    }
  } catch (e) { /* not JSON */ }
  // Plain text template - return default blocks
  return JSON.parse(JSON.stringify(DEFAULT_BLOCKS));
}

watch(() => props.modelValue, (val) => {
  try {
    const parsed = JSON.parse(val);
    if (parsed && parsed.v === 2 && Array.isArray(parsed.blocks)) {
      // Only update if different from current (avoid loops)
      if (JSON.stringify(parsed.blocks) !== JSON.stringify(blocks.value)) {
        blocks.value = parsed.blocks;
      }
    }
  } catch (e) { /* ignore */ }
});

const selectedBlock = computed(() => {
  if (selectedIdx.value >= 0 && selectedIdx.value < blocks.value.length) {
    return blocks.value[selectedIdx.value];
  }
  return null;
});

function emitUpdate() {
  const json = JSON.stringify({ v: 2, blocks: blocks.value });
  emit('update:modelValue', json);
}

function blockStyle(block) {
  const s = {};
  if (block.a === 'center') s.textAlign = 'center';
  else if (block.a === 'right') s.textAlign = 'right';
  if (block.b) s.fontWeight = 'bold';
  if (block.s === 'sm') s.fontSize = '11px';
  else if (block.s === 'lg') s.fontSize = '16px';
  else if (block.s === 'xl') s.fontSize = '20px';
  return s;
}

function highlightPlaceholders(text) {
  return text.replace(/\{\{(\w+)\}\}/g, '<span class="ph-tag">{{$1}}</span>');
}

function phWrap(key) {
  return '\u007B\u007B' + key + '\u007D\u007D';
}

function sizeLabel(s) {
  if (s === 'sm') return 'S';
  if (s === 'lg') return 'A';
  if (s === 'xl') return 'aA';
  return 'N';
}

function setAlign(a) {
  if (!selectedBlock.value) return;
  selectedBlock.value.a = a;
  emitUpdate();
}

function toggleBold() {
  if (!selectedBlock.value) return;
  selectedBlock.value.b = !selectedBlock.value.b;
  emitUpdate();
}

function setSize(s) {
  if (!selectedBlock.value) return;
  selectedBlock.value.s = s;
  emitUpdate();
}

function moveBlock(dir) {
  const from = selectedIdx.value;
  const to = from + dir;
  if (to < 0 || to >= blocks.value.length) return;
  const tmp = blocks.value[from];
  blocks.value[from] = blocks.value[to];
  blocks.value[to] = tmp;
  selectedIdx.value = to;
  emitUpdate();
}

function deleteBlock() {
  if (selectedIdx.value < 0) return;
  blocks.value.splice(selectedIdx.value, 1);
  selectedIdx.value = -1;
  emitUpdate();
}

function addBlock(type) {
  let newBlock;
  switch (type) {
    case 'text': newBlock = { t: 'text', c: 'Novo texto' }; break;
    case 'sep': newBlock = { t: 'sep' }; break;
    case 'cond': newBlock = { t: 'cond', key: 'observacoes', c: '{{observacoes}}' }; break;
    case 'items': newBlock = { t: 'items', itemBold: true, itemSize: 'normal' }; break;
    case 'payments': newBlock = { t: 'payments' }; break;
    case 'qr': newBlock = { t: 'qr' }; break;
    default: return;
  }
  const insertAt = selectedIdx.value >= 0 ? selectedIdx.value + 1 : blocks.value.length;
  blocks.value.splice(insertAt, 0, newBlock);
  selectedIdx.value = insertAt;
  emitUpdate();
}

function hasBlock(type) {
  return blocks.value.some(b => b.t === type);
}

function insertPlaceholder(key) {
  if (!selectedBlock.value || (selectedBlock.value.t !== 'text' && selectedBlock.value.t !== 'cond')) return;
  selectedBlock.value.c = (selectedBlock.value.c || '') + '{{' + key + '}}';
  emitUpdate();
}

function restoreDefault() {
  blocks.value = JSON.parse(JSON.stringify(DEFAULT_BLOCKS));
  selectedIdx.value = -1;
  emitUpdate();
}
</script>

<style scoped>
.receipt-editor {
  width: 100%;
}

.receipt-preview {
  background: #fffde7;
  border: 1px solid #e0d8a8;
  border-radius: 6px;
  padding: 12px 16px;
  font-family: 'Courier New', Courier, monospace;
  font-size: 13px;
  min-height: 200px;
  max-height: 450px;
  overflow-y: auto;
  cursor: default;
}

.receipt-block {
  padding: 2px 4px;
  margin: 1px 0;
  border-radius: 3px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: border-color 0.15s, background 0.15s;
}
.receipt-block:hover {
  border-color: #ccc;
  background: rgba(0,0,0,0.03);
}
.receipt-block.selected {
  border-color: #5c6cff;
  background: rgba(92,108,255,0.08);
}

.block-sep .sep-line {
  text-align: center;
  color: #999;
  font-size: 12px;
  letter-spacing: 1px;
  user-select: none;
}

.block-content {
  min-height: 18px;
  line-height: 1.4;
  word-break: break-word;
}

.block-fixed {
  color: #666;
  font-style: italic;
  font-size: 12px;
}

.ph-tag {
  background: #fff3cd;
  color: #856404;
  border-radius: 3px;
  padding: 0 3px;
  font-size: 12px;
  font-weight: 600;
}

.cond-badge {
  background: #e8daef;
  color: #6c3483;
  border-radius: 3px;
  padding: 0 4px;
  font-size: 10px;
  font-weight: 700;
  margin-right: 4px;
  vertical-align: middle;
}

.badge-fmt {
  background: #d6e4f0;
  color: #2c5282;
  border-radius: 3px;
  padding: 0 4px;
  font-size: 10px;
  font-weight: 700;
}

.block-toolbar {
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 6px;
  padding: 8px;
}

.toolbar-divider {
  display: inline-block;
  width: 1px;
  height: 24px;
  background: #dee2e6;
  margin: 0 4px;
  vertical-align: middle;
}

.toolbar-input {
  flex: 1;
  min-width: 160px;
  max-width: 300px;
  font-family: 'Courier New', Courier, monospace;
  font-size: 12px;
}

.toolbar-key-input {
  width: 120px;
  font-family: 'Courier New', Courier, monospace;
  font-size: 12px;
}

.dd-wrap {
  position: relative;
  display: inline-block;
}
.dd-menu {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 1050;
  min-width: 200px;
  background: #fff;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  padding: 4px 0;
  margin-top: 2px;
  list-style: none;
}
.dd-menu-ph {
  max-height: 300px;
  overflow-y: auto;
  min-width: 280px;
}
.dd-item {
  display: block;
  padding: 5px 12px;
  color: #333;
  text-decoration: none;
  font-size: 13px;
  cursor: pointer;
}
.dd-item:hover {
  background: #f0f0f0;
  color: #111;
}
.dd-item.disabled {
  color: #aaa;
  pointer-events: none;
}
.dd-divider {
  margin: 4px 0;
  border-top: 1px solid #eee;
}
.dd-header {
  padding: 4px 12px 2px;
  font-size: 11px;
  font-weight: 700;
  color: #888;
  text-transform: uppercase;
}
.dd-menu code {
  font-size: 11px;
  color: #856404;
  background: #fff3cd;
  padding: 1px 3px;
  border-radius: 2px;
}
</style>
