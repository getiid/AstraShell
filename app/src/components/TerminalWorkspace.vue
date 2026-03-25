<script setup lang="ts">
const { vm } = defineProps<{ vm: any }>()
</script>

<template>
  <div>
    <div class="top-actions terminal-top-actions" v-if="vm.focusTerminal.value">
      <div class="terminal-mode-line">
        <span class="status-pill mode">{{ vm.terminalModeLabel.value }}</span>
        <span class="status-pill plain">{{ vm.terminalTargetLabel.value }}</span>
      </div>
      <div v-if="vm.activeTerminalMode.value === 'ssh'" class="terminal-tabs">
        <div
          v-for="tab in vm.sshTabs.value"
          :key="tab.id"
          class="terminal-tab"
          :class="{ active: vm.sshSessionId.value === tab.id }"
          @click="vm.switchSshTab(tab.id)"
        >
          <span class="terminal-tab-name">{{ tab.name }}</span>
          <span class="status-dot" :class="tab.connected ? 'online' : 'offline'"></span>
          <button class="terminal-tab-close" title="关闭并断开" @click.stop="vm.closeSshTab(tab.id)">×</button>
        </div>
        <button class="ghost small" @click="vm.createSshTab">+ 新标签</button>
      </div>
      <div v-else-if="vm.activeTerminalMode.value === 'local'" class="terminal-tabs">
        <div
          v-for="tab in vm.localTabs.value"
          :key="tab.id"
          class="terminal-tab"
          :class="{ active: vm.activeLocalTabId.value === tab.id }"
          @click="vm.switchLocalTab(tab.id)"
        >
          <span class="terminal-tab-name">{{ tab.name }}</span>
          <span class="status-dot" :class="tab.connected ? 'online' : 'offline'"></span>
          <button class="terminal-tab-close" title="关闭本地标签" @click.stop="vm.closeLocalTab(tab.id)">×</button>
        </div>
        <button class="ghost small" @click="vm.connectLocalTerminal">+ 本地标签</button>
      </div>
      <div v-if="vm.activeTerminalMode.value !== 'serial'" class="terminal-actions-row">
        <div class="terminal-tools-left">
          <button class="ghost" @click="vm.exitTerminalView">返回模块视图</button>
          <button class="ghost" @click="vm.selectAllTerminal">全选</button>
          <button class="ghost" @click="vm.copyTerminalSelection">复制选中</button>
          <button class="ghost" @click="vm.pasteToTerminal">粘贴</button>
          <button v-if="vm.activeTerminalMode.value === 'local'" class="danger" @click="vm.disconnectLocalTerminal">断开本地</button>
        </div>
        <div class="terminal-tools-right">
          <select v-model="vm.terminalEncoding.value" class="encoding-select" title="终端解码">
            <option value="utf-8">终端编码：UTF-8</option>
            <option value="gb18030">终端编码：GBK/GB18030</option>
          </select>
          <select v-model="vm.terminalSnippetId.value">
            <option value="">选择代码片段</option>
            <option v-for="item in vm.terminalSnippetItems.value" :key="item.id" :value="item.id">
              {{ item.name }} · {{ item.category }}
            </option>
          </select>
          <button class="muted" :disabled="vm.snippetRunning.value" @click="vm.runTerminalSnippet">执行片段</button>
          <button class="ghost" @click="vm.sendSnippetRawToTerminal">发送原文</button>
          <button class="ghost" @click="vm.openSnippetsPanel">打开片段</button>
        </div>
      </div>
      <div v-else class="serial-live-toolbar">
        <div class="terminal-tools-left">
          <button class="ghost" @click="vm.exitTerminalView">返回串口面板</button>
          <button class="ghost" @click="vm.copyTerminalSelection">复制选中</button>
          <button class="ghost" @click="vm.pasteToTerminal">粘贴</button>
          <button class="danger" @click="vm.closeSerial">断开串口</button>
        </div>
        <div class="terminal-tools-right">
          <select v-model="vm.terminalSnippetId.value">
            <option value="">选择代码片段</option>
            <option v-for="item in vm.terminalSnippetItems.value" :key="item.id" :value="item.id">
              {{ item.name }} · {{ item.category }}
            </option>
          </select>
          <button class="muted" :disabled="vm.snippetRunning.value" @click="vm.runTerminalSnippet">执行片段</button>
        </div>
      </div>
    </div>

    <div v-else-if="vm.sshTabs.value.length > 0 && vm.activeTerminalMode.value === 'ssh'" class="session-strip">
      <div class="session-strip-title">活动 SSH 会话</div>
      <div class="terminal-tabs session-strip-tabs">
        <div
          v-for="tab in vm.sshTabs.value"
          :key="tab.id"
          class="terminal-tab"
          :class="{ active: vm.sshSessionId.value === tab.id }"
          @click="vm.focusSshSession(tab.id)"
        >
          <span class="terminal-tab-name">{{ tab.name }}</span>
          <span class="status-dot" :class="tab.connected ? 'online' : 'offline'"></span>
          <button class="terminal-tab-close" title="关闭并断开" @click.stop="vm.closeSshTab(tab.id)">×</button>
        </div>
        <button class="ghost small" @click="vm.createAndFocusSshTab">+ 新标签</button>
      </div>
    </div>

    <section
      v-show="vm.focusTerminal.value"
      class="terminal-wrap"
      :class="{ focus: vm.focusTerminal.value, 'serial-live-shell': vm.activeTerminalMode.value === 'serial' }"
    >
      <div class="terminal-core">
        <div :ref="vm.bindTermEl" class="terminal" @contextmenu.prevent="vm.openTerminalContextMenu"></div>
      </div>
      <aside v-if="vm.activeTerminalMode.value === 'serial'" class="serial-snippet-rail">
        <div class="serial-rail-head">
          <button class="ghost small" @click="vm.openSnippetsPanel">打开片段库</button>
        </div>
        <div class="serial-rail-search">
          <input v-model="vm.snippetKeyword.value" placeholder="搜索片段" />
        </div>
        <div class="serial-rail-list">
          <article
            v-for="item in vm.terminalSnippetItems.value.slice(0, 16)"
            :key="`serial-rail-${item.id}`"
            class="serial-rail-item"
            @click="vm.terminalSnippetId.value = item.id"
          >
            <header>
              <span>{{ item.name }}</span>
              <small>{{ vm.snippetCommandLines(item.commands).length }} 条</small>
            </header>
            <pre>{{ vm.snippetCommandLines(item.commands).slice(0, 2).join(' ; ') }}</pre>
          </article>
        </div>
      </aside>
    </section>
  </div>
</template>
