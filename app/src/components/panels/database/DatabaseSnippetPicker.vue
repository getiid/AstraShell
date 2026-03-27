<script setup lang="ts">
defineProps<{
  vm: any
  snippetMenuOpen: boolean
  toggleSnippetMenu: () => void
  insertSnippet: (id: string) => void
}>()
</script>

<template>
  <div class="database-snippet-picker">
    <button class="ghost tiny" @click.stop="toggleSnippetMenu">代码片段</button>
    <div v-if="snippetMenuOpen" class="database-snippet-menu" @click.stop>
      <button
        v-for="item in vm.databaseSnippetItems.value"
        :key="item.id"
        class="database-snippet-item"
        @click.stop="insertSnippet(item.id)"
      >
        <strong>{{ item.name }}</strong>
        <span>{{ item.commands.split('\n')[0] }}</span>
      </button>
      <div v-if="vm.databaseSnippetItems.value.length === 0" class="database-snippet-empty">暂无数据库代码片段</div>
    </div>
  </div>
</template>
