# Update Motoboy Tracking - Design

## Problems

1. **Poor GPS accuracy** - Rider appears on map with imprecise position (cell tower vs GPS)
2. **Stale pins after logout** - Rider's marker remains on the map after logging out
3. **Tracking scope too narrow** - GPS only activates during active delivery (SAIU_PARA_ENTREGA), but riders should be visible as soon as they log in

## Approach

Extend the current architecture (RiderPosition model + Socket.IO events) with minimal changes. No new services or tables.

## Data Model Changes

Add two fields to `RiderPosition`:

```prisma
model RiderPosition {
  // existing fields...
  accuracy  Float?                // GPS accuracy in meters (from browser API)
  hidden    Boolean @default(false) // admin can hide rider from map
}
```

Update `POST /riders/me/position` payload to accept `accuracy`.

## Tracking Lifecycle

### Current
GPS starts on `SAIU_PARA_ENTREGA` order status, stops when order completes.

### New
1. **On login (RiderOrders.vue mount):** If user is RIDER and tracking is enabled for the company, immediately start `watchPosition()` and send positions every 15-30s. No dependency on order status.
2. **On logout:** Call `DELETE /riders/me/position` to clear position from DB, triggers `rider-offline` socket event, pin removed from admin maps.
3. **On tab close (beforeunload):** Send beacon request to `DELETE /riders/me/position` via `navigator.sendBeacon()`.
4. **Stale cleanup:** Keep existing 24h server-side cleanup. Client-side: gray out markers not updated in 2+ min, remove after 5 min.

## GPS Accuracy Improvements

1. **Filter low-accuracy readings:** Only send positions with accuracy <= 100m. Skip readings above threshold.
2. **Send accuracy to server:** Include `accuracy` in position payload.
3. **Accuracy circle on map:** Use `L.circle(latlng, { radius: accuracy })` for a translucent uncertainty circle around each pin.
4. **Dual tracking:** Keep `watchPosition` as primary source with `getCurrentPosition` fallback every 30s.

## Admin Map Enhancements (RiderMap.vue)

1. **Accuracy circle:** Each marker gets a companion `L.circle` showing GPS uncertainty area.
2. **Hide rider button:** Popup includes "Hide" button. Calls `PUT /riders/:riderId/position/hide` to set `hidden=true`. Hidden riders filtered from `GET /riders/map/positions` and socket broadcasts.
3. **Stale markers:** 2+ min without update = 50% opacity. 5+ min = removed from map.
4. **Logout cleanup:** Both marker and accuracy circle removed on `rider-offline` event.

## Backend Changes

### New/Modified Endpoints
- `POST /riders/me/position` - Add `accuracy` to payload and DB upsert
- `PUT /riders/:riderId/position/hide` - New. Sets `hidden=true` on RiderPosition (ADMIN only)
- `GET /riders/map/positions` - Filter out `hidden=true` positions

### Socket Events
- `rider-position` payload: add `accuracy` field
- Ensure `rider-offline` is emitted on logout and position delete

## Files to Modify

| File | Changes |
|------|---------|
| `schema.prisma` | Add `accuracy` and `hidden` to RiderPosition |
| `src/routes/riders.js` | Update position endpoint, add hide endpoint, filter hidden |
| `src/index.js` | Add `accuracy` to `emitirPosicaoEntregador` payload |
| `RiderOrders.vue` | Start tracking on mount (not on order status), send accuracy, beacon on unload |
| `RiderMap.vue` | Accuracy circles, hide button, stale marker handling, proper cleanup |
