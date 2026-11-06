<script setup lang="ts">
import { reactive } from 'vue'

const versions = reactive({ ...window.electron.process.versions })
</script>

<template>
  <ul class="versions">
    <li class="version-item">
      <span>Electron</span>
      <strong>v{{ versions.electron }}</strong>
    </li>
    <li class="version-item">
      <span>Chromium</span>
      <strong>v{{ versions.chrome }}</strong>
    </li>
    <li class="version-item">
      <span>Node.js</span>
      <strong>v{{ versions.node }}</strong>
    </li>
  </ul>
</template>

<style scoped>
.versions {
  display: flex;
  flex-direction: column;
}

.version-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px solid var(--color-border);
  font-size: 13px;
  color: var(--color-text-2);
}

.version-item:last-child {
  border-bottom: none;
}

.version-item strong {
  font-weight: 500;
  color: var(--color-text-1);
  font-variant-numeric: tabular-nums;
}
</style>
