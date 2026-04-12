<script setup>
import RiderAccountRider from '../RiderAccountRider.vue';
import RiderHeader from '../../components/rider/RiderHeader.vue';
import MobileBottomNav from '../../components/MobileBottomNav.vue';
import SwipeableViews from '../../components/rider/SwipeableViews.vue';
</script>

<template>
  <RiderHeader />
  <SwipeableViews>
    <div style="padding-top: calc(var(--rider-header-height, 56px) + 12px)">
      <RiderAccountRider />
    </div>
  </SwipeableViews>
  <MobileBottomNav />
</template>

<style scoped></style>
