<script setup lang="ts">
import { computed } from 'vue'
import AdminPage from './pages/AdminPage.vue'
import DashboardPage from './pages/DashboardPage.vue'
import { ADMIN_ROUTE, useHashRoute } from './composables/useHashRoute'

const hash = useHashRoute()
const isAdminRoute = computed(() => hash.value === ADMIN_ROUTE)
</script>

<template>
  <AdminPage v-if="isAdminRoute" />
  <DashboardPage v-else />
</template>
