<template>
  <div class="skeleton-card">
    <div class="skeleton-header">
      <div class="skeleton skeleton-line" style="width:60px;height:18px"></div>
      <div class="skeleton skeleton-line" style="width:80px;height:22px;border-radius:12px"></div>
    </div>
    <div class="skeleton-body">
      <div class="skeleton skeleton-line" style="width:70%;height:14px"></div>
      <div class="skeleton skeleton-line" style="width:100%;height:14px;margin-top:8px"></div>
      <div class="skeleton skeleton-line" style="width:45%;height:14px;margin-top:8px"></div>
    </div>
  </div>
</template>

<style scoped>
.skeleton-card {
  background: var(--rider-card, #fff);
  border-radius: var(--rider-radius, 16px);
  padding: 16px;
  box-shadow: var(--rider-shadow, 0 2px 8px rgba(0,0,0,0.08));
  margin-bottom: 12px;
}
.skeleton-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.skeleton-body { display: flex; flex-direction: column; }
.skeleton-line { border-radius: 6px; }
.skeleton {
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
