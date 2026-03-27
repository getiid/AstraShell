<script setup lang="ts">
import { Plus } from 'lucide-vue-next'

defineProps<{
  vm: any
  secondaryCategories: string[]
  countByCategory: (category: string) => number
  openHostCategoryMenu: (event: MouseEvent, category: string) => void
}>()
</script>

<template>
  <aside class="hosts-left">
    <div class="hosts-left-title">
      <span>分类导航</span>
      <button class="ghost tiny hosts-left-create" @click="vm.beginAddCategory">
        <Plus :size="12" /> 新建
      </button>
    </div>
    <p class="hosts-categories-caption">先按分类收缩范围，再在中间批量筛选和连接。</p>
    <div v-if="vm.newCategoryInputVisible.value" class="cat-item input-item">
      <input
        v-model="vm.newCategoryName.value"
        placeholder="输入分类名后回车"
        @keyup.enter="vm.addCategory"
        @blur="vm.addCategory"
      />
    </div>
    <div class="hosts-category-topline">
      <div
        class="cat-item compact"
        :class="{ activeCat: vm.selectedCategory.value === vm.allCategory }"
      >
        <button class="cat-name" @click="vm.selectedCategory.value = vm.allCategory">
          <span class="cat-name-main">{{ vm.allCategory }}</span>
          <span class="cat-count">{{ countByCategory(vm.allCategory) }}</span>
        </button>
      </div>
      <div
        class="cat-item compact"
        :class="{ activeCat: vm.selectedCategory.value === vm.defaultCategory }"
      >
        <button class="cat-name" @click="vm.selectedCategory.value = vm.defaultCategory">
          <span class="cat-name-main">{{ vm.defaultCategory }}</span>
          <span class="cat-count">{{ countByCategory(vm.defaultCategory) }}</span>
        </button>
      </div>
    </div>
    <div class="hosts-category-list">
      <div
        v-for="c in secondaryCategories"
        :key="c"
        class="cat-item"
        :class="{ activeCat: vm.selectedCategory.value === c }"
        @contextmenu="openHostCategoryMenu($event, c)"
      >
        <template v-if="vm.editingCategory.value === c">
          <input
            v-model="vm.editingCategoryName.value"
            class="cat-inline-input"
            placeholder="输入新的分类名"
            @click.stop
            @keyup.enter="vm.renameCategoryInline()"
            @keyup.esc="vm.cancelRenameCategory"
            @blur="vm.renameCategoryInline()"
          />
        </template>
        <template v-else>
          <button class="cat-name" @click="vm.selectedCategory.value = c">
            <span class="cat-name-main">{{ c }}</span>
            <span class="cat-count">{{ countByCategory(c) }}</span>
          </button>
        </template>
      </div>
    </div>
  </aside>
</template>
