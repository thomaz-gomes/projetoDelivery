<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import Swal from 'sweetalert2';
import api from '../api';

const router = useRouter();
const auth = useAuthStore();

const scanning = ref(false);
const videoEl = ref(null);
let stream = null;
let qrScanner = null;

// allow external trigger to open scanner (MobileBottomNav will dispatch a CustomEvent)
function externalOpenScannerHandler(){
  try{ if(!scanning.value) startScanner().catch(()=>{}); }catch(e){ console.warn('externalOpenScannerHandler', e) }
}

function goOrders() {
  router.push('/rider/orders');
}

function goStatement() {
  router.push('/rider/account');
}

function stopScanner() {
  scanning.value = false;
  if (qrScanner) {
    try { qrScanner.stop(); } catch (__) {}
    qrScanner = null;
  }
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
}

async function startScanner() {
  // Try BarcodeDetector first (native). If not available or it errors, fall back to qr-scanner library.
  try {
    scanning.value = true;
    const constraints = { video: { facingMode: 'environment' } };
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    if (videoEl.value) videoEl.value.srcObject = stream;

    if ('BarcodeDetector' in window) {
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const poll = async () => {
        if (!scanning.value) return;
        try {
          const detections = await detector.detect(videoEl.value);
          if (detections && detections.length > 0) {
            const raw = detections[0].rawValue || detections[0].rawData || '';
            stopScanner();
            await claimTokenFromText(raw);
            return;
          }
        } catch (e) {
          console.warn('BarcodeDetector error, falling back to qr-scanner', e);
          try { await startQrScannerFallback(); } catch (__) {}
          return;
        }
        setTimeout(poll, 500);
      };
      setTimeout(poll, 500);
    } else {
      await startQrScannerFallback();
    }
  } catch (e) {
    console.error('Scanner error', e);
    // fallback to manual input if camera access failed
    const { value: token } = await Swal.fire({ title: 'Ler QR', input: 'text', inputLabel: 'Cole o token do QR ou URL', inputPlaceholder: 'cole aqui', showCancelButton: true });
    if (token) await claimTokenFromText(token);
    scanning.value = false;
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }
}

async function startQrScannerFallback() {
  try {
    const module = await import('qr-scanner');
    const QrScanner = module.default || module;
    // Vite serves node_modules used by imports; use an absolute path to the worker in dev.
    QrScanner.WORKER_PATH = '/node_modules/qr-scanner/qr-scanner-worker.min.js';
    qrScanner = new QrScanner(videoEl.value, result => {
      stopScanner();
      claimTokenFromText(result).catch(()=>{});
    });
    await qrScanner.start();
  } catch (e) {
    console.error('qr-scanner fallback failed', e);
    const { value: token } = await Swal.fire({ title: 'Ler QR', input: 'text', inputLabel: 'Cole o token do QR ou URL', inputPlaceholder: 'cole aqui', showCancelButton: true });
    if (token) await claimTokenFromText(token);
  }
}

async function claimTokenFromText(text) {
  // extract token from URL or use text directly
  if (!text) return Swal.fire({ icon: 'error', text: 'QR inválido' });
  const m = String(text).match(/([A-Za-z0-9_-]{8,})$/);
  const token = m ? m[1] : String(text).trim();
  try {
    const { data } = await api.post(`/tickets/${encodeURIComponent(token)}/claim`);
    if (data && data.ok) {
      Swal.fire({ icon: 'success', title: 'Pedido atribuído', html: `Pedido <b>${data.order.displayId || data.order.id}</b> atribuído a você.` });
      // navigate to orders list
      router.push('/rider/orders');
    } else {
      Swal.fire({ icon: 'error', text: 'Falha ao atribuir pedido' });
    }
  } catch (e) {
    console.error('claim failed', e);
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Falha ao ler QR e atribuir pedido' });
  }
}

onMounted(()=>{
  try{ window.addEventListener('open-rider-scanner', externalOpenScannerHandler) }catch(e){}
  // automatically open scanner when the view loads
  try{ startScanner().catch(()=>{}); }catch(e){ console.warn('auto start scanner failed', e) }
})
onBeforeUnmount(()=>{ try{ window.removeEventListener('open-rider-scanner', externalOpenScannerHandler) }catch(e){} })
</script>

<template>
  <div class="rider-home d-flex flex-column align-items-center justify-content-start vh-100 p-3 bg-white" style="max-width:480px;margin:0 auto;">
    <div class="w-100 mt-3 mb-4 text-center">
      <h4 class="m-0">Leitor de QR</h4>
      <div class="small text-muted">{{ auth.user?.name || '' }}</div>
    </div>

    <div class="w-100 d-grid gap-3" style="grid-template-columns:1fr;">
      <button class="btn btn-primary btn-lg py-3" @click="goOrders">Pedidos</button>
      <button class="btn btn-outline-primary btn-lg py-3" @click="goStatement">Meu Extrato</button>
      <button v-if="!scanning" class="btn btn-success btn-lg py-3" @click="startScanner">Ler pedido (QR)</button>
    </div>

    <div v-if="scanning" class="scanner-overlay fixed-top d-flex flex-column align-items-center justify-content-center p-3">
      <div class="card p-2" style="width:100%;max-width:420px;">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <strong>Leitor QR</strong>
          <button class="btn btn-sm btn-outline-secondary" @click="stopScanner">Fechar</button>
        </div>
        <video ref="videoEl" autoplay playsinline muted style="width:100%;height:360px;object-fit:cover;border-radius:8px;background:#000"></video>
        <div class="small text-muted mt-2">Aponte a câmera para o QR do pedido. Caso não funcione, cole o token manualmente.</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rider-home { background: #f8f9fa; }
.scanner-overlay { z-index: 2000; padding-top:60px; }
@media (min-width: 480px) {
  .rider-home { max-width:420px; }
}
</style>