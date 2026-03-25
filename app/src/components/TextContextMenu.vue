<script setup lang="ts">
const { vm } = defineProps<{ vm: any }>()
</script>

<template>
  <div
    v-if="vm.textMenu.value.visible"
    class="context-menu"
    :style="{ left: `${vm.textMenu.value.x}px`, top: `${vm.textMenu.value.y}px` }"
  >
    <button v-if="vm.textMenu.value.mode === 'editor'" class="menu-item" @click="vm.cutFromTextMenu">剪切</button>
    <button class="menu-item" @click="vm.copyFromTextMenu">复制</button>
    <button class="menu-item" @click="vm.pasteFromTextMenu">粘贴</button>
    <button class="menu-item" @click="vm.selectAllFromTextMenu">全选</button>
  </div>
</template>
