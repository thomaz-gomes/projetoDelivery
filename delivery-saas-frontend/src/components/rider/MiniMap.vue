<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue';

const props = defineProps({
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  label: { type: String, default: '' },
  height: { type: String, default: '120px' },
});

const mapContainer = ref(null);
let map = null;
let marker = null;
let L = null;

async function initMap() {
  if (!mapContainer.value || map) return;
  // Dynamic import to avoid loading Leaflet when not needed
  L = await import('leaflet');
  await import('leaflet/dist/leaflet.css');

  map = L.map(mapContainer.value, {
    center: [props.lat, props.lng],
    zoom: 16,
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    touchZoom: false,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
  }).addTo(map);

  // Custom small marker icon
  const icon = L.divIcon({
    html: '<div style="background:#dc3545;width:14px;height:14px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3)"></div>',
    className: '',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });

  marker = L.marker([props.lat, props.lng], { icon }).addTo(map);
  if (props.label) marker.bindTooltip(props.label, { permanent: false });
}

function openNavigation() {
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${props.lat},${props.lng}`, '_blank');
}

onMounted(() => {
  // Delay init slightly so the container has dimensions
  setTimeout(initMap, 100);
});

onUnmounted(() => {
  if (map) { map.remove(); map = null; }
});

watch(() => [props.lat, props.lng], ([newLat, newLng]) => {
  if (map && marker) {
    map.setView([newLat, newLng], 16);
    marker.setLatLng([newLat, newLng]);
  }
});
</script>

<template>
  <div
    ref="mapContainer"
    class="mini-map"
    :style="{ height }"
    @click="openNavigation"
    role="button"
    :title="'Navegar até ' + (label || 'destino')"
  ></div>
</template>

<style scoped>
.mini-map {
  width: 100%;
  border-radius: var(--rider-radius-sm, 10px);
  overflow: hidden;
  cursor: pointer;
  border: 1px solid var(--rider-card-border, rgba(0,0,0,0.06));
}
</style>
