<script setup lang="ts">
const { vm } = defineProps<{ vm: any }>()
</script>

<template>
  <footer class="status-bar fixed-bottom">
    <div class="status-left">状态：{{ vm.statusText.value }}</div>
    <div class="status-right">
      <span>↑ {{ vm.sftpUploadProgress.value }}%</span>
      <div class="mini-bar"><div class="mini-fill" :style="{ width: `${vm.sftpUploadProgress.value}%` }"></div></div>
      <span>↓ {{ vm.sftpDownloadProgress.value }}%</span>
      <div class="mini-bar"><div class="mini-fill down" :style="{ width: `${vm.sftpDownloadProgress.value}%` }"></div></div>
    </div>
  </footer>
</template>
