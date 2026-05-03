<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  ArrowUp,
  Check,
  FolderPlus,
  HardDrive,
  KeyRound,
  Link2,
  Monitor,
  RefreshCw,
  Search,
  Server,
} from 'lucide-vue-next'

const { vm } = defineProps<{ vm: any }>()

const leftPathDraft = ref('')
const rightPathDraft = ref('')
const leftFileListEl = ref<HTMLElement | null>(null)
const rightFileListEl = ref<HTMLElement | null>(null)
const lastLeftSelectedIndex = ref<number | null>(null)
const lastRightSelectedIndex = ref<number | null>(null)
const suppressNextRowClick = ref(false)
const selectionBox = ref({
  active: false,
  side: '' as 'left' | 'right' | '',
  startX: 0,
  startY: 0,
  x: 0,
  y: 0,
  width: 0,
  height: 0,
})

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

const hostTitle = (host: any) => String(host?.name || host?.host || '未命名服务器')

const hostAddressLabel = (host: any) => {
  const username = String(host?.username || '').trim()
  const address = String(host?.host || '').trim()
  return username ? `${username}@${address}` : address || '未填写地址'
}

const hostPortLabel = (host: any) => `:${Number(host?.port || 22)}`

const hostAuthLabel = (host: any) => (host?.auth_type === 'key' ? '密钥' : '密码')

const hostGroupCount = (groups: any[]) => groups.reduce((sum, group) => sum + Number(group?.items?.length || 0), 0)

const leftItemKey = (item: any) => String(vm.leftPanelMode.value === 'local' ? item?.path : item?.filename || '')

const rightItemKey = (item: any) => String(vm.rightPanelMode.value === 'remote' ? item?.filename : item?.path || '')

const isLeftSelected = (item: any) => vm.leftSelectedKeys.value.includes(leftItemKey(item))

const isRightSelected = (item: any) => vm.rightSelectedKeys.value.includes(rightItemKey(item))

const selectionStyle = () => ({
  left: `${selectionBox.value.x}px`,
  top: `${selectionBox.value.y}px`,
  width: `${selectionBox.value.width}px`,
  height: `${selectionBox.value.height}px`,
})

const selectByIndex = (
  side: 'left' | 'right',
  key: string,
  index: number,
  rows: any[],
  event: MouseEvent,
) => {
  if (!key) return
  const currentKeys = side === 'left' ? vm.leftSelectedKeys.value : vm.rightSelectedKeys.value
  const keyForRow = side === 'left' ? leftItemKey : rightItemKey
  const lastIndexRef = side === 'left' ? lastLeftSelectedIndex : lastRightSelectedIndex
  let nextKeys: string[]

  if (event.shiftKey && lastIndexRef.value !== null) {
    const start = Math.max(0, Math.min(lastIndexRef.value, index))
    const end = Math.min(rows.length - 1, Math.max(lastIndexRef.value, index))
    const rangeKeys = rows.slice(start, end + 1).map(keyForRow).filter(Boolean)
    nextKeys = [...new Set([...currentKeys, ...rangeKeys])]
  } else if (event.metaKey || event.ctrlKey) {
    const selected = new Set<string>(currentKeys)
    if (selected.has(key)) selected.delete(key)
    else selected.add(key)
    nextKeys = [...selected]
    lastIndexRef.value = index
  } else {
    nextKeys = [key]
    lastIndexRef.value = index
  }

  if (side === 'left') vm.setLeftSelectedKeys(nextKeys)
  else vm.setRightSelectedKeys(nextKeys)
}

const handleLeftRowClick = (event: MouseEvent, item: any, index: number) => {
  if (suppressNextRowClick.value) {
    suppressNextRowClick.value = false
    return
  }
  selectByIndex('left', leftItemKey(item), index, vm.leftDisplayRows.value, event)
}

const handleRightRowClick = (event: MouseEvent, item: any, index: number) => {
  if (suppressNextRowClick.value) {
    suppressNextRowClick.value = false
    return
  }
  selectByIndex('right', rightItemKey(item), index, vm.rightDisplayRows.value, event)
}

const handleRightContextMenu = (event: MouseEvent, item: any, index: number) => {
  if (!isRightSelected(item)) {
    selectByIndex('right', rightItemKey(item), index, vm.rightDisplayRows.value, event)
  }
  if (vm.rightPanelMode.value === 'remote') vm.showRemoteMenu(event, item)
}

const beginBoxSelect = (event: MouseEvent, side: 'left' | 'right') => {
  if (event.button !== 0) return
  const target = event.target as HTMLElement | null
  if (target?.closest('.sftp-file-header')) return
  const listEl = side === 'left' ? leftFileListEl.value : rightFileListEl.value
  if (!listEl) return
  const rect = listEl.getBoundingClientRect()
  selectionBox.value = {
    active: false,
    side,
    startX: event.clientX,
    startY: event.clientY,
    x: event.clientX - rect.left + listEl.scrollLeft,
    y: event.clientY - rect.top + listEl.scrollTop,
    width: 0,
    height: 0,
  }

  const onMove = (moveEvent: MouseEvent) => {
    const distance = Math.hypot(moveEvent.clientX - selectionBox.value.startX, moveEvent.clientY - selectionBox.value.startY)
    if (distance < 5) return
    moveEvent.preventDefault()
    const nextX = moveEvent.clientX - rect.left + listEl.scrollLeft
    const nextY = moveEvent.clientY - rect.top + listEl.scrollTop
    selectionBox.value.active = true
    selectionBox.value.x = Math.min(selectionBox.value.startX - rect.left + listEl.scrollLeft, nextX)
    selectionBox.value.y = Math.min(selectionBox.value.startY - rect.top + listEl.scrollTop, nextY)
    selectionBox.value.width = Math.abs(nextX - (selectionBox.value.startX - rect.left + listEl.scrollLeft))
    selectionBox.value.height = Math.abs(nextY - (selectionBox.value.startY - rect.top + listEl.scrollTop))
  }

  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    if (!selectionBox.value.active) {
      selectionBox.value.side = ''
      return
    }
    const box = {
      left: selectionBox.value.x,
      right: selectionBox.value.x + selectionBox.value.width,
      top: selectionBox.value.y,
      bottom: selectionBox.value.y + selectionBox.value.height,
    }
    const selectedKeys = [...listEl.querySelectorAll<HTMLElement>('[data-sftp-row-key]')]
      .filter((row) => {
        const rowBox = {
          left: row.offsetLeft,
          right: row.offsetLeft + row.offsetWidth,
          top: row.offsetTop,
          bottom: row.offsetTop + row.offsetHeight,
        }
        return rowBox.left <= box.right && rowBox.right >= box.left && rowBox.top <= box.bottom && rowBox.bottom >= box.top
      })
      .map((row) => row.dataset.sftpRowKey || '')
      .filter(Boolean)
    if (side === 'left') vm.setLeftSelectedKeys(selectedKeys)
    else vm.setRightSelectedKeys(selectedKeys)
    suppressNextRowClick.value = true
    selectionBox.value.active = false
    selectionBox.value.side = ''
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

const preventDragDuringBoxSelect = (event: DragEvent) => {
  if (!selectionBox.value.active) return
  event.preventDefault()
}

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
              <div>
                <strong>切换左侧连接</strong>
                <span>{{ vm.leftConnectTarget.value === 'local' ? '本地目录' : '远程服务器' }}</span>
              </div>
              <span class="sftp-connect-count">{{ hostGroupCount(vm.leftConnectGroups.value) }} 台</span>
            </div>
            <div class="sftp-connect-tools">
              <div class="connect-filters">
                <select v-model="vm.leftConnectCategory.value">
                  <option :value="vm.allCategory">全部分类</option>
                  <option v-for="c in vm.hostCategories.value" :key="`left-cat-${c}`" :value="c">{{ c }}</option>
                </select>
                <input v-model="vm.leftConnectKeyword.value" placeholder="搜索服务器/IP/用户名" />
              </div>
            </div>
            <div class="sftp-connect-options">
              <button
                type="button"
                class="sftp-connect-option local"
                :class="{ selected: vm.leftConnectTarget.value === 'local' }"
                @click="vm.selectLeftConnectTarget('local')"
              >
                <span class="sftp-connect-option-icon local"><Monitor :size="15" /></span>
                <span class="sftp-connect-option-copy">
                  <strong>本地目录</strong>
                  <small>{{ vm.leftLocalPathDisplay.value }}</small>
                </span>
                <span class="sftp-connect-check"><Check :size="14" /></span>
              </button>
              <template v-for="group in vm.leftConnectGroups.value" :key="`left-group-${group.category}`">
                <div class="sftp-connect-group-title">
                  <span>{{ group.category }}</span>
                  <small>{{ group.items.length }}</small>
                </div>
                <button
                  v-for="h in group.items"
                  :key="h.id"
                  type="button"
                  class="sftp-connect-option"
                  :class="{ selected: vm.leftConnectTarget.value === h.id }"
                  @click="vm.selectLeftConnectTarget(h.id)"
                >
                  <span class="sftp-connect-option-icon"><Server :size="15" /></span>
                  <span class="sftp-connect-option-copy">
                    <strong>{{ hostTitle(h) }}</strong>
                    <small>{{ hostAddressLabel(h) }}</small>
                  </span>
                  <span class="sftp-connect-meta">
                    <span>{{ hostPortLabel(h) }}</span>
                    <span><KeyRound :size="11" /> {{ hostAuthLabel(h) }}</span>
                  </span>
                  <span class="sftp-connect-check"><Check :size="14" /></span>
                </button>
              </template>
              <div v-if="vm.leftConnectGroups.value.length === 0" class="sftp-connect-empty">没有匹配的服务器</div>
            </div>
            <div class="sftp-connect-footer">
              <span>{{ vm.leftConnectTarget.value === 'local' ? '将左侧作为本地面板' : '将左侧作为远程面板' }}</span>
              <button @click="vm.connectLeftPanel">应用连接</button>
            </div>
          </div>

          <div
            ref="leftFileListEl"
            class="sftp-file-list"
            @mousedown="beginBoxSelect($event, 'left')"
          >
            <div class="sftp-file-header">
              <button class="sftp-file-col name" :class="{ active: vm.localSortBy.value === 'name' }" @click="toggleLeftSort('name')">名字</button>
              <button class="sftp-file-col" :class="{ active: vm.localSortBy.value === 'modifiedAt' }" @click="toggleLeftSort('modifiedAt')">修改日期</button>
              <button class="sftp-file-col size" :class="{ active: vm.localSortBy.value === 'size' }" @click="toggleLeftSort('size')">尺寸</button>
              <button class="sftp-file-col kind" :class="{ active: vm.localSortBy.value === 'kind' }" @click="toggleLeftSort('kind')">属性</button>
            </div>
            <div
              v-for="(l, index) in vm.leftDisplayRows.value"
              :key="vm.leftPanelMode.value === 'local' ? l.path : l.filename"
              :data-sftp-row-key="leftItemKey(l)"
              class="sftp-file-row"
              :class="{ 'is-dir': l.isDir, active: isLeftSelected(l) }"
              :draggable="vm.leftPanelMode.value === 'local'"
              @click="handleLeftRowClick($event, l, Number(index))"
              @dblclick="vm.openLeftItem(l)"
              @dragstart="preventDragDuringBoxSelect($event); vm.onLeftDragStart(l)"
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
            <div
              v-if="selectionBox.active && selectionBox.side === 'left'"
              class="sftp-selection-box"
              :style="selectionStyle()"
            />
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
              <div>
                <strong>切换右侧连接</strong>
                <span>{{ vm.rightConnectTarget.value === 'local' ? '本地目录' : '远程服务器' }}</span>
              </div>
              <span class="sftp-connect-count">{{ hostGroupCount(vm.rightConnectGroups.value) }} 台</span>
            </div>
            <div class="sftp-connect-tools">
              <div class="connect-filters">
                <select v-model="vm.rightConnectCategory.value">
                  <option :value="vm.allCategory">全部分类</option>
                  <option v-for="c in vm.hostCategories.value" :key="`right-cat-${c}`" :value="c">{{ c }}</option>
                </select>
                <input v-model="vm.rightConnectKeyword.value" placeholder="搜索服务器/IP/用户名" />
              </div>
            </div>
            <div class="sftp-connect-options">
              <button
                type="button"
                class="sftp-connect-option local"
                :class="{ selected: vm.rightConnectTarget.value === 'local' }"
                @click="vm.selectRightConnectTarget('local')"
              >
                <span class="sftp-connect-option-icon local"><HardDrive :size="15" /></span>
                <span class="sftp-connect-option-copy">
                  <strong>本地目录</strong>
                  <small>{{ vm.rightLocalPathDisplay.value }}</small>
                </span>
                <span class="sftp-connect-check"><Check :size="14" /></span>
              </button>
              <template v-for="group in vm.rightConnectGroups.value" :key="`right-group-${group.category}`">
                <div class="sftp-connect-group-title">
                  <span>{{ group.category }}</span>
                  <small>{{ group.items.length }}</small>
                </div>
                <button
                  v-for="h in group.items"
                  :key="h.id"
                  type="button"
                  class="sftp-connect-option"
                  :class="{ selected: vm.rightConnectTarget.value === h.id }"
                  @click="vm.selectRightConnectTarget(h.id)"
                >
                  <span class="sftp-connect-option-icon"><Server :size="15" /></span>
                  <span class="sftp-connect-option-copy">
                    <strong>{{ hostTitle(h) }}</strong>
                    <small>{{ hostAddressLabel(h) }}</small>
                  </span>
                  <span class="sftp-connect-meta">
                    <span>{{ hostPortLabel(h) }}</span>
                    <span><KeyRound :size="11" /> {{ hostAuthLabel(h) }}</span>
                  </span>
                  <span class="sftp-connect-check"><Check :size="14" /></span>
                </button>
              </template>
              <div v-if="vm.rightConnectGroups.value.length === 0" class="sftp-connect-empty">没有匹配的服务器</div>
            </div>
            <div class="sftp-connect-footer">
              <span>{{ vm.rightConnectTarget.value === 'local' ? '将右侧作为本地面板' : '将右侧作为远程面板' }}</span>
              <button @click="vm.connectSftp">应用连接</button>
            </div>
          </div>

          <div
            ref="rightFileListEl"
            class="sftp-file-list"
            @mousedown="beginBoxSelect($event, 'right')"
          >
            <div class="sftp-file-header">
              <button class="sftp-file-col name" :class="{ active: vm.remoteSortBy.value === 'name' }" @click="toggleRightSort('name')">名字</button>
              <button class="sftp-file-col" :class="{ active: vm.remoteSortBy.value === 'modifiedAt' }" @click="toggleRightSort('modifiedAt')">修改日期</button>
              <button class="sftp-file-col size" :class="{ active: vm.remoteSortBy.value === 'size' }" @click="toggleRightSort('size')">尺寸</button>
              <button class="sftp-file-col kind" :class="{ active: vm.remoteSortBy.value === 'kind' }" @click="toggleRightSort('kind')">属性</button>
            </div>
            <div
              v-for="(r, index) in vm.rightDisplayRows.value"
              :key="vm.rightPanelMode.value === 'remote' ? r.filename : r.path"
              :data-sftp-row-key="rightItemKey(r)"
              class="sftp-file-row"
              :class="{ 'is-dir': r.isDir, active: isRightSelected(r) }"
              :draggable="!r.isDir"
              @click="handleRightRowClick($event, r, Number(index))"
              @dblclick="vm.openRightItem(r)"
              @contextmenu="handleRightContextMenu($event, r, Number(index))"
              @dragstart="preventDragDuringBoxSelect($event); vm.onRightDragStart(r)"
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
            <div
              v-if="selectionBox.active && selectionBox.side === 'right'"
              class="sftp-selection-box"
              :style="selectionStyle()"
            />
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
