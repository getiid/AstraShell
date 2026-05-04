<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Clock3,
  Cpu,
  Folder,
  FolderClosed,
  HardDrive,
  House,
  Menu,
  MonitorSmartphone,
  Plus,
  PlugZap,
  Server,
  SquareTerminal,
  TerminalSquare,
  User,
  X,
} from 'lucide-vue-next'

const { vm } = defineProps<{ vm: any }>()

const toolsDrawerOpen = ref(false)
const showHomeTabs = computed(() => vm.nav?.value === 'hosts' && !vm.focusTerminal.value)
const showTopTabs = computed(() => vm.focusTerminal.value || showHomeTabs.value)

const closeToolsDrawer = () => {
  toolsDrawerOpen.value = false
}

const toggleToolsDrawer = () => {
  toolsDrawerOpen.value = !toolsDrawerOpen.value
}

watch(() => vm.focusTerminal.value, (visible: boolean) => {
  if (!visible) closeToolsDrawer()
})

watch(() => vm.activeTerminalMode.value, () => {
  closeToolsDrawer()
})

const factIcons: Record<string, any> = {
  server: Server,
  user: User,
  plug: PlugZap,
  folder: Folder,
  monitor: MonitorSmartphone,
  cpu: Cpu,
  terminal: TerminalSquare,
  clock3: Clock3,
}

const handleMetricChipClick = async (item: { action?: string }) => {
  const result = await vm.runSshMetricAction?.(item?.action || '')
  if (result?.type === 'command' && result.command) {
    await vm.sendTerminalCommand?.(result.command)
  }
}
</script>

<template>
  <div class="terminal-workspace" :class="{ active: vm.focusTerminal.value }">
    <div class="top-actions terminal-top-actions" v-if="showTopTabs">
      <div class="terminal-mode-line" :class="{ 'ssh-mode-line': vm.activeTerminalMode.value === 'ssh' }">
        <span v-if="vm.focusTerminal.value" class="status-pill mode terminal-mode-pill" :class="{ 'ssh-terminal-mode-pill': vm.activeTerminalMode.value === 'ssh' }">
          {{ vm.terminalModeLabel.value }}
        </span>
        <div v-if="vm.activeTerminalMode.value === 'ssh' || showHomeTabs" class="terminal-tabs terminal-tabs-inline">
          <div class="terminal-tab terminal-home-tab" :class="{ active: showHomeTabs }">
            <button type="button" class="terminal-tab-main terminal-tab-main-rich" @click="vm.openSshConnectionChooser()">
              <span class="terminal-tab-icon"><House :size="14" /></span>
              <span class="terminal-tab-copy">
                <span class="terminal-tab-name">首页</span>
              </span>
            </button>
          </div>
          <div
            v-for="tab in vm.sshTabs.value"
            :key="tab.id"
            class="terminal-tab"
            :class="{ active: vm.sshSessionId.value === tab.id }"
          >
            <button type="button" class="terminal-tab-main terminal-tab-main-rich" @click="vm.switchSshTab(tab.id)">
              <span class="terminal-tab-icon"><SquareTerminal :size="14" /></span>
              <span class="terminal-tab-copy">
                <span class="terminal-tab-name">{{ tab.name }}</span>
              </span>
              <span class="status-dot" :class="tab.connected ? 'online' : 'offline'"></span>
            </button>
            <button
              type="button"
              class="terminal-tab-close"
              title="关闭并断开"
              @pointerdown.stop.prevent
              @mousedown.stop.prevent
              @click.stop.prevent="vm.handleSshTabClose(tab.id)"
            >
              ×
            </button>
          </div>
          <button type="button" class="terminal-tab-add" title="新建 SSH 标签" @click="vm.openSshConnectionChooser()">
            <Plus :size="14" />
          </button>
        </div>
        <span v-else-if="vm.focusTerminal.value" class="status-pill plain">{{ vm.terminalTargetLabel.value }}</span>
        <div v-if="vm.activeTerminalMode.value === 'local' && vm.focusTerminal.value" class="terminal-mode-tools">
          <button type="button" class="ghost small terminal-return-btn" @click="vm.openLocalTerminalChooser()">返回</button>
          <button type="button" class="ghost small terminal-menu-btn" title="终端工具" @click="toggleToolsDrawer">
            <Menu :size="16" />
          </button>
        </div>
      </div>
      <div v-if="vm.activeTerminalMode.value === 'local'" class="terminal-tabs">
        <div
          v-for="tab in vm.localTabs.value"
          :key="tab.id"
          class="terminal-tab"
          :class="{ active: vm.activeLocalTabId.value === tab.id }"
        >
          <button type="button" class="terminal-tab-main" @click="vm.switchLocalTab(tab.id)">
            <span class="terminal-tab-name">{{ tab.name }}</span>
            <span class="status-dot" :class="tab.connected ? 'online' : 'offline'"></span>
          </button>
          <button
            type="button"
            class="terminal-tab-close"
            title="关闭本地标签"
            @click="vm.closeLocalTab(tab.id)"
          >
            ×
          </button>
        </div>
        <button type="button" class="ghost small" @click="vm.connectLocalTerminal()">+ 本地标签</button>
      </div>
      <div v-if="vm.activeTerminalMode.value === 'serial'" class="serial-live-toolbar">
        <div class="terminal-tools-left">
          <button class="ghost terminal-tool-btn" @click="vm.exitTerminalView">返回串口面板</button>
          <button class="danger terminal-tool-btn terminal-tool-btn-danger" @click="vm.closeSerial">断开串口</button>
        </div>
        <div class="terminal-tools-right">
          <select v-model="vm.terminalSnippetCategory.value" class="terminal-tool-select">
            <option v-for="cat in vm.terminalSnippetCategories.value" :key="cat" :value="cat">
              {{ cat }}
            </option>
          </select>
          <select v-model="vm.terminalSnippetId.value" class="terminal-tool-select">
            <option value="">选择代码片段</option>
            <option v-for="item in vm.terminalSnippetItems.value" :key="item.id" :value="item.id">
              {{ item.name }}
            </option>
          </select>
          <button class="muted terminal-tool-btn" :disabled="vm.snippetRunning.value" @click="vm.runTerminalSnippet">执行片段</button>
        </div>
      </div>
    </div>

    <section
      v-show="vm.focusTerminal.value"
      class="terminal-wrap"
      :class="{ focus: vm.focusTerminal.value, 'serial-live-shell': vm.activeTerminalMode.value === 'serial', 'ssh-live-shell': vm.activeTerminalMode.value === 'ssh' }"
    >
      <div class="terminal-core">
        <div :ref="vm.bindTermEl" class="terminal" @contextmenu.prevent="vm.openTerminalContextMenu"></div>
      </div>
      <aside v-if="vm.activeTerminalMode.value === 'ssh'" class="ssh-session-rail">
        <div class="ssh-rail-head">
          <div class="ssh-rail-headline">
            <strong>{{ vm.activeSshTabName.value || '当前 SSH 会话' }}</strong>
            <span>{{ vm.sshServerMetricsLoading.value ? '正在同步主机状态...' : 'FinalShell 风格紧凑概览' }}</span>
          </div>
        </div>
        <div v-if="vm.sshMetricChips.value?.length" class="ssh-metric-chip-grid">
          <button
            v-for="item in vm.sshMetricChips.value"
            :key="item.label"
            type="button"
            class="metric-chip ssh-rail-chip ssh-rail-chip-action"
            @click="handleMetricChipClick(item)"
          >
            <strong>{{ item.label }}</strong>
            <span>{{ item.value }}</span>
          </button>
        </div>
        <div v-if="vm.sshServerMetricsError.value" class="ssh-rail-note warning">{{ vm.sshServerMetricsError.value }}</div>
        <section v-if="vm.sshNetworkRouteVisible.value" class="ssh-overview-card ssh-network-card">
          <header class="ssh-overview-head">
            <strong>网络链路</strong>
            <small>{{ vm.sshNetworkRouteLoading.value ? '正在读取本机网络...' : '客户端到服务器' }}</small>
          </header>
          <div v-if="vm.sshNetworkRouteError.value" class="ssh-rail-note warning">{{ vm.sshNetworkRouteError.value }}</div>
          <div class="ssh-network-steps">
            <article v-for="step in vm.sshNetworkRouteSteps.value" :key="step.label" class="ssh-network-step">
              <small>{{ step.label }}</small>
              <strong>{{ step.value }}</strong>
            </article>
          </div>
          <div class="ssh-network-actions">
            <button type="button" class="ghost small" @click="vm.sendTerminalCommand('ss -tunap || netstat -tunap')">连接状态</button>
            <button type="button" class="ghost small" @click="vm.sendTerminalCommand(`traceroute ${vm.sshNetworkRoute.value.targetHost || vm.sshConnectionFacts.value[0]?.value || '8.8.8.8'} || tracepath ${vm.sshNetworkRoute.value.targetHost || vm.sshConnectionFacts.value[0]?.value || '8.8.8.8'}`)">链路探测</button>
          </div>
        </section>
        <section class="ssh-overview-card">
          <header class="ssh-overview-head">
            <strong>连接概述</strong>
            <small>{{ vm.sshDirectorySnapshot.value.cwd || '--' }}</small>
          </header>
          <div class="ssh-fact-grid">
            <article v-for="item in vm.sshConnectionFacts.value" :key="`conn-${item.label}`" class="ssh-fact-item">
              <span class="ssh-fact-icon">
                <component :is="factIcons[item.icon] || Server" :size="14" />
              </span>
              <div class="ssh-fact-copy">
                <small>{{ item.label }}</small>
                <strong :title="item.value">{{ item.value }}</strong>
              </div>
            </article>
          </div>
        </section>
        <section class="ssh-overview-card">
          <header class="ssh-overview-head">
            <strong>系统信息</strong>
            <small>{{ vm.sshServerMetrics.value.loadAverage ? `负载 ${vm.sshServerMetrics.value.loadAverage}` : '' }}</small>
          </header>
          <div class="ssh-fact-grid">
            <article v-for="item in vm.sshSystemFacts.value" :key="`sys-${item.label}`" class="ssh-fact-item">
              <span class="ssh-fact-icon">
                <component :is="factIcons[item.icon] || HardDrive" :size="14" />
              </span>
              <div class="ssh-fact-copy">
                <small>{{ item.label }}</small>
                <strong :title="item.value">{{ item.value }}</strong>
              </div>
            </article>
          </div>
        </section>
        <section class="ssh-overview-card">
          <header class="ssh-overview-head">
            <strong>当前目录</strong>
            <small>{{ vm.sshDirectoryLoading.value ? '正在刷新...' : (vm.sshDirectorySnapshot.value.cwd || '--') }}</small>
          </header>
          <div v-if="vm.sshDirectoryError.value" class="ssh-rail-note warning">{{ vm.sshDirectoryError.value }}</div>
          <div class="ssh-directory-stats">
            <span v-for="item in vm.sshDirectoryStats.value" :key="`dir-${item.label}`" class="ssh-directory-stat">
              <small>{{ item.label }}</small>
              <strong>{{ item.value }}</strong>
            </span>
          </div>
          <div v-if="vm.sshDirectorySnapshot.value.items?.length" class="ssh-directory-list">
            <article v-for="item in vm.sshDirectorySnapshot.value.items" :key="`${item.kind}-${item.name}`" class="ssh-directory-item">
              <span class="ssh-directory-icon" :class="{ folder: item.kind === 'd' }">
                <FolderClosed v-if="item.kind === 'd'" :size="14" />
                <Folder v-else :size="14" />
              </span>
              <strong :title="item.name">{{ item.name }}</strong>
            </article>
          </div>
          <div v-else class="ssh-directory-empty">当前目录下没有可展示的项目</div>
        </section>
      </aside>
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
    <div v-if="toolsDrawerOpen && vm.activeTerminalMode.value === 'local'" class="terminal-tools-overlay" @click="closeToolsDrawer"></div>
    <aside v-if="toolsDrawerOpen && vm.activeTerminalMode.value === 'local'" class="terminal-tools-drawer">
      <div class="terminal-tools-drawer-head">
        <strong>终端工具</strong>
        <button type="button" class="ghost small terminal-drawer-close" @click="closeToolsDrawer">
          <X :size="16" />
        </button>
      </div>
      <div class="terminal-tools-drawer-body">
        <label class="terminal-drawer-field">
          <span>终端编码</span>
          <select v-model="vm.terminalEncoding.value" class="terminal-tool-select encoding-select" title="终端解码">
            <option value="utf-8">UTF-8</option>
            <option value="gb18030">GBK / GB18030</option>
          </select>
        </label>
        <label class="terminal-drawer-field">
          <span>片段分类</span>
          <select v-model="vm.terminalSnippetCategory.value" class="terminal-tool-select">
            <option v-for="cat in vm.terminalSnippetCategories.value" :key="cat" :value="cat">
              {{ cat }}
            </option>
          </select>
        </label>
        <label class="terminal-drawer-field">
          <span>代码片段</span>
          <select v-model="vm.terminalSnippetId.value" class="terminal-tool-select">
            <option value="">选择代码片段</option>
            <option v-for="item in vm.terminalSnippetItems.value" :key="item.id" :value="item.id">
              {{ item.name }}
            </option>
          </select>
        </label>
        <div class="terminal-drawer-actions">
          <button class="muted terminal-tool-btn" :disabled="vm.snippetRunning.value" @click="vm.runTerminalSnippet">执行片段</button>
          <button class="ghost terminal-tool-btn" @click="vm.sendSnippetRawToTerminal">发送原文</button>
          <button class="ghost terminal-tool-btn" @click="vm.openSnippetsPanel">打开片段</button>
        </div>
      </div>
    </aside>
  </div>
</template>
