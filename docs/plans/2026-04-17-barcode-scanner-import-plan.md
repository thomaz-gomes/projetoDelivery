# Barcode Scanner Global Import Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Detect 44-digit NFe access keys from barcode scanners anywhere in the app and open the import modal pre-filled. If the modal is already open (e.g. error state), a new scan resets and restarts the process.

**Architecture:** Global keydown listener in App.vue buffers rapid digit input. When 44 digits + Enter are detected within scanner-speed timing, a composable opens/resets PurchaseImportModal with the access key pre-filled and auto-starts parsing.

**Tech Stack:** Vue 3 Composition API, existing composable pattern (like useMediaLibrary/useAiStudio)

---

### Task 1: Create `useBarcodeScanner` composable

**Files:**
- Create: `delivery-saas-frontend/src/composables/useBarcodeScanner.js`

**Step 1: Create the composable**

```javascript
import { ref, onMounted, onUnmounted } from 'vue'

const buffer = ref('')
const lastKeyTime = ref(0)
const scanCallback = ref(null)

const MAX_KEY_INTERVAL = 80   // ms between keys (scanner is <20ms, human >100ms)
const EXPECTED_LENGTH = 44

export function useBarcodeScanner() {
  function onScan(callback) {
    scanCallback.value = callback
  }

  function handleKeyDown(e) {
    // Ignore when focus is on input/textarea/contenteditable
    const tag = e.target?.tagName
    const editable = e.target?.isContentEditable
    if (tag === 'INPUT' || tag === 'TEXTAREA' || editable) return

    const now = Date.now()

    if (e.key === 'Enter') {
      const digits = buffer.value.replace(/\D/g, '')
      if (digits.length === EXPECTED_LENGTH) {
        e.preventDefault()
        if (scanCallback.value) scanCallback.value(digits)
      }
      buffer.value = ''
      return
    }

    // Only accumulate digits
    if (/^\d$/.test(e.key)) {
      // Reset buffer if too much time passed since last key
      if (now - lastKeyTime.value > MAX_KEY_INTERVAL && buffer.value.length > 0) {
        buffer.value = ''
      }
      buffer.value += e.key
      lastKeyTime.value = now
    }
  }

  function start() {
    document.addEventListener('keydown', handleKeyDown, true)
  }

  function stop() {
    document.removeEventListener('keydown', handleKeyDown, true)
  }

  return { onScan, start, stop }
}
```

**Step 2: Commit**

```bash
git add delivery-saas-frontend/src/composables/useBarcodeScanner.js
git commit -m "feat: add useBarcodeScanner composable for 44-digit NFe detection"
```

---

### Task 2: Add `initialAccessKey` prop to PurchaseImportModal

**Files:**
- Modify: `delivery-saas-frontend/src/components/PurchaseImportModal.vue`

**Step 1: Add the new prop**

At line 487-490, add `initialAccessKey` prop:

```javascript
const props = defineProps({
  storeId: { type: String, default: null },
  reviewImportId: { type: String, default: null },
  initialAccessKey: { type: String, default: null },
})
```

**Step 2: Add watch to handle new access key (including when modal is already open)**

After the `onMounted` block (~line 588), add a watch:

```javascript
// Watch for new access key (supports re-scan while modal is open)
watch(() => props.initialAccessKey, async (newKey) => {
  if (!newKey || newKey.replace(/\D/g, '').length !== 44) return

  // Reset state for fresh import
  step.value = 2
  method.value = 'access_key'
  accessKey.value = newKey.replace(/\D/g, '')
  parseError.value = ''
  processing.value = false
  importIds.value = []
  reviewItems.value = []

  // Auto-select single store
  if (stores.value.length === 1 && !selectedStoreId.value) {
    selectedStoreId.value = stores.value[0].id
  }

  // Auto-start parse if store is selected
  if (selectedStoreId.value && canParse.value) {
    await startParse()
  }
}, { immediate: true })
```

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/components/PurchaseImportModal.vue
git commit -m "feat: add initialAccessKey prop with auto-reset on re-scan"
```

---

### Task 3: Wire scanner + modal in App.vue

**Files:**
- Modify: `delivery-saas-frontend/src/App.vue`

**Step 1: Import composable and modal component**

Add imports at the top of `<script setup>`:

```javascript
import { useBarcodeScanner } from './composables/useBarcodeScanner.js'
import PurchaseImportModal from './components/PurchaseImportModal.vue'
```

**Step 2: Add scanner state and wiring**

After existing refs (around line 30), add:

```javascript
// ── Barcode Scanner → Purchase Import ──
const scannerImportOpen = ref(false)
const scannerAccessKey = ref(null)
const scannerKeyCounter = ref(0)  // forces reactivity on re-scan of same key

const scanner = useBarcodeScanner()
scanner.onScan((digits) => {
  scannerAccessKey.value = digits
  scannerKeyCounter.value++
  scannerImportOpen.value = true
})

function onScannerModalClose() {
  scannerImportOpen.value = false
  scannerAccessKey.value = null
}
```

**Step 3: Start/stop scanner in onMounted**

In the existing `onMounted` block (line 125), add:

```javascript
scanner.start()
```

No need for onUnmounted since App.vue lives for the entire app lifecycle.

**Step 4: Add modal to template**

After the `<ImportProgressBar />` line (line 317), add:

```html
<!-- Barcode scanner → Purchase Import modal -->
<PurchaseImportModal
  v-if="scannerImportOpen"
  :initial-access-key="scannerAccessKey"
  :key="scannerKeyCounter"
  @close="onScannerModalClose"
  @imported="onScannerModalClose"
/>
```

Note: `:key="scannerKeyCounter"` forces Vue to re-create the modal when the same key is scanned again, ensuring fresh state.

**Step 5: Commit**

```bash
git add delivery-saas-frontend/src/App.vue
git commit -m "feat: wire barcode scanner to purchase import modal in App.vue"
```

---

### Task 4: Handle re-scan in already-open modal (from PurchaseImports.vue)

**Files:**
- Modify: `delivery-saas-frontend/src/views/stock/PurchaseImports.vue`

The PurchaseImports page has its own instance of the modal. When it's open and the user scans, we need the existing modal to reset instead of opening a second one.

**Step 1: Add scanner listener to PurchaseImports.vue**

In the `<script setup>` section, import the scanner event and add a listener:

```javascript
// Listen for barcode scanner events when our modal is already open
onMounted(() => {
  window.addEventListener('barcode:scanned', onBarcodeScanned)
})
onUnmounted(() => {
  window.removeEventListener('barcode:scanned', onBarcodeScanned)
})

function onBarcodeScanned(e) {
  const digits = e.detail?.accessKey
  if (!digits || digits.length !== 44) return
  // If our modal is already open, update the access key to restart
  if (showImportModal.value) {
    scannerAccessKeyForModal.value = digits
  }
}
```

Actually — this adds complexity. Since App.vue uses `:key` to force re-creation, the simpler approach is:

- The scanner in App.vue checks if its modal is already open. If yes, it increments the key counter to force re-mount with the new access key.
- If the PurchaseImports page modal is open, the scanner event from App.vue won't conflict because the scanner ignores keydowns in input fields (and the modal has input fields focused).

**Revised approach:** No changes needed in PurchaseImports.vue. The App.vue scanner + `:key` counter handles all cases. If the user has the PurchaseImports modal open manually (without scanner), they can close it and scan — the App.vue modal opens.

**Skip this task — no changes needed.**

---

### Task 5: Emit `barcode:scanned` event from composable for extensibility

**Files:**
- Modify: `delivery-saas-frontend/src/composables/useBarcodeScanner.js`

**Step 1: Add window event dispatch**

In the `handleKeyDown` function, after calling the callback, also dispatch a window event:

```javascript
if (scanCallback.value) scanCallback.value(digits)
window.dispatchEvent(new CustomEvent('barcode:scanned', { detail: { accessKey: digits } }))
```

This allows other components to react to scans without coupling to the composable.

**Step 2: Commit**

```bash
git add delivery-saas-frontend/src/composables/useBarcodeScanner.js
git commit -m "feat: emit barcode:scanned window event for extensibility"
```

---

### Task 6: Test manually with scanner

**Steps:**
1. Start dev server: `docker compose up -d`
2. Open any page in the app (e.g., Dashboard, Orders)
3. Scan an NFe barcode with the physical scanner
4. Verify: modal opens with access key pre-filled, method = "Chave de Acesso", step = 2
5. If store auto-selects (single store), parse should start automatically
6. If parse fails, scan another barcode → verify modal resets with new key
7. Navigate to PurchaseImports page, scan → verify modal opens correctly
