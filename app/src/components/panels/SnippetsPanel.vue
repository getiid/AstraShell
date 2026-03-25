<script setup lang="ts">
import { Pencil } from 'lucide-vue-next'

const { vm } = defineProps<{ vm: any }>()
</script>

<template>
  <section class="panel snippets-panel">
    <div class="snippets-header">
      <div>
        <h3>代码片段</h3>
        <p class="hosts-header-sub">保存常用脚本，连接服务器后一键逐条执行</p>
      </div>
      <div class="snippets-run-settings">
        <label>执行间隔(ms)</label>
        <input v-model.number="vm.snippetRunDelayMs.value" type="number" min="200" step="100" />
      </div>
    </div>

    <div class="snippets-layout">
      <div class="snippets-left">
        <div class="hosts-left-title">
          <span>分类</span>
          <button class="ghost tiny" @click="vm.beginAddSnippetCategory">+ 新建</button>
        </div>
        <div v-if="vm.newSnippetCategoryInputVisible.value" class="cat-item input-item">
          <input
            v-model="vm.newSnippetCategoryName.value"
            placeholder="输入分类名后回车"
            @keyup.enter="vm.addSnippetCategory"
            @blur="vm.addSnippetCategory"
          />
        </div>
        <div
          v-for="c in vm.displaySnippetCategories.value"
          :key="c"
          class="cat-item"
          :class="{ activeCat: vm.snippetCategory.value === c }"
        >
          <button class="cat-name" @click="vm.snippetCategory.value = c">{{ c }}</button>
        </div>
      </div>

      <div class="snippets-center">
        <div class="snippets-toolbar">
          <input v-model="vm.snippetKeyword.value" placeholder="搜索片段名称/说明/命令" />
          <button class="ghost small" @click="vm.clearSnippetEditor">新建片段</button>
          <span class="hosts-stat">共 {{ vm.filteredSnippetItems.value.length }} 条</span>
        </div>

        <div class="snippet-grid">
          <article
            v-for="item in vm.filteredSnippetItems.value"
            :key="item.id"
            class="snippet-card"
            :class="{ activeSnippet: vm.selectedSnippetId.value === item.id }"
            @click="vm.openSnippetEditor(item)"
          >
            <div class="snippet-card-head">
              <div class="snippet-card-title">{{ item.name }}</div>
              <span class="pill">{{ item.category }}</span>
            </div>
            <div class="snippet-card-desc">{{ item.description || '无说明' }}</div>
            <div class="snippet-card-host">{{ vm.snippetHostLabel(item.hostId) }}</div>
            <div class="snippet-card-foot">
              <span>{{ vm.snippetCommandLines(item.commands).length }} 条命令</span>
              <button class="snippet-run-btn" :disabled="vm.snippetRunning.value" @click.stop="vm.runSnippet(item)">执行</button>
            </div>
          </article>
          <div v-if="vm.filteredSnippetItems.value.length === 0" class="file-row empty">暂无代码片段</div>
        </div>
      </div>

      <div class="snippets-editor-column" :class="{ visible: vm.snippetEditorVisible.value }">
        <div class="snippets-editor-panel">
          <div class="editor-title">
            <Pencil :size="14" /> 片段编辑
            <button class="ghost small" @click="vm.clearSnippetEditor">清空</button>
          </div>
          <div class="vault-form-grid snippet-form-grid">
            <input v-model="vm.snippetEdit.value.name" placeholder="片段名称（如：部署 Docker）" />
            <select v-model="vm.snippetEdit.value.category">
              <option v-for="c in vm.snippetCategories.value" :key="c" :value="c">{{ c }}</option>
            </select>
            <select v-model="vm.snippetEdit.value.hostId">
              <option value="">使用当前 SSH 会话</option>
              <option v-for="h in vm.hostItems.value" :key="h.id" :value="h.id">{{ h.name }} ({{ h.host }})</option>
            </select>
            <input v-model="vm.snippetEdit.value.description" class="snippet-desc-input" placeholder="用途说明（可选）" />
            <textarea
              v-model="vm.snippetEdit.value.commands"
              class="snippet-command-input"
              placeholder="每行一条命令。以 # 开头会视为注释并跳过。"
              @contextmenu.prevent="vm.openEditorContextMenu"
            ></textarea>
            <p class="hint">点击执行后会按行自动发送到 SSH 终端，并自动回车执行。</p>
            <div class="snippet-actions">
              <button class="snippet-btn ghost" @click="vm.deleteSnippet">删除</button>
              <button class="snippet-btn primary" :disabled="vm.snippetRunning.value" @click="vm.runSnippet()">执行片段</button>
              <button class="snippet-btn danger" :disabled="!vm.snippetRunning.value" @click="vm.stopSnippet">停止</button>
              <button class="snippet-btn success" @click="vm.saveSnippet">保存片段</button>
            </div>
          </div>
          <p class="vault-status">{{ vm.snippetStatus.value || '就绪' }}</p>
        </div>
      </div>
    </div>
  </section>
</template>
