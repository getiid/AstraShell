<script setup lang="ts">
import { Pencil } from 'lucide-vue-next'

const { vm } = defineProps<{ vm: any }>()
</script>

<template>
  <section class="panel local-panel">
    <div class="serial-head">
      <div>
        <h3>本地终端</h3>
        <p class="hosts-header-sub">科技风终端皮肤，支持中文显示、快捷工具、代码片段复用</p>
      </div>
      <div class="serial-head-actions">
        <button class="ghost" @click="vm.connectLocalTerminal">+ 新本地标签</button>
        <button class="muted" :disabled="!vm.localConnected.value" @click="vm.disconnectLocalTerminal">关闭当前标签</button>
      </div>
    </div>
    <div v-if="vm.localTabs.value.length > 0" class="terminal-tabs local-tabs">
      <div
        v-for="tab in vm.localTabs.value"
        :key="tab.id"
        class="terminal-tab"
        :class="{ active: vm.activeLocalTabId.value === tab.id }"
        @click="vm.focusTerminal.value = true; vm.switchLocalTab(tab.id)"
      >
        <span class="terminal-tab-name">{{ tab.name }}</span>
        <span class="status-dot" :class="tab.connected ? 'online' : 'offline'"></span>
        <button class="terminal-tab-close" title="关闭本地标签" @click.stop="vm.closeLocalTab(tab.id)">×</button>
      </div>
    </div>
    <div class="grid local-shell-grid">
      <select v-model="vm.localShellType.value">
        <option value="auto">终端类型：自动</option>
        <option value="cmd">终端类型：CMD</option>
        <option value="powershell">终端类型：PowerShell</option>
      </select>
      <label
        v-if="vm.isWindowsClient.value"
        class="serial-inline-check"
        title="勾选后连接时将触发 UAC，在 AstraShell 内桥接管理员终端"
      >
        <input v-model="vm.localElevated.value" type="checkbox" /> 管理员模式（触发 UAC 后桥接到本体）
      </label>
    </div>
    <div class="local-status">{{ vm.localStatus.value }}</div>
    <div class="local-tools-card">
      <div class="hosts-left-title">
        <span>快捷工具（可自定义）</span>
        <span class="hosts-stat">点击后自动跳到终端查看结果</span>
      </div>

      <div class="local-quick-toolbar">
        <select v-model="vm.localQuickCategory.value" class="file-sort">
          <option v-for="cat in vm.localQuickCategories.value" :key="cat" :value="cat">{{ cat }}</option>
        </select>
        <div class="serial-head-actions">
          <button class="ghost tiny" @click="vm.openLocalQuickCreate">新建指令</button>
        </div>
      </div>

      <div class="local-quick-layout" :class="{ 'editor-open': vm.localQuickEditorVisible.value }">
        <div class="local-tool-grid">
          <div v-for="item in vm.filteredLocalQuickItems.value" :key="item.id" class="local-tool-item">
            <button class="ghost" @click="vm.runLocalQuickCommand(item.cmd)">{{ item.label }}</button>
            <div class="local-tool-meta">
              <span class="pill ghost">{{ item.category }}</span>
              <button class="ghost tiny" @click="vm.startEditLocalQuickItem(item)">编辑</button>
              <button class="danger tiny" @click="vm.removeLocalQuickItem(item.id)">删除</button>
            </div>
          </div>
          <div v-if="vm.filteredLocalQuickItems.value.length === 0" class="file-row empty">当前分类暂无快捷指令</div>
        </div>

        <div class="local-quick-editor-column" :class="{ visible: vm.localQuickEditorVisible.value }">
          <div class="local-quick-editor-panel">
            <div class="editor-title">
              <Pencil :size="14" /> 快捷工具编辑
              <button class="ghost small" @click="vm.closeLocalQuickEditor">收起</button>
            </div>
            <div class="local-quick-editor">
              <input v-model="vm.localQuickDraftCategory.value" placeholder="分类（例如：系统/网络/部署）" />
              <input v-model="vm.localQuickDraftLabel.value" placeholder="指令名称（例如：查看端口）" />
              <input v-model="vm.localQuickDraftCmd.value" placeholder="命令（例如：lsof -iTCP -sTCP:LISTEN -n -P）" />
              <div class="local-quick-editor-actions">
                <button class="muted" @click="vm.saveLocalQuickDraft">{{ vm.localQuickEditId.value ? '保存修改' : '添加指令' }}</button>
                <button class="ghost" @click="vm.resetLocalQuickDraft">清空</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
