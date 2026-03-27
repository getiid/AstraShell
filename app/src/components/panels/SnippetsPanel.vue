<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, type ComponentPublicInstance } from 'vue'
import { Pencil, Bell, Save, Trash2, Play, Server, FileTerminal } from 'lucide-vue-next'
import { useSnippetCommandCompletion } from '../../composables/useSnippetCommandCompletion'

const { vm } = defineProps<{ vm: any }>()

const snippetCommandsModel = computed({
  get: () => String(vm.snippetEdit.value.commands || ''),
  set: (value: string) => {
    vm.snippetEdit.value.commands = value
  },
})

const snippetItemsModel = computed(() => vm.snippetItems?.value || [])
const hostItemsModel = computed(() => vm.hostItems?.value || [])
const selectedHostIdModel = computed(() => String(vm.snippetEdit.value.hostId || ''))

const {
  commandInputEl,
  completionItems,
  completionVisible,
  activeCompletionIndex,
  refreshCompletions,
  applyCompletion,
  handleCommandEditorKeydown,
  handleCommandEditorInput,
  handleCommandEditorBlur,
} = useSnippetCommandCompletion({
  model: snippetCommandsModel,
  snippetItems: snippetItemsModel,
  hostItems: hostItemsModel,
  selectedHostId: selectedHostIdModel,
})

const bindCommandInputEl = (el: Element | ComponentPublicInstance | null) => {
  commandInputEl.value = el instanceof HTMLTextAreaElement ? el : null
}

const snippetCategoryMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  category: '',
})

const closeSnippetCategoryMenu = () => {
  snippetCategoryMenu.value.visible = false
}

const openSnippetCategoryMenu = (event: MouseEvent, category: string) => {
  if (!category || category === '全部' || category === '部署') return
  event.preventDefault()
  snippetCategoryMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    category,
  }
}

const renameSnippetCategoryFromMenu = () => {
  const category = snippetCategoryMenu.value.category
  closeSnippetCategoryMenu()
  vm.beginRenameSnippetCategory(category)
}

const deleteSnippetCategoryFromMenu = () => {
  const category = snippetCategoryMenu.value.category
  closeSnippetCategoryMenu()
  vm.deleteSnippetCategory(category)
}

onMounted(() => {
  window.addEventListener('click', closeSnippetCategoryMenu)
  window.addEventListener('resize', closeSnippetCategoryMenu)
  window.addEventListener('scroll', closeSnippetCategoryMenu, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('click', closeSnippetCategoryMenu)
  window.removeEventListener('resize', closeSnippetCategoryMenu)
  window.removeEventListener('scroll', closeSnippetCategoryMenu, true)
})
</script>

<template>
  <section class="panel snippets-panel">
    <div class="snippets-header">
      <div>
        <h3>代码片段</h3>
        <p class="hosts-header-sub">管理脚本动作、绑定服务器，手动执行并设置提醒日期。</p>
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
          @contextmenu="openSnippetCategoryMenu($event, c)"
        >
          <template v-if="vm.editingSnippetCategory.value === c">
            <input
              v-model="vm.editingSnippetCategoryName.value"
              class="cat-inline-input"
              placeholder="输入新的分类名"
              @click.stop
              @keyup.enter="vm.renameSnippetCategory()"
              @keyup.esc="vm.cancelRenameSnippetCategory"
              @blur="vm.renameSnippetCategory()"
            />
          </template>
          <template v-else>
            <button class="cat-name" @click="vm.snippetCategory.value = c">
              <span class="cat-name-main">{{ c }}</span>
            </button>
          </template>
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
            <div class="snippet-card-host">分配服务器：{{ vm.snippetHostLabel(item.hostId) }}</div>
            <div class="snippet-card-bottom">
              <span class="snippet-card-count">命令数：{{ vm.snippetCommandLines(item.commands).length }} 条</span>
              <span class="snippet-mini-pill snippet-list-status" :class="vm.snippetLastRunTone(item)">
                执行状态：{{ vm.snippetListRunLabel(item) }}
              </span>
              <button class="snippet-run-btn" :disabled="vm.snippetRunning.value || item.lastRunStatus === 'running'" @click.stop="vm.executeSnippetTask(item)">
                {{ item.lastRunStatus === 'running' ? '执行中…' : '执行' }}
              </button>
            </div>
          </article>
          <div v-if="vm.filteredSnippetItems.value.length === 0" class="file-row empty">暂无代码片段</div>
        </div>
      </div>

      <div class="snippets-editor-column" :class="{ visible: vm.snippetEditorVisible.value }">
        <div class="snippets-editor-panel">
            <div class="editor-title snippets-editor-title">
              <div class="editor-title-main">
                <Pencil :size="15" />
                <div>
                  <strong>{{ vm.snippetEdit.value.id ? '片段配置' : '新建片段' }}</strong>
                  <small>右侧只负责配置、绑定服务器、提醒日期和查看结果。</small>
                </div>
              </div>
              <button class="ghost small" @click="vm.clearSnippetEditor">清空</button>
          </div>
          <div class="snippet-editor-scroll">
            <section class="snippet-block">
              <div class="snippet-block-head">
                <FileTerminal :size="14" />
                <span>基础信息</span>
              </div>
              <div class="snippet-form-grid">
                <input v-model="vm.snippetEdit.value.name" placeholder="片段名称（如：重启 Docker 服务）" />
                <select v-model="vm.snippetEdit.value.category">
                  <option v-for="c in vm.snippetCategories.value" :key="c" :value="c">{{ c }}</option>
                </select>
                <select v-model="vm.snippetEdit.value.hostId">
                  <option value="">选择目标服务器（可选）</option>
                  <option v-for="h in vm.hostItems.value" :key="h.id" :value="h.id">{{ h.name }} ({{ h.host }})</option>
                </select>
                <input v-model="vm.snippetEdit.value.description" class="snippet-desc-input" placeholder="用途说明（可选）" />
              </div>
            </section>

            <section class="snippet-block">
              <div class="snippet-block-head">
                <Bell :size="14" />
                <span>提醒</span>
              </div>
              <div class="snippet-reminder-grid">
                <label class="snippet-date-field">
                  <span>提醒日期</span>
                  <input v-model="vm.snippetEdit.value.reminderDate" type="date" />
                </label>
              </div>
              <p class="hint">设置提醒日期后，会在前 15 天开始倒计时，逻辑和服务器到期预警一致。</p>
            </section>

            <section class="snippet-block">
              <div class="snippet-block-head">
                <Server :size="14" />
                <span>脚本内容</span>
              </div>
              <div class="snippet-code-meta">
                <span>{{ vm.snippetLineCount(vm.snippetEdit.value.commands) }} 行</span>
                <span>{{ vm.snippetCommandLines(vm.snippetEdit.value.commands).length }} 条有效命令</span>
                <span>Tab 采纳补全，↑↓ 切换候选，Esc 关闭</span>
              </div>
              <div v-if="completionVisible" class="snippet-completion-panel">
                <div class="snippet-completion-head">智能补全</div>
                <button
                  v-for="(item, index) in completionItems"
                  :key="item.key"
                  class="snippet-completion-item"
                  :class="{ active: activeCompletionIndex === index }"
                  @mousedown.prevent="applyCompletion(item)"
                >
                  <span class="snippet-completion-main">
                    <strong>{{ item.label }}</strong>
                    <small>{{ item.detail }}</small>
                  </span>
                  <span class="snippet-completion-source">{{ item.source }}</span>
                </button>
              </div>
              <textarea
                :ref="bindCommandInputEl"
                v-model="vm.snippetEdit.value.commands"
                class="snippet-command-input"
                placeholder="每行一条命令。以 # 开头会视为注释并跳过。"
                spellcheck="false"
                wrap="off"
                @input="handleCommandEditorInput"
                @keydown="handleCommandEditorKeydown"
                @click="refreshCompletions"
                @focus="refreshCompletions"
                @blur="handleCommandEditorBlur"
                @contextmenu.prevent="vm.openEditorContextMenu"
              ></textarea>
            </section>

            <section class="snippet-block result-block">
              <div class="snippet-block-head">
                <Play :size="14" />
                <span>最近结果</span>
              </div>
              <div class="snippet-result-meta">
                <span v-if="vm.snippetEdit.value.reminderDate" class="snippet-mini-pill" :class="vm.snippetReminderTone(vm.snippetEdit.value)">
                  {{ vm.snippetReminderLabel(vm.snippetEdit.value) }}
                </span>
                <span class="snippet-mini-pill" :class="vm.snippetLastRunTone(vm.snippetEdit.value)">
                  {{ vm.snippetLastRunLabel(vm.snippetEdit.value) }}
                </span>
                <span class="snippet-result-host">{{ vm.snippetHostLabel(vm.snippetEdit.value.hostId) }}</span>
              </div>
              <pre class="snippet-result-output">{{ vm.snippetEdit.value.lastRunOutput || '暂时还没有执行结果。手动执行后，结果会显示在这里。' }}</pre>
            </section>
          </div>
          <div class="snippet-actions">
            <button class="snippet-btn ghost" @click="vm.deleteSnippet">
              <Trash2 :size="14" />
              删除
            </button>
            <button class="snippet-btn success" @click="vm.saveSnippet">
              <Save :size="14" />
              保存
            </button>
          </div>
          <p class="vault-status">{{ vm.snippetStatus.value || '就绪' }}</p>
        </div>
      </div>
    </div>
    <div
      v-if="snippetCategoryMenu.visible"
      class="context-menu"
      :style="{ left: `${snippetCategoryMenu.x}px`, top: `${snippetCategoryMenu.y}px` }"
      @click.stop
    >
      <button class="menu-item" @click="renameSnippetCategoryFromMenu">重命名</button>
      <button class="menu-item danger" @click="deleteSnippetCategoryFromMenu">删除</button>
    </div>
  </section>
</template>
