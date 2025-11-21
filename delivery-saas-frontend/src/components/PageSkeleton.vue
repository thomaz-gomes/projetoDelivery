<template>
  <div class="p-4">
    <div class="mb-3">
      <div class="skeleton-title"></div>
    </div>
    <div class="row">
      <div class="col-8">
        <div class="skeleton-line mb-2" style="width:70%"></div>
        <div class="skeleton-line mb-2" style="width:50%"></div>
        <div class="skeleton-line mb-2" style="width:90%"></div>
      </div>
      <div class="col-4">
        <div class="skeleton-box"></div>
      </div>
    </div>
    <div class="mt-4">
      <div class="skeleton-row" v-for="i in 4" :key="i">
        <div class="skeleton-line" style="width:30%"></div>
        <div class="skeleton-line" style="width:60%"></div>
      </div>
    </div>
  </div>
</template>

<script setup>
// purely presentational
</script>

<style scoped>
.skeleton-title{height:26px;background:#e9ecef;border-radius:6px}
.skeleton-line{height:14px;background:#f1f3f5;border-radius:4px;margin-bottom:8px}
.skeleton-box{height:80px;background:#f1f3f5;border-radius:6px}
.skeleton-row{display:flex;gap:12px;align-items:center;margin-bottom:12px}
</style>
