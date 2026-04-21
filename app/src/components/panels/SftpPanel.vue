<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  ArrowUp,
  FolderPlus,
  HardDrive,
  Link2,
  RefreshCw,
  Search,
  Server,
} from 'lucide-vue-next'

const { vm } = defineProps<{ vm: any }>()

const leftPathDraft = ref('')
const rightPathDraft = ref('')

watch(
  [() => vm.leftPanelMode.value, () => vm.localPath.value, () => vm.leftSftpPath.value],
  () => {
    leftPathDraft.value = vm.leftPanelMode.value === 'local'
      ? String(vm.localPath.value || '')
      : String(vm.leftSftpPath.value || '.')
  },
  { immediate: true },
)

watch(
  [() => vm.rightPanelMode.value, () => vm.rightLocalPath.value, () => vm.sftpPath.value],
  () => {
    rightPathDraft.value = vm.rightPanelMode.value === 'local'
      ? String(vm.rightLocalPath.value || '')
      : String(vm.sftpPath.value || '.')
  },
  { immediate: true },
)

const formatFileSize = (value: unknown) => {
  const size = Number(value || 0)
  if (!Number.isFinite(size) || size <= 0) return '文件'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let current = size
  let index = 0
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024
    index += 1
  }
  return `${current >= 100 || index === 0 ? current.toFixed(0) : current.toFixed(1)} ${units[index]}`
}

const fileKindLabel = (item: any) => (item?.isDir ? '目录' : '文件')

const toggleLeftSort = (key: 'name' | 'modifiedAt' | 'size' | 'kind') => {
  if (vm.localSortBy.value === key) {
    vm.localSortDirection.value = vm.localSortDirection.value === 'asc' ? 'desc' : 'asc'
    return
  }
  vm.localSortBy.value = key
  vm.localSortDirection.value = key === 'name' || key === 'kind' ? 'asc' : 'desc'
}

const toggleRightSort = (key: 'name' | 'modifiedAt' | 'size' | 'kind') => {
  if (vm.remoteSortBy.value === key) {
    vm.remoteSortDirection.value = vm.remoteSortDirection.value === 'asc' ? 'desc' : 'asc'
    return
  }
  vm.remoteSortBy.value = key
  vm.remoteSortDirection.value = key === 'name' || key === 'kind' ? 'asc' : 'desc'
}

const jumpLeftPath = async () => {
  const nextPath = String(leftPathDraft.value || '').trim()
  if (vm.leftPanelMode.value === 'local') {
    vm.localPath.value = nextPath
    await vm.loadLocalFs()
    return
  }
  vm.leftSftpPath.value = nextPath || '.'
  await vm.loadLeftSftp()
}

const jumpRightPath = async () => {
  const nextPath = String(rightPathDraft.value || '').trim()
  if (vm.rightPanelMode.value === 'local') {
    vm.rightLocalPath.value = nextPath
    await vm.loadRightLocalFs()
    return
  }
  vm.sftpPath.value = nextPath || '.'
  await vm.loadSftp()
}
</script>

<template>
  <section class="panel sftp-panel">
    <div class="sftp-shell">
      <div class="sftp-compact-bar">
        <div class="sftp-compact-title">
          <span>SFTP</span>
          <small>{{ vm.sftpTransferModeLabel.value }}</small>
        </div>
        <div class="sftp-compact-status">
          <span class="status-pill" :class="{ online: vm.sftpConnected.value }">
            {{ vm.sftpConnected.value ? '远端在线' : '远端未连接' }}
          </span>
          <span class="status-pill plain">{{ vm.sftpStatus.value || '就绪' }}</span>
        </div>
      </div>

      <div class="sftp-workspace">
        <section class="sftp-pane sftp-pane-left" @dragover.prevent @drop="vm.onLeftDrop">
          <header class="sftp-pane-head">
            <div class="sftp-pane-heading">
              <span class="sftp-pane-icon local"><HardDrive :size="16" /></span>
              <div class="sftp-pane-copy">
                <h4>{{ vm.leftPanelMode.value === 'local' ? '本地目录' : '远程浏览' }}</h4>
              </div>
            </div>
            <div class="sftp-pane-actions">
              <button class="ghost small sftp-action-btn" @click="vm.localGoUp">
                <ArrowUp :size="13" /> 上一级
              </button>
              <button class="ghost small sftp-action-btn" @click="vm.leftPanelMode.value === 'local' ? vm.loadLocalFs() : vm.loadLeftSftp()">
                <RefreshCw :size="13" /> 刷新
              </button>
              <button class="ghost small sftp-action-btn" @click="vm.toggleLeftConnectPanel">
                <Link2 :size="13" /> 连接
              </button>
            </div>
          </header>

          <div class="sftp-toolbar-row">
            <label class="sftp-path-input">
              <span class="sftp-path-label">路径</span>
              <input
                v-model="leftPathDraft"
                placeholder="输入路径后回车"
                @keyup.enter="jumpLeftPath"
              />
            </label>
            <label class="sftp-search compact">
              <Search :size="13" />
              <input v-model="vm.leftFileKeyword.value" placeholder="搜索" />
            </label>
          </div>

          <div v-if="vm.leftConnectPanelOpen.value" class="sftp-connect-card">
            <div class="sftp-connect-head">
              <strong>切换左侧连接</strong>
              <span>选择本地目录或某台服务器</span>
            </div>
            <div class="connect-inline sftp-connect-inline">
              <div class="connect-filters">
                <select v-model="vm.leftConnectCategory.value">
                  <option :value="vm.allCategory">全部分类</option>
                  <option v-for="c in vm.hostCategories.value" :key="`left-cat-${c}`" :value="c">{{ c }}</option>
                </select>
                <input v-model="vm.leftConnectKeyword.value" placeholder="搜索服务器/IP/用户名" />
              </div>
              <select v-model="vm.leftConnectTarget.value">
                <option value="local">本地目录</option>
                <optgroup v-for="group in vm.leftConnectGroups.value" :key="`left-group-${group.category}`" :label="group.category">
                  <option v-for="h in group.items" :key="h.id" :value="h.id">{{ h.name }} ({{ h.host }})</option>
                </optgroup>
              </select>
              <button @click="vm.connectLeftPanel">应用</button>
            </div>
          </div>

          <div class="sftp-file-list">
            <div class="sftp-file-header">
              <button class="sftp-file-col name" :class="{ active: vm.localSortBy.value === 'name' }" @click="toggleLeftSort('name')">名字</button>
              <button class="sftp-file-col" :class="{ active: vm.localSortBy.value === 'modifiedAt' }" @click="toggleLeftSort('modifiedAt')">修改日期</button>
              <button class="sftp-file-col size" :class="{ active: vm.localSortBy.value === 'size' }" @click="toggleLeftSort('size')">尺寸</button>
              <button class="sftp-file-col kind" :class="{ active: vm.localSortBy.value === 'kind' }" @click="toggleLeftSort('kind')">属性</button>
            </div>
            <div
              v-for="l in vm.leftDisplayRows.value"
              :key="vm.leftPanelMode.value === 'local' ? l.path : l.filename"
              class="sftp-file-row"
              :class="{ 'is-dir': l.isDir, active: vm.leftPanelMode.value === 'local' ? vm.selectedLocalFile.value === l.path : vm.selectedRemoteFile.value === l.filename }"
              :draggable="vm.leftPanelMode.value === 'local'"
              @click="vm.openLeftItem(l)"
              @dragstart="vm.onLeftDragStart(l)"
            >
              <div class="sftp-file-main name">
                <span class="sftp-file-icon">{{ l.isDir ? '📁' : '📄' }}</span>
                <div class="sftp-file-copy">
                  <strong>{{ vm.leftPanelMode.value === 'local' ? l.name : l.filename }}</strong>
                </div>
              </div>
              <div class="sftp-file-meta">
                <span>{{ vm.formatFsTime(vm.leftPanelMode.value === 'local' ? l.modifiedAt : (l.modifiedAt || l.mtime)) }}</span>
              </div>
              <div class="sftp-file-size">{{ l.isDir ? '—' : formatFileSize(l.size) }}</div>
              <div class="sftp-file-kind">{{ fileKindLabel(l) }}</div>
            </div>
            <div v-if="vm.leftDisplayRows.value.length === 0" class="sftp-file-empty">
              当前左侧目录为空
            </div>
          </div>
        </section>

        <section class="sftp-pane sftp-pane-right" @dragover.prevent @drop="vm.onRightDrop">
          <header class="sftp-pane-head">
            <div class="sftp-pane-heading">
              <span class="sftp-pane-icon remote"><Server :size="16" /></span>
              <div class="sftp-pane-copy">
                <h4>{{ vm.rightPanelMode.value === 'remote' ? '远程目录' : '本地目录' }}</h4>
              </div>
            </div>
            <div class="sftp-pane-actions">
              <button class="ghost small sftp-action-btn" @click="vm.remoteGoUp">
                <ArrowUp :size="13" /> 上一级
              </button>
              <button class="ghost small sftp-action-btn" @click="vm.loadSftp">
                <RefreshCw :size="13" /> 刷新
              </button>
              <button v-if="vm.rightPanelMode.value === 'remote'" class="ghost small sftp-action-btn" @click="vm.promptMkdirSftp">
                <FolderPlus :size="13" /> 新建
              </button>
              <button class="ghost small sftp-action-btn" @click="vm.toggleRightConnectPanel">
                <Link2 :size="13" /> 连接
              </button>
            </div>
          </header>

          <div class="sftp-toolbar-row">
            <label class="sftp-path-input accent">
              <span class="sftp-path-label">路径</span>
              <input
                v-model="rightPathDraft"
                placeholder="输入路径后回车"
                @keyup.enter="jumpRightPath"
              />
            </label>
            <label class="sftp-search compact">
              <Search :size="13" />
              <input v-model="vm.rightFileKeyword.value" placeholder="搜索" />
            </label>
          </div>

          <div v-if="vm.rightConnectPanelOpen.value" class="sftp-connect-card accent">
            <div class="sftp-connect-head">
              <strong>切换右侧连接</strong>
              <span>通常用来挂载远程目录或本地目录</span>
            </div>
            <div class="connect-inline sftp-connect-inline">
              <div class="connect-filters">
                <select v-model="vm.rightConnectCategory.value">
                  <option :value="vm.allCategory">全部分类</option>
                  <option v-for="c in vm.hostCategories.value" :key="`right-cat-${c}`" :value="c">{{ c }}</option>
                </select>
                <input v-model="vm.rightConnectKeyword.value" placeholder="搜索服务器/IP/用户名" />
              </div>
              <select v-model="vm.rightConnectTarget.value">
                <option value="local">本地目录</option>
                <optgroup v-for="group in vm.rightConnectGroups.value" :key="`right-group-${group.category}`" :label="group.category">
                  <option v-for="h in group.items" :key="h.id" :value="h.id">{{ h.name }} ({{ h.host }})</option>
                </optgroup>
              </select>
              <button @click="vm.connectSftp">应用</button>
            </div>
          </div>

          <div class="sftp-file-list">
            <div class="sftp-file-header">
              <button class="sftp-file-col name" :class="{ active: vm.remoteSortBy.value === 'name' }" @click="toggleRightSort('name')">名字</button>
              <button class="sftp-file-col" :class="{ active: vm.remoteSortBy.value === 'modifiedAt' }" @click="toggleRightSort('modifiedAt')">修改日期</button>
              <button class="sftp-file-col size" :class="{ active: vm.remoteSortBy.value === 'size' }" @click="toggleRightSort('size')">尺寸</button>
              <button class="sftp-file-col kind" :class="{ active: vm.remoteSortBy.value === 'kind' }" @click="toggleRightSort('kind')">属性</button>
            </div>
            <div
              v-for="r in vm.rightDisplayRows.value"
              :key="vm.rightPanelMode.value === 'remote' ? r.filename : r.path"
              class="sftp-file-row"
              :class="{ 'is-dir': r.isDir, active: vm.rightPanelMode.value === 'remote' ? vm.selectedRemoteFile.value === r.filename : vm.selectedLocalFile.value === r.path }"
              :draggable="!r.isDir"
              @click="vm.openRightItem(r)"
              @contextmenu="vm.rightPanelMode.value === 'remote' ? vm.showRemoteMenu($event, r) : undefined"
              @dragstart="vm.onRightDragStart(r)"
            >
              <div class="sftp-file-main name">
                <span class="sftp-file-icon">{{ r.isDir ? '📁' : '📄' }}</span>
                <div class="sftp-file-copy">
                  <strong>{{ vm.rightPanelMode.value === 'remote' ? r.filename : r.name }}</strong>
                </div>
              </div>
              <div class="sftp-file-meta">
                <span>{{ r.isDir ? '—' : vm.formatFsTime(vm.rightPanelMode.value === 'remote' ? (r.modifiedAt || r.mtime) : r.modifiedAt) }}</span>
              </div>
              <div class="sftp-file-size">{{ r.isDir ? '—' : formatFileSize(r.size) }}</div>
              <div class="sftp-file-kind">{{ fileKindLabel(r) }}</div>
            </div>
            <div v-if="vm.rightDisplayRows.value.length === 0" class="sftp-file-empty">
              当前右侧目录为空
            </div>
          </div>
        </section>
      </div>
    </div>

    <div
      v-if="vm.rightPanelMode.value === 'remote' && vm.remoteMenu.value.visible"
      class="context-menu"
      :style="{ left: `${vm.remoteMenu.value.x}px`, top: `${vm.remoteMenu.value.y}px` }"
    >
      <button class="menu-item" @click="vm.menuDownload">下载</button>
      <button class="menu-item" @click="vm.menuRename">重命名</button>
      <button class="menu-item danger" @click="vm.menuDelete">删除</button>
    </div>
  </section>
</template>
