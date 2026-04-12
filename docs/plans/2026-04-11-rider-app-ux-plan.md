# Rider App UX Overhaul - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the rider web views into a native-feeling mobile app experience with proper header, metrics dashboard, focus mode, bottom sheets, theming, embedded maps, and swipe navigation.

**Architecture:** All changes are frontend-only in `delivery-saas-frontend/src/`. One new backend endpoint for rider daily stats. The rider area uses Vue 3 + Bootstrap 5 + scoped CSS. A new `rider-theme.css` provides CSS variables scoped to `.rider-app`. Leaflet (free) for embedded maps.

**Tech Stack:** Vue 3 Composition API, Bootstrap 5, Leaflet.js (maps), CSS custom properties, touch events

---

### Task 1: Rider Fixed Header

**Files:**
- Create: `src/components/rider/RiderHeader.vue`
- Modify: `src/views/rider/Orders.vue` — replace inline h4 with RiderHeader
- Modify: `src/views/rider/Dashboard.vue` — add RiderHeader
- Modify: `src/views/rider/Checkin.vue` — add RiderHeader
- Modify: `src/views/rider/Ranking.vue` — add RiderHeader
- Modify: `src/views/rider/Account.vue` — add RiderHeader

**Design:**
- Fixed top bar (56px), green (#198754) background, white text
- Left: GPS status dot (green/yellow/red pulsing)
- Center: "Core Delivery" logo or text
- Right: rider avatar circle with initials
- All rider views get `padding-top: 64px` to compensate

---

### Task 2: Dashboard with Real Metrics

**Files:**
- Create: backend `GET /riders/me/daily-stats` in `src/routes/riders.js`
- Modify: `src/views/rider/Dashboard.vue` — complete rewrite

**Backend endpoint returns:**
```json
{
  "todayEarnings": 127.50,
  "todayDeliveries": 8,
  "monthEarnings": 2450.00,
  "monthDeliveries": 87,
  "checkedIn": true,
  "nextOrder": { "id": "...", "displayId": "#42", "status": "PRONTO", "address": "Rua..." }
}
```

**Frontend design:**
- Hero card: today's earnings (large green number) + delivery count
- Next order preview card (if any active order)
- Monthly summary row (smaller)
- Quick nav grid (4 items) below

---

### Task 3: Bottom Nav Upgrade

**Files:**
- Modify: `src/components/MobileBottomNav.vue`

**Changes:**
- Add order count badge on "Meus Pedidos" (fetched via prop or event)
- Increase touch target to 48px minimum height
- Filled icons when active (`bi-list-task` → `bi-list-task-fill` when active, etc.)
- Subtle scale animation on tap
- Safe area padding for notched phones (`env(safe-area-inset-bottom)`)

---

### Task 4: Pull-to-Refresh + Skeleton Loading

**Files:**
- Create: `src/components/rider/PullToRefresh.vue`
- Create: `src/components/rider/SkeletonCard.vue`
- Modify: `src/views/RiderOrders.vue` — wrap list in PullToRefresh, show SkeletonCard while loading

**PullToRefresh:** touch-based pull down gesture with spinner indicator, emits `@refresh`
**SkeletonCard:** animated placeholder matching order card shape (3 skeleton cards shown during load)

---

### Task 5: Focus Mode — Active Delivery Screen

**Files:**
- Create: `src/components/rider/ActiveDeliveryFocus.vue`
- Modify: `src/views/RiderOrders.vue` — show focus mode when there's a SAIU_PARA_ENTREGA order

**Design:**
- Full-screen overlay when rider has active delivery
- Top half: Leaflet map with delivery pin
- Bottom half: large address text, customer name/phone
- Two huge buttons: "Avisar Chegada" (outline) + "Entregue" (solid green)
- Swipe down or X to dismiss and see full order list
- Auto-opens when order transitions to SAIU_PARA_ENTREGA

---

### Task 6: Bottom Sheets

**Files:**
- Create: `src/components/rider/BottomSheet.vue`
- Modify: `src/views/RiderOrders.vue` — use BottomSheet for order details
- Modify: `src/views/RiderQrCode.vue` — scanner opens as bottom sheet

**BottomSheet component:**
- Slides up from bottom with drag handle
- Snap points: 40%, 90%, closed
- Touch drag to resize/dismiss
- Backdrop overlay with tap-to-close
- Slot-based content

---

### Task 7: Rider Theme (Colors, Fonts, Dark Mode)

**Files:**
- Create: `src/assets/rider-theme.css`
- Modify: `src/App.vue` — import rider-theme.css, add `.rider-app` class to wrapper on rider routes

**Theme variables:**
```css
.rider-app {
  --rider-primary: #198754;
  --rider-bg: #f0f2f5;
  --rider-card: #ffffff;
  --rider-text: #1a1a1a;
  --rider-text-secondary: #6c757d;
  --rider-font-base: 0.9375rem;   /* 15px - bigger than 14px default */
  --rider-radius: 16px;
}
.rider-app.dark {
  --rider-bg: #121212;
  --rider-card: #1e1e1e;
  --rider-text: #e0e0e0;
  --rider-text-secondary: #9e9e9e;
}
```

**Dark mode:** auto-detect via `prefers-color-scheme: dark` media query, toggleable in account

---

### Task 8: Embedded Mini-Map

**Files:**
- Create: `src/components/rider/MiniMap.vue`
- Modify: `src/views/RiderOrders.vue` — add MiniMap inside each order card with address

**MiniMap:**
- Leaflet map, 120px height, rounded corners
- Single marker at delivery address (geocoded from lat/lng in order payload)
- Tap opens Google Maps / Waze intent
- Only renders when lat/lng coordinates available
- Lazy-load Leaflet (dynamic import)

---

### Task 9: Swipe Navigation

**Files:**
- Create: `src/components/rider/SwipeableViews.vue`
- Modify: `src/views/rider/Orders.vue`, `Dashboard.vue`, `Ranking.vue` — wrap in SwipeableViews

**SwipeableViews:**
- Horizontal swipe between main rider screens (Orders ↔ Dashboard ↔ Ranking)
- Indicator dots or tab bar synced with bottom nav
- Touch gesture with momentum/snap
- Router push on swipe complete
- Respects vertical scroll (only triggers on dominant horizontal swipe)
