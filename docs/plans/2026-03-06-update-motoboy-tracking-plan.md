# Update Motoboy Tracking - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix rider tracking so riders appear on login (not just during delivery), disappear on logout, show GPS accuracy circles, and let admins hide riders from the map.

**Architecture:** Extend existing RiderPosition model with `accuracy` and `hidden` fields. Change GPS trigger from order-based to login-based in RiderOrders.vue. Add accuracy circles and hide button to RiderMap.vue. Add stale marker handling client-side.

**Tech Stack:** Prisma (PostgreSQL), Express.js, Vue 3, Leaflet.js, Socket.IO, Browser Geolocation API

---

### Task 1: Schema — Add `accuracy` and `hidden` to RiderPosition

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma:555-564`

**Step 1: Add fields to RiderPosition model**

In `schema.prisma`, find the `RiderPosition` model (line 555) and add `accuracy` and `hidden`:

```prisma
model RiderPosition {
  id        String   @id @default(uuid())
  riderId   String   @unique
  orderId   String?
  lat       Float
  lng       Float
  heading   Float?
  accuracy  Float?
  hidden    Boolean  @default(false)
  updatedAt DateTime @updatedAt
  rider     Rider    @relation(fields: [riderId], references: [id])
}
```

**Step 2: Push schema to dev database**

Run inside backend container:
```bash
npx prisma db push --skip-generate && npx prisma generate
```

Expected: Schema pushed successfully, Prisma client regenerated.

**Step 3: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "feat: add accuracy and hidden fields to RiderPosition"
```

---

### Task 2: Backend — Update position endpoint to accept `accuracy`

**Files:**
- Modify: `delivery-saas-backend/src/routes/riders.js:68-117`

**Step 1: Update POST /riders/me/position**

At line 75, add `accuracy` to destructured body:

```javascript
const { lat, lng, heading, orderId, accuracy } = req.body;
```

At lines 85-89, add `accuracy` to upsert:

```javascript
const position = await prisma.riderPosition.upsert({
  where: { riderId },
  update: { lat, lng, heading: heading ?? null, orderId: orderId ?? null, accuracy: typeof accuracy === 'number' ? accuracy : null },
  create: { riderId, lat, lng, heading: heading ?? null, orderId: orderId ?? null, accuracy: typeof accuracy === 'number' ? accuracy : null },
});
```

At lines 96-104, add `accuracy` to socket payload:

```javascript
emitirPosicaoEntregador(companyId, {
  riderId,
  riderName: rider?.name || 'Entregador',
  lat,
  lng,
  heading: heading ?? null,
  orderId: orderId ?? null,
  accuracy: typeof accuracy === 'number' ? accuracy : null,
  updatedAt: position.updatedAt,
});
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/routes/riders.js
git commit -m "feat: accept accuracy in rider position endpoint"
```

---

### Task 3: Backend — Add hide endpoint and filter hidden positions

**Files:**
- Modify: `delivery-saas-backend/src/routes/riders.js:137-151`

**Step 1: Add PUT /riders/:riderId/position/hide endpoint**

Insert this new route BEFORE the `GET /riders/map/positions` route (before line 137):

```javascript
// PUT /riders/:riderId/position/hide — ADMIN only (toggle hidden on map)
ridersRouter.put('/:riderId/position/hide', requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { riderId } = req.params;
    const { hidden } = req.body;

    // Verify rider belongs to this company
    const rider = await prisma.rider.findFirst({ where: { id: riderId, companyId } });
    if (!rider) return res.status(404).json({ message: 'Entregador não encontrado' });

    const position = await prisma.riderPosition.findUnique({ where: { riderId } });
    if (!position) return res.status(404).json({ message: 'Posição não encontrada' });

    await prisma.riderPosition.update({
      where: { riderId },
      data: { hidden: typeof hidden === 'boolean' ? hidden : true },
    });

    return res.json({ ok: true, hidden: typeof hidden === 'boolean' ? hidden : true });
  } catch (e) {
    console.error('PUT /:riderId/position/hide error:', e);
    return res.status(500).json({ message: 'Erro ao ocultar entregador' });
  }
});
```

**IMPORTANT:** This route uses `:riderId` which conflicts with the existing `/:id` catch-all route at line 153. Place it AFTER the `/map/positions` route but BEFORE the generic `/:id` route. Best location: right after `GET /riders/map/positions` (after line 151).

Actually, a better approach to avoid param conflicts: place it with the other tracking routes (lines 35-151) using a more specific path. Use the path `/:riderId/position/hide` and place it between `GET /map/positions` and `GET /:id`.

**Step 2: Filter hidden positions in GET /riders/map/positions**

At line 141, add `hidden: false` to the where clause:

```javascript
const positions = await prisma.riderPosition.findMany({
  where: { rider: { companyId }, hidden: false },
  include: { rider: { select: { id: true, name: true } } },
  orderBy: { updatedAt: 'desc' },
});
```

**Step 3: Filter hidden from socket broadcasts**

In the `POST /riders/me/position` handler (around line 85), after the upsert, check if the position is hidden before emitting:

```javascript
// Only emit to admin dashboard if not hidden
if (!position.hidden) {
  try {
    emitirPosicaoEntregador(companyId, {
      riderId,
      riderName: rider?.name || 'Entregador',
      lat,
      lng,
      heading: heading ?? null,
      orderId: orderId ?? null,
      accuracy: typeof accuracy === 'number' ? accuracy : null,
      updatedAt: position.updatedAt,
    });
  } catch (e) { /* non-blocking */ }
}
```

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/routes/riders.js
git commit -m "feat: add hide endpoint and filter hidden riders from map"
```

---

### Task 4: Frontend — Change tracking to start on login (RiderOrders.vue)

**Files:**
- Modify: `delivery-saas-frontend/src/views/RiderOrders.vue:329-388,481-494`

**Step 1: Update `startTracking` to send accuracy and not require orderId**

Replace the `startTracking` function (lines 329-356) with:

```javascript
function startTracking(orderId = null) {
  if (!navigator.geolocation) return
  if (watchId !== null) return // already watching
  activeOrderForTracking.value = orderId || '__active__'

  const sendPosition = (pos) => {
    const { latitude: lat, longitude: lng, heading, accuracy } = pos.coords
    // Filter out low-accuracy readings (> 100m = likely cell tower)
    if (accuracy && accuracy > 100) return
    api.post('/riders/me/position', {
      lat,
      lng,
      heading: heading ?? null,
      orderId: orderId ?? null,
      accuracy: accuracy ?? null,
    }).catch((e) => console.warn('GPS position update failed:', e?.message))
  }

  watchId = navigator.geolocation.watchPosition(
    sendPosition,
    (err) => console.warn('GPS watchPosition error:', err?.message),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  )

  // Fallback: send every 30s in case watchPosition is suspended (mobile bg)
  trackingIntervalId = setInterval(() => {
    if (watchId === null) return
    navigator.geolocation.getCurrentPosition(
      sendPosition,
      (err) => console.warn('GPS fallback error:', err?.message),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    )
  }, 30000)
}
```

**Step 2: Update `syncTrackingWithOrders` to always track when enabled**

Replace the `syncTrackingWithOrders` function (lines 377-388) with:

```javascript
function syncTrackingWithOrders(orderList) {
  if (!trackingEnabled.value) { stopTracking(); return }
  // Always track when logged in and tracking is enabled
  const activeOrder = orderList.find(o => o.status === 'SAIU_PARA_ENTREGA')
  const orderId = activeOrder ? activeOrder.id : null
  if (activeOrderForTracking.value === null) {
    // Not tracking yet — start
    startTracking(orderId)
  } else if (activeOrder && activeOrderForTracking.value !== activeOrder.id) {
    // Active order changed — restart with new orderId
    stopTracking()
    startTracking(orderId)
  }
  // If no active order but already tracking, keep tracking (just without orderId)
}
```

**Step 3: Start tracking immediately on mount (not waiting for orders)**

Update `onMounted` (line 481) — after `checkTrackingStatus()`, start tracking right away:

```javascript
onMounted(async () => {
  await checkTrackingStatus()
  // Start GPS tracking immediately if enabled (don't wait for orders)
  if (trackingEnabled.value && navigator.geolocation) {
    startTracking(null)
  }
  load()
  ensureSocket()
  try { window.addEventListener('open-rider-scanner', externalOpenScannerHandler) } catch (e) {}
  document.addEventListener('visibilitychange', onVisibilityChange)
})
```

**Step 4: Add beforeunload handler to clear position on tab close**

Add a `beforeunload` handler after the `onVisibilityChange` function (after line 479):

```javascript
function onBeforeUnload() {
  // Use sendBeacon to notify server that rider is going offline
  const token = localStorage.getItem('token')
  if (token && trackingEnabled.value && activeOrderForTracking.value) {
    const url = `${api.defaults.baseURL}/riders/me/position`
    navigator.sendBeacon(url, new Blob([JSON.stringify({ _method: 'DELETE' })], { type: 'application/json' }))
  }
}
```

**Note:** `sendBeacon` only sends POST requests. The backend needs a small adjustment to handle this, OR we use `fetch` with `keepalive`:

```javascript
function onBeforeUnload() {
  const token = localStorage.getItem('token')
  if (token && trackingEnabled.value && activeOrderForTracking.value) {
    try {
      fetch(`${api.defaults.baseURL}/riders/me/position`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
        keepalive: true,
      }).catch(() => {})
    } catch (e) { /* best effort */ }
  }
}
```

Register in `onMounted`:
```javascript
window.addEventListener('beforeunload', onBeforeUnload)
```

Unregister in `onUnmounted`:
```javascript
window.removeEventListener('beforeunload', onBeforeUnload)
```

**Step 5: Update `onVisibilityChange` to not require active order**

Replace `onVisibilityChange` (lines 468-479):

```javascript
function onVisibilityChange() {
  if (document.visibilityState === 'visible' && trackingEnabled.value) {
    if (activeOrderForTracking.value) {
      // Restart watch — may have been paused by browser while in bg
      const currentOrderId = activeOrderForTracking.value === '__active__' ? null : activeOrderForTracking.value
      stopTracking()
      startTracking(currentOrderId)
    } else {
      // Page came back visible but not tracking — start if enabled
      startTracking(null)
    }
  }
}
```

**Step 6: Update GPS badge in template**

Replace lines 6-10 in the template:

```html
<span v-if="trackingEnabled && activeOrderForTracking" class="badge bg-success px-2 py-1">
  📡 GPS Ativo
</span>
```

This already works since `activeOrderForTracking` will now be set to `'__active__'` even without a delivery order.

**Step 7: Commit**

```bash
git add delivery-saas-frontend/src/views/RiderOrders.vue
git commit -m "feat: start GPS tracking on rider login, add accuracy filter and beforeunload cleanup"
```

---

### Task 5: Frontend — Add accuracy circles, hide button, and stale handling to RiderMap.vue

**Files:**
- Modify: `delivery-saas-frontend/src/views/RiderMap.vue`

**Step 1: Add circles map and stale timer**

After `let markersMap = {}` (line 70), add:

```javascript
let circlesMap = {} // riderId -> L.circle (accuracy radius)
let staleCheckInterval = null
```

**Step 2: Update `updateMarker` to show accuracy circle**

Replace the `updateMarker` function (lines 120-143):

```javascript
function updateMarker(pos) {
  if (!map || !L) return
  const riderId = pos.riderId || pos.rider?.id
  const name = pos.rider?.name || pos.riderName || 'Entregador'
  const lat = Number(pos.lat)
  const lng = Number(pos.lng)
  if (isNaN(lat) || isNaN(lng)) return

  const accuracy = pos.accuracy ? Number(pos.accuracy) : null
  const popupHtml = `
    <div style="min-width:140px">
      <strong>${name}</strong><br>
      <small class="text-muted">Atualizado: ${formatTime(pos.updatedAt)}</small>
      ${pos.orderId ? `<br><small>Pedido: ${pos.orderId.slice(0,8)}...</small>` : ''}
      ${accuracy ? `<br><small>Precisão: ~${Math.round(accuracy)}m</small>` : ''}
      <hr style="margin:4px 0">
      <button onclick="window.__hideRider__('${riderId}')" class="btn btn-sm btn-outline-danger w-100">
        <i class="bi bi-eye-slash me-1"></i>Ocultar do mapa
      </button>
    </div>`

  if (markersMap[riderId]) {
    markersMap[riderId].setLatLng([lat, lng])
    markersMap[riderId].getPopup()?.setContent(popupHtml)
    markersMap[riderId].setOpacity(1) // reset stale opacity
  } else {
    markersMap[riderId] = L.marker([lat, lng], { icon: riderIcon() })
      .bindPopup(popupHtml)
      .addTo(map)
  }

  // Store last update timestamp on the marker for stale detection
  markersMap[riderId]._lastUpdate = new Date(pos.updatedAt || Date.now()).getTime()

  // Accuracy circle
  if (accuracy && accuracy > 0) {
    if (circlesMap[riderId]) {
      circlesMap[riderId].setLatLng([lat, lng])
      circlesMap[riderId].setRadius(accuracy)
    } else {
      circlesMap[riderId] = L.circle([lat, lng], {
        radius: accuracy,
        color: '#0d6efd',
        fillColor: '#0d6efd',
        fillOpacity: 0.1,
        weight: 1,
        opacity: 0.3,
      }).addTo(map)
    }
  } else if (circlesMap[riderId]) {
    // No accuracy data — remove circle
    map.removeLayer(circlesMap[riderId])
    delete circlesMap[riderId]
  }
}
```

**Step 3: Register global hide handler**

In `onMounted`, after `ensureSocket()` (line 230), add:

```javascript
// Global handler for hide button in popup
window.__hideRider__ = async (riderId) => {
  try {
    await api.put(`/riders/${riderId}/position/hide`, { hidden: true })
    removeMarker(riderId)
  } catch (e) {
    console.warn('Failed to hide rider:', e)
  }
}
```

**Step 4: Update `removeMarker` to also remove accuracy circle**

Replace `removeMarker` function (lines 175-181):

```javascript
function removeMarker(riderId) {
  if (markersMap[riderId] && map) {
    map.removeLayer(markersMap[riderId])
    delete markersMap[riderId]
  }
  if (circlesMap[riderId] && map) {
    map.removeLayer(circlesMap[riderId])
    delete circlesMap[riderId]
  }
  positions.value = positions.value.filter(p => (p.riderId || p.rider?.id) !== riderId)
}
```

**Step 5: Update `removeStaleMarkers` to also remove circles**

Replace `removeStaleMarkers` function (lines 145-152):

```javascript
function removeStaleMarkers(activeIds) {
  for (const id of Object.keys(markersMap)) {
    if (!activeIds.includes(id)) {
      map.removeLayer(markersMap[id])
      delete markersMap[id]
      if (circlesMap[id]) {
        map.removeLayer(circlesMap[id])
        delete circlesMap[id]
      }
    }
  }
}
```

**Step 6: Add stale marker check interval**

Add a new function after `removeStaleMarkers`:

```javascript
function checkStaleMarkers() {
  const now = Date.now()
  for (const [riderId, marker] of Object.entries(markersMap)) {
    const lastUpdate = marker._lastUpdate || 0
    const ageMs = now - lastUpdate
    if (ageMs > 5 * 60 * 1000) {
      // 5+ minutes: remove from map
      removeMarker(riderId)
    } else if (ageMs > 2 * 60 * 1000) {
      // 2+ minutes: reduce opacity
      marker.setOpacity(0.5)
      if (circlesMap[riderId]) {
        circlesMap[riderId].setStyle({ fillOpacity: 0.05, opacity: 0.15 })
      }
    }
  }
}
```

In `onMounted`, after the poll interval (line 233), add:

```javascript
staleCheckInterval = setInterval(checkStaleMarkers, 30000)
```

**Step 7: Clean up in `onUnmounted`**

Replace `onUnmounted` (lines 236-241):

```javascript
onUnmounted(() => {
  try { socket?.disconnect() } catch (e) {}
  if (pollInterval) clearInterval(pollInterval)
  if (staleCheckInterval) clearInterval(staleCheckInterval)
  if (map) { map.remove(); map = null }
  markersMap = {}
  circlesMap = {}
  delete window.__hideRider__
})
```

**Step 8: Commit**

```bash
git add delivery-saas-frontend/src/views/RiderMap.vue
git commit -m "feat: accuracy circles, hide button, and stale marker handling on rider map"
```

---

### Task 6: Manual Testing

**Step 1: Test rider login triggers GPS**

1. Log in as a RIDER user
2. Open browser DevTools > Network tab
3. Verify `POST /riders/me/position` requests start appearing immediately (every ~30s)
4. Check that position payloads include `accuracy` field

**Step 2: Test accuracy circle on admin map**

1. Log in as ADMIN in another browser
2. Navigate to Mapa de Entregas
3. Verify rider pin appears with translucent blue circle
4. Verify circle size corresponds to accuracy value

**Step 3: Test hide button**

1. On admin map, click a rider pin
2. Click "Ocultar do mapa" in the popup
3. Verify pin and circle disappear
4. Verify rider doesn't reappear on next poll

**Step 4: Test logout cleanup**

1. Log out as rider
2. Verify admin map removes the rider pin
3. Close rider tab (without logout) — verify `beforeunload` cleans up

**Step 5: Test stale markers**

1. Have a rider send positions, then stop (e.g., turn off location)
2. After 2 minutes, verify pin becomes transparent (50% opacity)
3. After 5 minutes, verify pin is removed from map

**Step 6: Final commit (if any tweaks needed)**

```bash
git add -A
git commit -m "fix: post-testing adjustments for motoboy tracking"
```
