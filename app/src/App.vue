<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Server, FolderTree, Cable, KeyRound, Settings, Pencil, Eye, EyeOff } from 'lucide-vue-next'
import { useHostCrud } from './composables/useHostCrud'
import { useHostFilters } from './composables/useHostFilters'
import { useHostProbe } from './composables/useHostProbe'
import { useSftpActions } from './composables/useSftpActions'
import { useSftpPanels } from './composables/useSftpPanels'
import { useSshTabActions } from './composables/useSshTabActions'
import { useTerminalTabs } from './composables/useTerminalTabs'
import '@xterm/xterm/css/xterm.css'

type NavKey = 'hosts' | 'sftp' | 'snippets' | 'serial' | 'local' | 'vault' | 'settings' | 'logs'
const nav = ref<NavKey>('hosts')
const termEl = ref<HTMLElement | null>(null)

const DEFAULT_CATEGORY = '默认'
const ALL_CATEGORY = '全部'
const LEGACY_SNIPPET_STORAGE_KEY = 'astrashell.snippets.v1'
const SNIPPET_DEFAULT_CATEGORY = '部署'
const SNIPPET_ALL_CATEGORY = '全部'
const TERMINAL_ENCODING_STORAGE_KEY = 'astrashell.terminal.encoding'

const sshForm = ref({ host: '', port: 22, username: 'root', password: '' })
const quickConnectInput = ref('')
const authType = ref<'password' | 'key'>('password')
const selectedKeyRef = ref('')
const sshStatus = ref('')
const sshSessionId = ref('')
const sshConnected = ref(false)
const focusTerminal = ref(false)
type TerminalMode = 'ssh' | 'serial' | 'local'
const activeTerminalMode = ref<TerminalMode>('ssh')

type LocalSSHConfig = { host: string; port?: number; username: string; password?: string; privateKey?: string }
const {
  sshTabs,
  sshBufferBySession,
  ensureSshBuffer,
  getSshBuffer,
  appendSshBuffer,
} = useTerminalTabs()

const hostName = ref('')
const hostCategory = ref(DEFAULT_CATEGORY)
const hostItems = ref<any[]>([])
const selectedHostId = ref('')
const editingHost = ref<any | null>(null)
const editPasswordVisible = ref(false)
const hostEditorVisible = ref(false)

const extraCategories = ref<string[]>([])

const notify = (ok: boolean, message: string) => {
  if (ok) {
    sshStatus.value = `✅ ${message}`
    window.alert(`✅ ${message}`)
  } else {
    sshStatus.value = `❌ ${message}`
    window.alert(`❌ ${message}`)
  }
}



const {
  sftpPath,
  sftpRows,
  sftpStatus,
  sftpHostId,
  sftpConnected,
  rightConnectPanelOpen,
  rightConnectTarget,
  sftpDragLocalPath,
  sftpDragRemoteFile,
  sftpUploadProgress,
  sftpDownloadProgress,
  selectedRemoteFile,
  sftpNewDirName,
  sftpRenameTo,
  remoteMenu,
  leftPanelMode,
  leftConnectPanelOpen,
  leftConnectTarget,
  leftConnectCategory,
  leftConnectKeyword,
  leftSftpHostId,
  leftSftpPath,
  leftSftpRows,
  rightPanelMode,
  rightConnectCategory,
  rightConnectKeyword,
  rightLocalPath,
  rightLocalRows,
  leftFileKeyword,
  rightFileKeyword,
  localSortBy,
  remoteSortBy,
} = useSftpPanels()

const textMenu = ref({ visible: false, x: 0, y: 0, mode: 'terminal' as 'terminal' | 'editor' })
const editorMenuTarget = ref<HTMLInputElement | HTMLTextAreaElement | null>(null)
const localPath = ref('')
const localRows = ref<any[]>([])
const selectedLocalFile = ref('')

const toTimeMs = (value: unknown) => {
  const num = Number(value || 0)
  if (!Number.isFinite(num) || num <= 0) return 0
  return num > 1e12 ? num : num * 1000
}

const formatFsTime = (value: unknown) => {
  const ts = toTimeMs(value)
  if (!ts) return '未知时间'
  return new Date(ts).toLocaleDateString()
}

const sortFsRows = <T extends { isDir?: boolean; name?: string; filename?: string; createdAt?: number; modifiedAt?: number; mtime?: number }>(
  rows: T[],
  sortBy: 'name' | 'createdAt' | 'modifiedAt'
) => {
  return [...rows].sort((a, b) => {
    if (!!a.isDir !== !!b.isDir) return a.isDir ? -1 : 1
    if (sortBy === 'name') {
      const an = String(a.name || a.filename || '').toLowerCase()
      const bn = String(b.name || b.filename || '').toLowerCase()
      return an.localeCompare(bn, 'zh-Hans-CN')
    }
    const aTime = sortBy === 'createdAt' ? toTimeMs(a.createdAt) : toTimeMs(a.modifiedAt || a.mtime)
    const bTime = sortBy === 'createdAt' ? toTimeMs(b.createdAt) : toTimeMs(b.modifiedAt || b.mtime)
    if (aTime !== bTime) return bTime - aTime
    const an = String(a.name || a.filename || '').toLowerCase()
    const bn = String(b.name || b.filename || '').toLowerCase()
    return an.localeCompare(bn, 'zh-Hans-CN')
  })
}

const sortedLocalRows = computed(() => sortFsRows(localRows.value, localSortBy.value))
const sortedSftpRows = computed(() => sortFsRows(sftpRows.value, remoteSortBy.value))
const sortedLeftSftpRows = computed(() => sortFsRows(leftSftpRows.value, localSortBy.value))
const sortedRightLocalRows = computed(() => sortFsRows(rightLocalRows.value, remoteSortBy.value))

const filterFsRowsByKeyword = (rows: any[], keyword: string, nameKey: 'name' | 'filename') => {
  const q = String(keyword || '').trim().toLowerCase()
  if (!q) return rows
  return rows.filter((item) => String(item?.[nameKey] || '').toLowerCase().includes(q))
}

const leftDisplayRows = computed(() => {
  const source = leftPanelMode.value === 'local' ? sortedLocalRows.value : sortedLeftSftpRows.value
  return filterFsRowsByKeyword(source, leftFileKeyword.value, leftPanelMode.value === 'local' ? 'name' : 'filename')
})

const rightDisplayRows = computed(() => {
  const source = rightPanelMode.value === 'remote' ? sortedSftpRows.value : sortedRightLocalRows.value
  return filterFsRowsByKeyword(source, rightFileKeyword.value, rightPanelMode.value === 'remote' ? 'filename' : 'name')
})

const groupHostsByCategory = (categoryFilter: string, keyword: string) => {
  const normalizedKeyword = String(keyword || '').trim().toLowerCase()
  const grouped = new Map<string, any[]>()
  hostItems.value.forEach((host) => {
    const category = String(host?.category || DEFAULT_CATEGORY).trim() || DEFAULT_CATEGORY
    if (categoryFilter !== ALL_CATEGORY && category !== categoryFilter) return
    if (normalizedKeyword) {
      const hit = [host?.name, host?.host, host?.username, category]
        .some((value) => String(value || '').toLowerCase().includes(normalizedKeyword))
      if (!hit) return
    }
    if (!grouped.has(category)) grouped.set(category, [])
    grouped.get(category)!.push(host)
  })

  return [...grouped.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'zh-Hans-CN'))
    .map(([category, items]) => ({
      category,
      items: [...items].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), 'zh-Hans-CN')),
    }))
}

const leftConnectGroups = computed(() => groupHostsByCategory(leftConnectCategory.value, leftConnectKeyword.value))
const rightConnectGroups = computed(() => groupHostsByCategory(rightConnectCategory.value, rightConnectKeyword.value))

const sftpTransferModeLabel = computed(() => (rightPanelMode.value === 'remote' ? 'SFTP 双向' : '本地浏览'))
const leftPanelStateLabel = computed(() => (leftPanelMode.value === 'local' ? '本地' : '远程'))
const rightPanelStateLabel = computed(() => (rightPanelMode.value === 'local' ? '本地' : '远程'))

const hostLabelById = (id: string) => {
  const host = hostItems.value.find((h) => h.id === id)
  return host ? `${host.name} (${host.host})` : '未连接'
}

const leftLinkLabel = computed(() => {
  if (leftPanelMode.value === 'local') return '本地目录'
  if (!leftSftpHostId.value) return '未连接'
  return hostLabelById(leftSftpHostId.value)
})

const rightLinkLabel = computed(() => {
  if (rightPanelMode.value === 'local') return '本地目录'
  if (!sftpHostId.value || sftpHostId.value === 'local') return '未连接'
  return hostLabelById(sftpHostId.value)
})

const isWindowsClient = computed(() => {
  if (typeof navigator === 'undefined') return false
  return /win/i.test(navigator.platform || '')
})

const leftLocalPathDisplay = computed(() => (isWindowsClient.value ? (localPath.value || '盘符列表') : (localPath.value || '/')))
const rightLocalPathDisplay = computed(() => (isWindowsClient.value ? (rightLocalPath.value || '盘符列表') : (rightLocalPath.value || '/')))

const getLocalParentPath = (rawPath: string) => {
  const source = String(rawPath || '').trim()
  if (!source) return ''

  const normalized = source.replace(/\\/g, '/').replace(/\/+$/, '')
  const isWindowsDrivePath = /^[a-zA-Z]:/.test(normalized)

  if (isWindowsDrivePath) {
    if (/^[a-zA-Z]:$/.test(normalized)) return ''
    const lastSlash = normalized.lastIndexOf('/')
    if (lastSlash <= 2) return ''
    return normalized.slice(0, lastSlash)
  }

  if (normalized === '/') return '/'
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash < 0) return ''
  if (lastSlash === 0) return '/'
  return normalized.slice(0, lastSlash)
}

const vaultMaster = ref('')
const vaultStatus = ref('')
const bridgeReady = ref(typeof window !== 'undefined' && !!window.lightterm)
const vaultInitialized = ref(false)
const vaultUnlocked = ref(false)
const vaultItems = ref<any[]>([])
const selectedVaultKeyId = ref('')
const vaultKeyword = ref('')
const vaultKeyName = ref('')
const vaultPrivateKey = ref('')
const vaultPublicKey = ref('')
const vaultCertificate = ref('')
const vaultKeyType = ref('auto')
const vaultEditorVisible = ref(true)

const filteredVaultItems = computed(() => {
  const keyword = vaultKeyword.value.trim().toLowerCase()
  if (!keyword) return vaultItems.value
  return vaultItems.value.filter((k) =>
    [k.name, k.type, k.fingerprint].some((v) => String(v || '').toLowerCase().includes(keyword))
  )
})

const snippetCategories = computed(() => {
  const set = new Set<string>([SNIPPET_DEFAULT_CATEGORY])
  snippetItems.value.forEach((item) => set.add(item.category || SNIPPET_DEFAULT_CATEGORY))
  snippetExtraCategories.value.forEach((c) => set.add(c))
  return Array.from(set)
})

const displaySnippetCategories = computed(() => [SNIPPET_ALL_CATEGORY, ...snippetCategories.value])

const filteredSnippetItems = computed(() => {
  const keyword = snippetKeyword.value.trim().toLowerCase()
  return snippetItems.value
    .filter((item) => {
      const inCategory = snippetCategory.value === SNIPPET_ALL_CATEGORY || item.category === snippetCategory.value
      if (!inCategory) return false
      if (!keyword) return true
      return [item.name, item.description, item.commands].some((v) => String(v || '').toLowerCase().includes(keyword))
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
})

const currentSessionHostId = computed(() => {
  const host = hostItems.value.find((h) =>
    h.host === sshForm.value.host
    && Number(h.port || 22) === Number(sshForm.value.port || 22)
    && h.username === sshForm.value.username
  )
  return host?.id || ''
})

const terminalSnippetItems = computed(() => {
  const currentHostId = currentSessionHostId.value
  return [...snippetItems.value].sort((a, b) => {
    const aMatched = !!currentHostId && a.hostId === currentHostId
    const bMatched = !!currentHostId && b.hostId === currentHostId
    if (aMatched !== bMatched) return aMatched ? -1 : 1
    return b.updatedAt - a.updatedAt
  })
})

const updateInfo = ref({
  status: 'idle',
  message: '等待检查更新',
  currentVersion: '',
  latestVersion: '',
  source: 'github',
  hasUpdate: false,
  downloaded: false,
  checking: false,
  downloading: false,
  progress: 0,
  downloadUrl: '',
  releaseUrl: '',
})

type UpdateStatePayload = Partial<{
  status: string
  message: string
  currentVersion: string
  latestVersion: string
  source: string
  hasUpdate: boolean
  downloaded: boolean
  checking: boolean
  downloading: boolean
  progress: number
  downloadUrl: string
  releaseUrl: string
}>
type UpdateActionResult = { ok: boolean; error?: string }

const updateActionBusy = ref(false)
const serialPortsLoaded = ref(false)
const hostsLoaded = ref(false)
const vaultKeysLoaded = ref(false)
const updateStateLoaded = ref(false)
const localFsLoaded = ref(false)
const rightLocalFsLoaded = ref(false)
const isMacClient = computed(() => /mac/i.test(navigator.platform || ''))
const showManualMacUpdate = computed(() => (
  isMacClient.value
  && updateInfo.value.hasUpdate
  && !updateInfo.value.downloaded
  && !!updateInfo.value.downloadUrl
  && /手动安装|DMG/i.test(updateInfo.value.message || '')
))
const updateStatusText = computed(() => {
  const u = updateInfo.value
  const current = u.currentVersion || '-'
  const latest = u.latestVersion || '-'
  const sourceLabel = 'GitHub'
  return `当前版本：${current} ｜ 最新版本：${latest} ｜ 更新源：${sourceLabel} ｜ ${u.message || '就绪'}`
})

type SnippetItem = {
  id: string
  name: string
  category: string
  hostId: string
  description: string
  commands: string
  createdAt: number
  updatedAt: number
}

const createEmptySnippet = (): SnippetItem => ({
  id: '',
  name: '',
  category: SNIPPET_DEFAULT_CATEGORY,
  hostId: '',
  description: '',
  commands: '',
  createdAt: 0,
  updatedAt: 0,
})

const snippetItems = ref<SnippetItem[]>([])
const snippetsLoaded = ref(false)
const snippetKeyword = ref('')
const snippetCategory = ref(SNIPPET_ALL_CATEGORY)
const snippetStatus = ref('')
const snippetRunDelayMs = ref(1200)
const snippetRunning = ref(false)
const snippetStopRequested = ref(false)
const selectedSnippetId = ref('')
const snippetEditorVisible = ref(true)
const snippetEdit = ref<SnippetItem>(createEmptySnippet())
const snippetExtraCategories = ref<string[]>([])
const newSnippetCategoryName = ref('')
const newSnippetCategoryInputVisible = ref(false)
const terminalSnippetId = ref('')
type TerminalEncoding = 'utf-8' | 'gb18030'
const terminalEncoding = ref<TerminalEncoding>('utf-8')
const terminalDecoders = new Map<string, TextDecoder>()

const storageDbPath = ref('')
const storagePathInput = ref('')
const storageMsg = ref('')
const storageMetaText = ref('')
const backupItems = ref<Array<{ name: string; path: string; size: number; mtimeMs: number }>>([])
const selectedBackupPath = ref('')
const startupGateVisible = ref(true)
const startupGateMode = ref<'loading' | 'select' | 'init' | 'unlock'>('loading')
const startupGateBusy = ref(false)
const startupGateError = ref('')
const startupDbPath = ref('')
const startupMasterConfirm = ref('')
const startupTasksLoaded = ref(false)

const serialPorts = ref<any[]>([])
const serialBaudRates = [
  50, 75, 110, 134, 150, 200, 300,
  600, 1200, 1800, 2400, 4800, 9600,
  19200, 38400, 57600, 115200, 230400,
]
const serialForm = ref<{ path: string; baudRate: number; dataBits: number; stopBits: number; parity: 'none' | 'even' | 'odd' }>({
  path: '', baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none',
})
const serialBaudPreset = ref('9600')
const serialSendText = ref('')
const serialHexMode = ref(false)
const serialTimerMs = ref(0)
const serialFlowControl = ref<'none' | 'rtscts' | 'dsrdtr' | 'xonxoff'>('none')
const serialAdvancedOpen = ref(false)
const serialConnected = ref(false)
const serialCurrentPath = ref('')
type SerialDialogItem = {
  id: string
  ts: number
  type: 'tx' | 'rx' | 'sys' | 'err'
  text: string
}
const serialDialogLogs = ref<SerialDialogItem[]>([])
let serialTimer: number | null = null

type LocalTabItem = {
  id: string
  sessionId: string
  name: string
  cwd: string
  connected: boolean
  status: string
}

const localTabs = ref<LocalTabItem[]>([])
const activeLocalTabId = ref('')
const localBufferBySession = ref<Record<string, string>>({})
const localCwd = ref('')
const localStatus = ref('未连接')
const localShellType = ref<'auto' | 'cmd' | 'powershell'>('auto')
const localElevated = ref(false)

const activeLocalTab = computed(() => localTabs.value.find((tab) => tab.id === activeLocalTabId.value) || null)
const activeLocalSessionId = computed(() => activeLocalTab.value?.sessionId || '')
const localConnected = computed(() => !!activeLocalTab.value?.connected)

type LocalQuickItem = {
  id: string
  category: string
  label: string
  cmd: string
}

const defaultLocalQuickItems: LocalQuickItem[] = [
  { id: 'lq-sysinfo', category: '系统', label: '系统信息', cmd: 'uname -a' },
  { id: 'lq-disk', category: '系统', label: '磁盘占用', cmd: 'df -h' },
  { id: 'lq-list', category: '文件', label: '目录列表', cmd: 'ls -la' },
  { id: 'lq-proc', category: '系统', label: '进程快照', cmd: 'ps aux | head -n 20' },
]

const localQuickItems = ref<LocalQuickItem[]>([...defaultLocalQuickItems])
const localQuickCategory = ref('全部')
const localQuickEditId = ref('')
const localQuickEditorVisible = ref(false)
const localQuickDraftCategory = ref('系统')
const localQuickDraftLabel = ref('')
const localQuickDraftCmd = ref('')

const localQuickCategories = computed(() => {
  const set = new Set<string>(['全部'])
  localQuickItems.value.forEach((item) => set.add(item.category || '未分类'))
  return [...set]
})

const filteredLocalQuickItems = computed(() => {
  if (localQuickCategory.value === '全部') return localQuickItems.value
  return localQuickItems.value.filter((item) => item.category === localQuickCategory.value)
})

const saveLocalQuickItems = () => {
  try { localStorage.setItem('astrashell.localQuickTools.v1', JSON.stringify(localQuickItems.value)) } catch {}
}

const restoreLocalQuickItems = () => {
  try {
    const raw = localStorage.getItem('astrashell.localQuickTools.v1')
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      const normalized = parsed
        .map((item: any) => ({
          id: String(item?.id || `lq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`),
          category: String(item?.category || '未分类').trim() || '未分类',
          label: String(item?.label || '').trim(),
          cmd: String(item?.cmd || '').trim(),
        }))
        .filter((item: LocalQuickItem) => item.label && item.cmd)
      if (normalized.length > 0) localQuickItems.value = normalized
    }
  } catch {}
}

const startEditLocalQuickItem = (item: LocalQuickItem) => {
  localQuickEditId.value = item.id
  localQuickDraftCategory.value = item.category || '系统'
  localQuickDraftLabel.value = item.label
  localQuickDraftCmd.value = item.cmd
  localQuickEditorVisible.value = true
}

const resetLocalQuickDraft = () => {
  localQuickEditId.value = ''
  localQuickDraftCategory.value = localQuickCategory.value === '全部' ? '系统' : localQuickCategory.value
  localQuickDraftLabel.value = ''
  localQuickDraftCmd.value = ''
}

const openLocalQuickCreate = () => {
  resetLocalQuickDraft()
  localQuickEditorVisible.value = true
}

const closeLocalQuickEditor = () => {
  localQuickEditorVisible.value = false
}

const saveLocalQuickDraft = () => {
  const category = String(localQuickDraftCategory.value || '').trim() || '未分类'
  const label = String(localQuickDraftLabel.value || '').trim()
  const cmd = String(localQuickDraftCmd.value || '').trim()
  if (!label || !cmd) {
    localStatus.value = '快捷工具保存失败：名称和命令不能为空'
    return
  }

  if (localQuickEditId.value) {
    const row = localQuickItems.value.find((item) => item.id === localQuickEditId.value)
    if (row) {
      row.category = category
      row.label = label
      row.cmd = cmd
    }
  } else {
    localQuickItems.value.unshift({
      id: `lq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      category,
      label,
      cmd,
    })
  }
  saveLocalQuickItems()
  resetLocalQuickDraft()
  localQuickEditorVisible.value = false
}

const removeLocalQuickItem = (id: string) => {
  localQuickItems.value = localQuickItems.value.filter((item) => item.id !== id)
  saveLocalQuickItems()
  if (localQuickEditId.value === id) resetLocalQuickDraft()
}

const saveSessionRestoreState = (payload: any) => {
  try { localStorage.setItem('astrashell.session.restore.v1', JSON.stringify(payload || {})) } catch {}
}

const clearSessionRestoreState = () => {
  try { localStorage.removeItem('astrashell.session.restore.v1') } catch {}
}

const restoreSessionRestoreState = () => {
  try {
    const raw = localStorage.getItem('astrashell.session.restore.v1')
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

type AuditLogItem = {
  id: string
  ts: number
  source: string
  action: string
  target: string
  content: string
  level?: string
}
const auditLogs = ref<AuditLogItem[]>([])
const auditLoaded = ref(false)
const auditStatus = ref('')
const auditKeyword = ref('')
const auditSource = ref('all')
const selectedAuditTarget = ref('')
const sessionRestoreTried = ref(false)

const resolveAuditTarget = (item: AuditLogItem) => {
  const rawTarget = String(item?.target || '').trim() || '未命名目标'
  if (String(item?.source || '') !== 'ssh') return rawTarget
  const match = rawTarget.match(/^(.+?)\s+\([^()]+\)$/)
  return match?.[1]?.trim() || rawTarget
}

const auditTargetGroups = computed(() => {
  const map = new Map<string, { target: string; count: number; lastTs: number; source: string }>()
  auditLogs.value.forEach((item) => {
    const target = resolveAuditTarget(item)
    const prev = map.get(target)
    const ts = Number(item?.ts || 0)
    if (!prev) {
      map.set(target, { target, count: 1, lastTs: ts, source: String(item?.source || 'app') })
      return
    }
    prev.count += 1
    if (ts > prev.lastTs) prev.lastTs = ts
  })
  return [...map.values()].sort((a, b) => b.lastTs - a.lastTs)
})

const currentAuditLogs = computed(() => {
  const target = selectedAuditTarget.value
  if (!target) return []
  return auditLogs.value.filter((item) => resolveAuditTarget(item) === target)
})


const serialTimerActive = computed(() => !!serialTimer)
const serialConnectionInfo = computed(() => {
  if (!serialConnected.value || !serialCurrentPath.value) return '未连接'
  return `${serialCurrentPath.value} · ${serialForm.value.baudRate} bps`
})

const pushSerialDialog = (type: SerialDialogItem['type'], rawText: string) => {
  const text = String(rawText || '').replace(/\r/g, '')
  if (!text.trim()) return
  const lines = text.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim().length > 0)
  for (const line of lines) {
    serialDialogLogs.value.unshift({
      id: `serial-log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      ts: Date.now(),
      type,
      text: line,
    })
  }
  if (serialDialogLogs.value.length > 500) serialDialogLogs.value = serialDialogLogs.value.slice(0, 500)
}

let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
const terminalFontStackTech = '"Maple Mono NF CN","Sarasa Mono SC","JetBrains Mono","Cascadia Mono","SF Mono","Menlo","PingFang SC","Microsoft YaHei UI",monospace'
const terminalFontStackLight = '"Sarasa Mono SC","JetBrains Mono","Cascadia Mono","SF Mono","Menlo","PingFang SC","Microsoft YaHei UI",monospace'

watch(focusTerminal, (value) => {
  if (value && !snippetsLoaded.value) void restoreSnippets()
  nextTick(() => {
    initTerminal()
    fitAddon?.fit()
    if (value) terminal?.focus()
  })
})

watch(activeTerminalMode, () => {
  nextTick(() => {
    initTerminal()
    applyTerminalTheme()
    fitAddon?.fit()
    if (focusTerminal.value) terminal?.focus()
  })
})

watch(snippetItems, (items) => {
  if (!items.some((item) => item.id === terminalSnippetId.value)) {
    terminalSnippetId.value = items[0]?.id || ''
  }
}, { immediate: true })

watch(auditTargetGroups, (groups) => {
  if (groups.length === 0) {
    selectedAuditTarget.value = ''
    return
  }
  if (!groups.some((item) => item.target === selectedAuditTarget.value)) {
    selectedAuditTarget.value = groups[0]?.target || ''
  }
}, { immediate: true })

watch(() => serialForm.value.baudRate, (value) => {
  const rate = Number(value || 0)
  serialBaudPreset.value = serialBaudRates.includes(rate) ? String(rate) : 'custom'
}, { immediate: true })

watch(serialBaudPreset, (value) => {
  if (value === 'custom') return
  const rate = Number(value || 0)
  if (Number.isFinite(rate) && rate > 0) serialForm.value.baudRate = rate
})

const normalizeTerminalEncoding = (value: unknown): TerminalEncoding => (
  value === 'gb18030' ? 'gb18030' : 'utf-8'
)

const loadTerminalEncoding = () => {
  try {
    terminalEncoding.value = normalizeTerminalEncoding(localStorage.getItem(TERMINAL_ENCODING_STORAGE_KEY))
  } catch {
    terminalEncoding.value = 'utf-8'
  }
}

watch(terminalEncoding, (value) => {
  terminalDecoders.clear()
  try { localStorage.setItem(TERMINAL_ENCODING_STORAGE_KEY, value) } catch {}
})

const decoderCacheKey = (sessionId: string) => `${sessionId}::${terminalEncoding.value}`

const getTerminalDecoder = (sessionId: string) => {
  const key = decoderCacheKey(sessionId)
  const existing = terminalDecoders.get(key)
  if (existing) return existing
  const decoder = new TextDecoder(terminalEncoding.value)
  terminalDecoders.set(key, decoder)
  return decoder
}

const clearSessionDecoders = (sessionId: string) => {
  const prefix = `${sessionId}::`
  for (const key of [...terminalDecoders.keys()]) {
    if (key.startsWith(prefix)) terminalDecoders.delete(key)
  }
}

const decodeBase64Bytes = (base64: string) => {
  try {
    const raw = atob(base64)
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

const decodeSshPayload = (msg: { sessionId?: string; data?: string; dataBase64?: string }) => {
  const sessionId = String(msg?.sessionId || '')
  const rawText = String(msg?.data || '')
  const base64 = String(msg?.dataBase64 || '')
  if (!sessionId || !base64) return rawText
  const bytes = decodeBase64Bytes(base64)
  if (!bytes) return rawText
  try {
    return getTerminalDecoder(sessionId).decode(bytes, { stream: true })
  } catch {
    return rawText
  }
}

const terminalModeLabel = computed(() => (
  activeTerminalMode.value === 'ssh'
    ? 'SSH 终端'
    : activeTerminalMode.value === 'serial'
      ? '串口会话'
      : '本地终端'
))

const terminalTargetLabel = computed(() => {
  if (activeTerminalMode.value === 'ssh') {
    if (!sshSessionId.value) return '未连接'
    const tab = sshTabs.value.find((item) => item.id === sshSessionId.value)
    return tab?.name || sshSessionId.value
  }
  if (activeTerminalMode.value === 'serial') return serialCurrentPath.value || '未连接串口'
  return localStatus.value || '未连接'
})

const renderActiveSshBuffer = () => {
  if (!terminal) return
  const text = getSshBuffer(sshSessionId.value)
  terminal.reset()
  if (text) terminal.write(text)
  terminal.focus()
}

const {
  saveSshTabs,
  switchSshTab,
  createSshTab,
  ensureActiveSshSession,
  closeSshTab,
  restoreSshTabs,
} = useSshTabActions({
  sshTabs,
  sshSessionId,
  sshConnected,
  activeTerminalMode,
  focusTerminal,
  nav,
  sshBufferBySession,
  ensureSshBuffer,
  renderActiveSshBuffer,
  clearSessionDecoders,
})

const decodePlainPayload = (msg: { data?: string; dataBase64?: string }) => {
  const rawText = String(msg?.data || '')
  const base64 = String(msg?.dataBase64 || '')
  if (!base64) return rawText
  const bytes = decodeBase64Bytes(base64)
  if (!bytes) return rawText
  try {
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return rawText
  }
}

const applyTerminalTheme = () => {
  if (!terminal) return
  const techMode = activeTerminalMode.value !== 'ssh'
  if (techMode) {
    terminal.options.theme = {
      background: '#07101d',
      foreground: '#d9e7ff',
      cursor: '#22d3ee',
      selectionBackground: '#0ea5e980',
      selectionInactiveBackground: '#1d4ed880',
    }
    terminal.options.fontFamily = terminalFontStackTech
    terminal.options.fontSize = 14
    terminal.options.fontWeight = 500
    terminal.options.lineHeight = 1.24
    return
  }
  terminal.options.theme = {
    background: '#f8fafc',
    foreground: '#111827',
    cursor: '#2563eb',
    selectionBackground: '#2563ebc0',
    selectionInactiveBackground: '#60a5fa88',
  }
  terminal.options.fontFamily = terminalFontStackLight
  terminal.options.fontSize = 13
  terminal.options.fontWeight = 500
  terminal.options.lineHeight = 1.2
}

const writeActiveTerminalInput = async (data: string) => {
  if (!data) return
  if (activeTerminalMode.value === 'ssh') {
    if (!sshConnected.value) return
    await window.lightterm.sshWrite({ sessionId: sshSessionId.value, data })
    return
  }
  if (activeTerminalMode.value === 'serial') {
    if (!serialConnected.value || !serialCurrentPath.value) return
    await window.lightterm.sendSerial({ path: serialCurrentPath.value, data, isHex: false })
    return
  }
  if (!localConnected.value || !activeLocalSessionId.value) return
  const res = await window.lightterm.localWrite({ sessionId: activeLocalSessionId.value, data })
  if (!res.ok) {
    localStatus.value = `本地终端写入失败：${res.error || '未知错误'}`
    terminal?.writeln(`\r\n[本地终端写入失败] ${res.error || '未知错误'}`)
  }
}

const syncLocalTerminalSize = async () => {
  if (!terminal || !localConnected.value || !activeLocalSessionId.value) return
  await window.lightterm.localResize({
    sessionId: activeLocalSessionId.value,
    cols: terminal.cols,
    rows: terminal.rows,
  })
}

const initTerminal = () => {
  if (!termEl.value || terminal) return
  terminal = new Terminal({
    convertEol: true,
    fontSize: 13,
    fontFamily: terminalFontStackLight,
    fontWeight: 500,
    lineHeight: 1.2,
    rightClickSelectsWord: true,
    theme: {
      background: '#f8fafc',
      foreground: '#111827',
      cursor: '#2563eb',
      selectionBackground: '#2563ebc0',
      selectionInactiveBackground: '#60a5fa88',
    },
  })
  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(termEl.value)
  fitAddon.fit()
  terminal.focus()
  applyTerminalTheme()
  termEl.value.addEventListener('click', () => terminal?.focus())
  // 启动提示改到状态栏，不占终端可视面积

  terminal.onData((data) => {
    void writeActiveTerminalInput(data)
  })
  window.lightterm.onSshData((msg) => {
    const sessionId = String(msg?.sessionId || '')
    if (!sessionId) return
    const text = decodeSshPayload(msg)
    appendSshBuffer(sessionId, text)
    if (sessionId === sshSessionId.value && activeTerminalMode.value === 'ssh') terminal?.write(text)
  })
  window.lightterm.onSshClose((msg) => {
    const tab = sshTabs.value.find((t) => t.id === msg.sessionId)
    if (tab) tab.connected = false
    saveSshTabs()
    clearSessionDecoders(msg.sessionId)
    if (!sshTabs.value.some((t) => t.connected)) clearSessionRestoreState()
    if (msg.sessionId === sshSessionId.value) {
      sshConnected.value = false
      if (activeTerminalMode.value === 'ssh') terminal?.writeln('\r\n[SSH 已断开]')
    }
  })
  window.lightterm.onSshError((msg) => {
    if (msg.sessionId === sshSessionId.value && activeTerminalMode.value === 'ssh') {
      terminal?.writeln(`\r\n[SSH 错误] ${msg.error}`)
    }
  })
  window.lightterm.onSerialData((msg) => {
    if (msg.path !== serialCurrentPath.value) return
    pushSerialDialog('rx', String(msg.data || ''))
    if (activeTerminalMode.value === 'serial') terminal?.write(String(msg.data || ''))
  })
  window.lightterm.onSerialError((msg) => {
    if (msg.path !== serialCurrentPath.value) return
    sshStatus.value = `串口异常：${msg.error || '未知错误'}`
    pushSerialDialog('err', String(msg.error || '串口异常'))
    if (activeTerminalMode.value === 'serial') terminal?.writeln(`\r\n[串口错误] ${msg.error || '未知错误'}`)
  })
  window.lightterm.onLocalData((msg) => {
    const sessionId = String(msg?.sessionId || '')
    if (!sessionId) return
    const text = decodePlainPayload(msg)
    localBufferBySession.value[sessionId] = `${localBufferBySession.value[sessionId] || ''}${text}`
    if (sessionId !== activeLocalSessionId.value) return
    if (activeTerminalMode.value !== 'local') return
    terminal?.write(text)
  })
  window.lightterm.onLocalClose((msg) => {
    const sessionId = String(msg?.sessionId || '')
    if (!sessionId) return
    const tab = localTabs.value.find((item) => item.sessionId === sessionId)
    if (!tab) return
    tab.connected = false
    tab.status = `本地终端已断开（code=${Number(msg?.code || 0)}）`
    if (sessionId === activeLocalSessionId.value) {
      localStatus.value = tab.status
      if (activeTerminalMode.value === 'local') terminal?.writeln(`\r\n[本地终端已断开] code=${Number(msg?.code || 0)}`)
    }
  })
  window.lightterm.onLocalError((msg) => {
    const sessionId = String(msg?.sessionId || '')
    if (!sessionId) return
    const tab = localTabs.value.find((item) => item.sessionId === sessionId)
    if (!tab) return
    tab.status = `本地终端错误：${msg?.error || '未知错误'}`
    if (sessionId === activeLocalSessionId.value) {
      localStatus.value = tab.status
      if (activeTerminalMode.value === 'local') terminal?.writeln(`\r\n[本地终端错误] ${msg?.error || '未知错误'}`)
    }
  })
}

const buildDefaultDockerSnippet = (): SnippetItem => ({
  id: `snippet-${Date.now().toString(36)}-docker`,
  name: '部署 Docker（Debian/Ubuntu）',
  category: SNIPPET_DEFAULT_CATEGORY,
  hostId: '',
  description: '安装 Docker CE、启动服务并加入当前用户组。',
  commands: [
    'sudo apt-get update',
    'sudo apt-get install -y ca-certificates curl gnupg',
    'sudo install -m 0755 -d /etc/apt/keyrings',
    'curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg',
    'sudo chmod a+r /etc/apt/keyrings/docker.gpg',
    'echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null',
    'sudo apt-get update',
    'sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin',
    'sudo systemctl enable docker --now',
    'sudo usermod -aG docker $USER',
    'docker --version',
  ].join('\n'),
  createdAt: Date.now(),
  updatedAt: Date.now(),
})

const readLegacySnippets = () => {
  try {
    const raw = localStorage.getItem(LEGACY_SNIPPET_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { items?: SnippetItem[]; extraCategories?: string[] }
    return {
      items: Array.isArray(parsed?.items) ? parsed.items : [],
      extraCategories: Array.isArray(parsed?.extraCategories) ? parsed.extraCategories : [],
    }
  } catch {
    return null
  }
}

const mergeSnippetSources = (
  remoteItems: SnippetItem[],
  remoteCategories: string[],
  legacyItems: SnippetItem[],
  legacyCategories: string[],
) => {
  const merged = [...remoteItems]
  let changed = false

  for (const item of legacyItems) {
    const legacyName = String(item?.name || '').trim()
    const legacyCommands = String(item?.commands || '').trim()
    if (!legacyName || !legacyCommands) continue

    const index = merged.findIndex((current) => (
      current.id === item.id
      || (
        String(current?.name || '').trim() === legacyName
        && String(current?.commands || '').trim() === legacyCommands
      )
    ))

    if (index === -1) {
      merged.push({ ...item })
      changed = true
      continue
    }

    if (Number(item.updatedAt || 0) > Number(merged[index]?.updatedAt || 0)) {
      merged[index] = { ...merged[index], ...item }
      changed = true
    }
  }

  const extraCategories = [...new Set([...remoteCategories, ...legacyCategories].map((value) => String(value || '').trim()).filter(Boolean))]
  if (extraCategories.length !== remoteCategories.length) changed = true

  return {
    items: merged.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)),
    extraCategories,
    changed,
  }
}

const applySnippetState = (items: SnippetItem[], extraCategories: string[]) => {
  snippetItems.value = [...items].sort((a, b) => b.updatedAt - a.updatedAt)
  snippetExtraCategories.value = [...new Set(extraCategories.filter(Boolean))]
}

const saveSnippetState = async (items = snippetItems.value, extraCategories = snippetExtraCategories.value) => {
  const plainItems = (Array.isArray(items) ? items : []).map((item) => ({
    id: String(item?.id || ''),
    name: String(item?.name || ''),
    category: String(item?.category || ''),
    hostId: String(item?.hostId || ''),
    description: String(item?.description || ''),
    commands: String(item?.commands || ''),
    createdAt: Number(item?.createdAt || 0),
    updatedAt: Number(item?.updatedAt || 0),
  }))
  const plainExtraCategories = (Array.isArray(extraCategories) ? extraCategories : []).map((value) => String(value || ''))
  const res = await window.lightterm.snippetsSetState({ items: plainItems, extraCategories: plainExtraCategories })
  if (!res.ok) {
    snippetStatus.value = `代码片段保存失败：${res.error || '未知错误'}`
    return false
  }
  applySnippetState((res.items || []) as SnippetItem[], res.extraCategories || [])
  return true
}

const restoreSnippets = async () => {
  try {
    const res = await window.lightterm.snippetsGetState()
    if (!res.ok) {
      applySnippetState([buildDefaultDockerSnippet()], [])
      await saveSnippetState()
      return
    }

    const remoteItems = Array.isArray(res.items) ? (res.items as SnippetItem[]) : []
    const remoteCategories = Array.isArray(res.extraCategories) ? res.extraCategories : []
    const legacy = readLegacySnippets()
    if (legacy && (legacy.items.length > 0 || legacy.extraCategories.length > 0)) {
      const merged = mergeSnippetSources(remoteItems, remoteCategories, legacy.items, legacy.extraCategories)
      applySnippetState(merged.items, merged.extraCategories)
      if (merged.changed || remoteItems.length === 0) {
        await saveSnippetState(merged.items, merged.extraCategories)
        snippetStatus.value = remoteItems.length > 0 || remoteCategories.length > 0
          ? '已合并本机旧版代码片段到共享数据库'
          : '已迁移本机旧版代码片段到共享数据库'
      }
      try { localStorage.removeItem(LEGACY_SNIPPET_STORAGE_KEY) } catch {}
      return
    }

    if (remoteItems.length > 0 || remoteCategories.length > 0) {
      applySnippetState(remoteItems, remoteCategories)
      return
    }

    applySnippetState([buildDefaultDockerSnippet()], [])
    await saveSnippetState()
  } finally {
    snippetsLoaded.value = true
  }
}

const openSnippetEditor = (item: SnippetItem) => {
  selectedSnippetId.value = item.id
  snippetEdit.value = { ...item }
  snippetEditorVisible.value = true
}

const clearSnippetEditor = () => {
  selectedSnippetId.value = ''
  snippetEdit.value = createEmptySnippet()
  snippetEditorVisible.value = true
}

const beginAddSnippetCategory = () => {
  newSnippetCategoryInputVisible.value = true
  newSnippetCategoryName.value = ''
}

const addSnippetCategory = async () => {
  const name = newSnippetCategoryName.value.trim()
  if (!name) {
    newSnippetCategoryInputVisible.value = false
    return
  }
  if (!snippetCategories.value.includes(name) && !snippetExtraCategories.value.includes(name)) {
    snippetExtraCategories.value.push(name)
    await saveSnippetState()
  }
  snippetCategory.value = name
  snippetEdit.value.category = name
  newSnippetCategoryName.value = ''
  newSnippetCategoryInputVisible.value = false
}

const saveSnippet = async () => {
  const draft = snippetEdit.value
  const name = draft.name.trim()
  const commands = draft.commands.trim()
  if (!name) {
    snippetStatus.value = '请填写片段名称'
    return
  }
  if (!commands) {
    snippetStatus.value = '请至少填写一条命令'
    return
  }
  const now = Date.now()
  const next: SnippetItem = {
    ...draft,
    id: draft.id || `snippet-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    category: draft.category || SNIPPET_DEFAULT_CATEGORY,
    hostId: draft.hostId || '',
    description: draft.description || '',
    commands,
    createdAt: draft.createdAt || now,
    updatedAt: now,
  }
  const idx = snippetItems.value.findIndex((s) => s.id === next.id)
  if (idx >= 0) {
    snippetItems.value.splice(idx, 1, next)
  } else {
    snippetItems.value.unshift(next)
  }
  selectedSnippetId.value = next.id
  snippetEdit.value = { ...next }
  await saveSnippetState()
  snippetStatus.value = `片段已保存：${next.name}`
}

const deleteSnippet = async () => {
  const id = selectedSnippetId.value || snippetEdit.value.id
  if (!id) return
  const target = snippetItems.value.find((item) => item.id === id)
  if (!target) return
  const confirmed = window.confirm(`确定删除代码片段「${target.name}」吗？`)
  if (!confirmed) return
  snippetItems.value = snippetItems.value.filter((item) => item.id !== id)
  await saveSnippetState()
  clearSnippetEditor()
  snippetStatus.value = '片段已删除'
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

const snippetCommandLines = (commands: string) => (
  commands
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !!line && !line.startsWith('#'))
)

const ensureSnippetSession = async (target: SnippetItem) => {
  if (target.hostId) {
    const host = hostItems.value.find((h) => h.id === target.hostId)
    if (!host) {
      snippetStatus.value = '片段绑定的主机不存在，请重新选择'
      return false
    }
    const sameHost = sshConnected.value
      && sshForm.value.host === host.host
      && Number(sshForm.value.port || 22) === Number(host.port || 22)
      && sshForm.value.username === host.username
    if (!sameHost) {
      useHost(host)
      await connectSSH({ keepNav: true })
      if (!sshConnected.value) {
        snippetStatus.value = '目标主机连接失败，已停止执行'
        return false
      }
    }
  } else if (!sshConnected.value) {
    snippetStatus.value = '请先连接 SSH，或在片段里绑定目标主机'
    return false
  }
  return true
}

const runSnippet = async (item?: SnippetItem) => {
  const target = item || snippetItems.value.find((s) => s.id === selectedSnippetId.value) || snippetEdit.value
  if (!target?.id && !target?.commands?.trim()) {
    snippetStatus.value = '请先选择或创建代码片段'
    return
  }
  if (snippetRunning.value) {
    snippetStatus.value = '已有片段在执行中'
    return
  }
  const commands = snippetCommandLines(target.commands || '')
  if (commands.length === 0) {
    snippetStatus.value = '没有可执行命令（空行和 # 注释会自动跳过）'
    return
  }
  const ready = await ensureSnippetSession(target)
  if (!ready) return

  snippetRunning.value = true
  snippetStopRequested.value = false
  const delayMs = Math.max(200, Number(snippetRunDelayMs.value || 0))
  snippetStatus.value = `开始执行：${target.name || '未命名片段'}（共 ${commands.length} 条）`

  let sent = 0
  for (let i = 0; i < commands.length; i += 1) {
    if (snippetStopRequested.value) {
      snippetStatus.value = `已停止：${target.name || '未命名片段'}（已发送 ${sent}/${commands.length}）`
      break
    }
    const cmd = commands[i]
    snippetStatus.value = `执行中 ${i + 1}/${commands.length}：${cmd}`
    const res = await window.lightterm.sshWrite({ sessionId: sshSessionId.value, data: `${cmd}\n` })
    if (!res.ok) {
      snippetStatus.value = `第 ${i + 1} 条发送失败：${res.error || '未知错误'}`
      break
    }
    sent += 1
    if (i < commands.length - 1) await sleep(delayMs)
  }

  if (!snippetStopRequested.value && sent === commands.length) {
    snippetStatus.value = `发送完成：${target.name || '未命名片段'}（${commands.length} 条）`
  }
  snippetRunning.value = false
  snippetStopRequested.value = false
}

const stopSnippet = () => {
  if (!snippetRunning.value) return
  snippetStopRequested.value = true
}

const snippetHostLabel = (hostId: string) => {
  if (!hostId) return '当前 SSH 会话'
  const host = hostItems.value.find((h) => h.id === hostId)
  return host ? `${host.name} (${host.host})` : '未找到主机'
}

const getTerminalSnippet = () => {
  if (terminalSnippetId.value) {
    const matched = snippetItems.value.find((item) => item.id === terminalSnippetId.value)
    if (matched) return matched
  }
  if (selectedSnippetId.value) {
    const selected = snippetItems.value.find((item) => item.id === selectedSnippetId.value)
    if (selected) return selected
  }
  return terminalSnippetItems.value[0] || null
}

const runTerminalSnippet = async () => {
  const target = getTerminalSnippet()
  if (!target) {
    snippetStatus.value = '没有可执行的代码片段'
    return
  }
  if (activeTerminalMode.value === 'ssh') {
    await runSnippet(target)
    terminal?.focus()
    return
  }

  if (activeTerminalMode.value === 'serial') {
    if (!serialConnected.value || !serialCurrentPath.value) {
      snippetStatus.value = '请先连接串口'
      return
    }
    const lines = snippetCommandLines(target.commands || '')
    if (lines.length === 0) {
      snippetStatus.value = '没有可执行命令（空行和 # 注释会自动跳过）'
      return
    }
    snippetRunning.value = true
    snippetStopRequested.value = false
    let sent = 0
    const delayMs = Math.max(100, Number(snippetRunDelayMs.value || 0))
    for (let i = 0; i < lines.length; i += 1) {
      if (snippetStopRequested.value) break
      const cmd = lines[i]
      const res = await window.lightterm.sendSerial({ path: serialCurrentPath.value, data: `${cmd}\r\n`, isHex: false })
      if (!res.ok) {
        snippetStatus.value = `串口发送失败：${res.error || '未知错误'}`
        break
      }
      sent += 1
      if (i < lines.length - 1) await sleep(delayMs)
    }
    snippetRunning.value = false
    snippetStopRequested.value = false
    snippetStatus.value = sent === lines.length ? `串口发送完成：${target.name}` : `串口已发送 ${sent}/${lines.length}`
    terminal?.focus()
    return
  }

  if (!localConnected.value || !activeLocalSessionId.value) {
    snippetStatus.value = '请先连接本地终端'
    return
  }
  const commands = snippetCommandLines(target.commands || '')
  if (commands.length === 0) {
    snippetStatus.value = '没有可执行命令（空行和 # 注释会自动跳过）'
    return
  }
  snippetRunning.value = true
  snippetStopRequested.value = false
  const delayMs = Math.max(120, Number(snippetRunDelayMs.value || 0))
  let sent = 0
  for (let i = 0; i < commands.length; i += 1) {
    if (snippetStopRequested.value) break
    const cmd = commands[i]
    const res = await window.lightterm.localWrite({ sessionId: activeLocalSessionId.value, data: `${cmd}\n` })
    if (!res.ok) {
      snippetStatus.value = `本地执行失败：${res.error || '未知错误'}`
      break
    }
    sent += 1
    if (i < commands.length - 1) await sleep(delayMs)
  }
  snippetRunning.value = false
  snippetStopRequested.value = false
  snippetStatus.value = sent === commands.length ? `本地执行完成：${target.name}` : `本地已执行 ${sent}/${commands.length}`
  terminal?.focus()
}

const sendSnippetRawToTerminal = async () => {
  const target = getTerminalSnippet()
  if (!target) {
    snippetStatus.value = '没有可发送的代码片段'
    return
  }
  const payload = target.commands || ''
  if (!payload.trim()) {
    snippetStatus.value = '片段内容为空'
    return
  }
  if (activeTerminalMode.value === 'ssh') {
    const ready = await ensureSnippetSession(target)
    if (!ready) return
  } else if (activeTerminalMode.value === 'serial' && (!serialConnected.value || !serialCurrentPath.value)) {
    snippetStatus.value = '请先连接串口'
    return
  } else if (activeTerminalMode.value === 'local' && (!localConnected.value || !activeLocalSessionId.value)) {
    snippetStatus.value = '请先连接本地终端'
    return
  }
  const res = activeTerminalMode.value === 'ssh'
    ? await window.lightterm.sshWrite({ sessionId: sshSessionId.value, data: payload })
    : activeTerminalMode.value === 'serial'
      ? await window.lightterm.sendSerial({ path: serialCurrentPath.value, data: payload, isHex: false })
      : await window.lightterm.localWrite({ sessionId: activeLocalSessionId.value, data: payload })
  snippetStatus.value = res.ok ? `片段原文已发送：${target.name}` : `片段发送失败：${res.error || '未知错误'}`
  terminal?.focus()
}

const readClipboardText = async () => {
  const res = await window.lightterm.clipboardRead()
  if (res.ok) return res.text || ''
  return ''
}

const copyTerminalSelection = async () => {
  const text = terminal?.getSelection() || ''
  if (!text) {
    sshStatus.value = '请先在终端中选择内容'
    return
  }
  const res = await window.lightterm.clipboardWrite({ text })
  sshStatus.value = res.ok ? '终端选中内容已复制' : `复制失败：${res.error || '未知错误'}`
}

const pasteToTerminal = async () => {
  const ready = activeTerminalMode.value === 'ssh'
    ? sshConnected.value
    : activeTerminalMode.value === 'serial'
      ? serialConnected.value
      : localConnected.value
  if (!ready) {
    sshStatus.value = activeTerminalMode.value === 'ssh'
      ? '请先连接 SSH 会话'
      : activeTerminalMode.value === 'serial'
        ? '请先连接串口'
        : '请先连接本地终端'
    return
  }
  const text = await readClipboardText()
  if (!text) {
    sshStatus.value = '剪贴板为空'
    return
  }
  const res = activeTerminalMode.value === 'ssh'
    ? await window.lightterm.sshWrite({ sessionId: sshSessionId.value, data: text })
    : activeTerminalMode.value === 'serial'
      ? await window.lightterm.sendSerial({ path: serialCurrentPath.value, data: text, isHex: false })
      : await window.lightterm.localWrite({ sessionId: activeLocalSessionId.value, data: text })
  sshStatus.value = res.ok ? '已粘贴到终端' : `粘贴失败：${res.error || '未知错误'}`
  terminal?.focus()
}

const selectAllTerminal = () => {
  terminal?.selectAll()
  terminal?.focus()
}

const handleTerminalHotkeys = (event: KeyboardEvent) => {
  if (!focusTerminal.value) return
  const target = event.target as HTMLElement | null
  const tagName = target?.tagName || ''
  const isXtermHelper = tagName === 'TEXTAREA' && !!target?.classList?.contains('xterm-helper-textarea')
  const isFormEditor = tagName === 'INPUT' || tagName === 'SELECT' || (tagName === 'TEXTAREA' && !isXtermHelper)
  if (isFormEditor) return

  const hasMeta = event.metaKey || event.ctrlKey
  if (!hasMeta) return
  const key = event.key.toLowerCase()

  if (key === 'c' && terminal?.hasSelection()) {
    event.preventDefault()
    event.stopPropagation()
    void copyTerminalSelection()
    return
  }
  if (key === 'v') {
    event.preventDefault()
    event.stopPropagation()
    void pasteToTerminal()
    return
  }
  if (key === 'a') {
    event.preventDefault()
    event.stopPropagation()
    selectAllTerminal()
  }
}

const connectSSH = async (optionsOrEvent?: { keepNav?: boolean } | Event) => {
  const keepNav = typeof optionsOrEvent === 'object' && optionsOrEvent !== null && 'keepNav' in optionsOrEvent
    ? !!optionsOrEvent.keepNav
    : false
  const sessionLabel = (hostName.value || sshForm.value.host || '新会话').trim() || '新会话'
  const sessionId = ensureActiveSshSession(sessionLabel)
  let privateKey = ''
  if (authType.value === 'key') {
    if (!selectedKeyRef.value) {
      sshStatus.value = '请先选择密钥'
      return false
    }
    const keyRes = await window.lightterm.vaultKeyGet({ id: selectedKeyRef.value })
    if (!keyRes.ok) {
      sshStatus.value = `读取密钥失败：${keyRes.error}`
      return false
    }
    privateKey = keyRes.item?.privateKey || ''
  }

  const res = await window.lightterm.sshConnect({
    ...sshForm.value,
    password: authType.value === 'password' ? sshForm.value.password : undefined,
    privateKey: authType.value === 'key' ? privateKey : undefined,
    displayName: sessionLabel,
    sessionId,
  })
  sshConnected.value = !!res.ok
  const tab = sshTabs.value.find((t) => t.id === sessionId)
  if (tab) {
    tab.connected = !!res.ok
    if (res.ok) {
      const label = (hostName.value || sshForm.value.host || tab.name || '会话').trim()
      tab.name = label
    }
  }
  saveSshTabs()
  sshStatus.value = res.ok ? 'SSH 交互会话已连接' : `SSH 连接失败：${res.error}`
  if (res.ok) {
    activeTerminalMode.value = 'ssh'
    terminal?.writeln('\r\n[SSH 已连接，可直接输入命令]')
    focusTerminal.value = true
    saveSessionRestoreState({
      type: 'ssh',
      host: sshForm.value.host,
      port: sshForm.value.port,
      username: sshForm.value.username,
      authType: authType.value,
      keyRef: selectedKeyRef.value || '',
      hostName: hostName.value || sessionLabel,
      targetTabId: sessionId,
    })
    if (!keepNav) nav.value = 'hosts'
  }
  return !!res.ok
}

const connectSSHFromHosts = async () => {
  if (!syncQuickConnectForm()) return
  if (sshConnected.value) {
    const label = (hostName.value || sshForm.value.host || '新会话').trim()
    createSshTab(label)
  }
  await connectSSH()
}

const refreshHosts = async (options: { probe?: boolean } = {}) => {
  const res = await window.lightterm.hostsList()
  if (res.ok) {
    hostItems.value = res.items || []
    hostsLoaded.value = true
    if (!hostCategories.value.includes(selectedCategory.value) && selectedCategory.value !== ALL_CATEGORY) {
      selectedCategory.value = ALL_CATEGORY
    }
    syncHostProbeMap()
    if (options.probe) await probeAllHosts()
  }
}

const {
  selectedCategory,
  hostKeyword,
  newCategoryName,
  newCategoryInputVisible,
  hostCategories,
  displayCategories,
  filteredHosts,
  beginAddCategory,
  addCategory,
  renameCategoryInline,
} = useHostFilters({
  hostItems,
  extraCategories,
  defaultCategory: DEFAULT_CATEGORY,
  allCategory: ALL_CATEGORY,
  notify,
  refreshHosts: async () => refreshHosts(),
})

const {
  hostProbeRunning,
  cancelHostProbe,
  hostProbeClass,
  hostProbeTitle,
  syncHostProbeMap,
  testHostReachability,
  probeAllHosts,
  probeFilteredHosts,
} = useHostProbe({
  hostItems,
  filteredHosts,
})

const connectHostTerminal = async (h: any) => {
  const tabId = createSshTab((h?.name || h?.host || '新会话').trim())
  const ok = await connectSSH()
  if (!ok) await closeSshTab(tabId)
}

const {
  syncQuickConnectForm,
  saveCurrentHost,
  useHost,
  openHostEditor,
  openCreateHostEditor,
  openHostTerminal,
  saveEditedHost,
  deleteCurrentHost,
} = useHostCrud({
  sshForm,
  quickConnectInput,
  selectedHostId,
  hostItems,
  hostName,
  hostCategory,
  authType,
  selectedKeyRef,
  sshStatus,
  editingHost,
  editPasswordVisible,
  hostEditorVisible,
  notify,
  refreshHosts: async () => refreshHosts(),
  connectHostTerminal,
})

const loadLocalFs = async () => {
  const res = await window.lightterm.localfsList({ localPath: localPath.value || undefined })
  if (!res.ok) {
    if (localPath.value) {
      localPath.value = ''
      return loadLocalFs()
    }
    localRows.value = []
    sftpStatus.value = `本地目录读取失败：${res.error || '未知错误'}`
    return
  }
  localPath.value = res.path || localPath.value
  localRows.value = res.items || []
  localFsLoaded.value = true
}

const loadRightLocalFs = async () => {
  const res = await window.lightterm.localfsList({ localPath: rightLocalPath.value || undefined })
  if (!res.ok) {
    if (rightLocalPath.value) {
      rightLocalPath.value = ''
      return loadRightLocalFs()
    }
    rightLocalRows.value = []
    sftpStatus.value = `右侧本地读取失败：${res.error || '未知错误'}`
    return
  }
  rightLocalPath.value = res.path || rightLocalPath.value
  rightLocalRows.value = res.items || []
  rightLocalFsLoaded.value = true
}

const getSftpConfigByHostId = async (hostId: string) => {
  const host = hostItems.value.find((h) => h.id === hostId)
  if (!host) {
    return { error: '请选择 SSH 服务器' }
  }

  const cfg: LocalSSHConfig = {
    host: host.host,
    port: Number(host.port || 22),
    username: host.username,
    password: host.password || undefined,
  }

  if (host.auth_type === 'key') {
    if (!host.private_key_ref) {
      return { error: '该主机未绑定密钥' }
    }
    const keyRes = await window.lightterm.vaultKeyGet({ id: host.private_key_ref })
    if (!keyRes.ok) {
      return { error: keyRes.error || '读取密钥失败' }
    }
    const privateKey = keyRes.item?.privateKey
    if (!privateKey) {
      return { error: '密钥内容为空' }
    }
    cfg.privateKey = privateKey
  }

  return { config: cfg }
}

const getSftpConfig = async () => getSftpConfigByHostId(sftpHostId.value)

const {
  loadSftp,
  uploadSftp,
  downloadSftp,
  mkdirSftp,
  renameSftp,
  deleteSftp,
} = useSftpActions({
  sftpPath,
  sftpRows,
  sftpStatus,
  rightPanelMode,
  selectedLocalFile,
  sftpUploadProgress,
  selectedRemoteFile,
  sftpDownloadProgress,
  sftpNewDirName,
  sftpRenameTo,
  loadRightLocalFs,
  getSftpConfig,
})

const loadLeftSftp = async () => {
  if (!leftSftpHostId.value) {
    sftpStatus.value = '请选择左侧 SSH 服务器'
    return
  }
  const { config, error } = await getSftpConfigByHostId(leftSftpHostId.value)
  if (!config) {
    sftpStatus.value = error || '请选择左侧 SSH 服务器'
    return
  }
  const res = await window.lightterm.sftpList({ ...config, remotePath: leftSftpPath.value })
  if (!res.ok) {
    sftpStatus.value = `左侧读取失败：${res.error}`
    return
  }
  leftSftpRows.value = res.items || []
}

const toggleLeftConnectPanel = () => {
  leftConnectPanelOpen.value = !leftConnectPanelOpen.value
  if (!leftConnectPanelOpen.value) return
  leftConnectCategory.value = ALL_CATEGORY
  leftConnectKeyword.value = ''
  leftConnectTarget.value = leftPanelMode.value === 'local' ? 'local' : leftSftpHostId.value
}

const toggleRightConnectPanel = () => {
  rightConnectPanelOpen.value = !rightConnectPanelOpen.value
  if (!rightConnectPanelOpen.value) return
  rightConnectCategory.value = ALL_CATEGORY
  rightConnectKeyword.value = ''
  rightConnectTarget.value = rightPanelMode.value === 'local' ? 'local' : sftpHostId.value
}

const connectLeftPanel = async () => {
  if (leftConnectTarget.value === 'local') {
    leftPanelMode.value = 'local'
    leftConnectPanelOpen.value = false
    await loadLocalFs()
    sftpStatus.value = '左侧已切换到本地目录'
    return
  }
  leftSftpHostId.value = leftConnectTarget.value
  leftSftpPath.value = '.'
  leftPanelMode.value = 'remote'
  leftConnectPanelOpen.value = false
  await loadLeftSftp()
  const host = hostItems.value.find((h) => h.id === leftSftpHostId.value)
  sftpStatus.value = host ? `左侧已连接：${host.host}` : '左侧已连接'
}

const connectSftp = async () => {
  const target = rightConnectTarget.value || (rightPanelMode.value === 'local' ? 'local' : sftpHostId.value)
  if (target === 'local') {
    rightPanelMode.value = 'local'
    rightConnectPanelOpen.value = false
    await loadRightLocalFs()
    sftpConnected.value = false
    sftpStatus.value = '右侧已切换到本地目录'
    return
  }
  if (!target) {
    sftpStatus.value = '请选择右侧 SSH 服务器'
    return
  }
  sftpHostId.value = target
  rightPanelMode.value = 'remote'
  const { config, error } = await getSftpConfig()
  if (!config) {
    sftpStatus.value = error || '请选择 SSH 服务器'
    sftpConnected.value = false
    return
  }
  sftpConnected.value = true
  rightConnectPanelOpen.value = false
  sftpStatus.value = `已连接：${config.host}`
  await loadSftp()
}

const openLocalItem = async (item: any) => {
  if (!item?.isDir) {
    selectedLocalFile.value = item.path
    return
  }
  localPath.value = item.path
  await loadLocalFs()
}
const openLeftRemoteItem = async (item: any) => {
  if (!item?.isDir) return
  leftSftpPath.value = `${leftSftpPath.value.replace(/\/$/, '')}/${item.filename}`
  await loadLeftSftp()
}
const openLeftItem = async (item: any) => {
  if (leftPanelMode.value === 'local') {
    await openLocalItem(item)
    return
  }
  await openLeftRemoteItem(item)
}
const localGoUp = async () => {
  if (leftPanelMode.value === 'remote') {
    const parts = leftSftpPath.value.split('/').filter(Boolean)
    leftSftpPath.value = parts.length ? `/${parts.slice(0, -1).join('/')}` || '/' : '/'
    await loadLeftSftp()
    return
  }
  if (!localPath.value) {
    if (isWindowsClient.value) {
      await loadLocalFs()
    }
    return
  }
  localPath.value = getLocalParentPath(localPath.value)
  await loadLocalFs()
}
const openRightLocalItem = async (item: any) => {
  if (!item?.isDir) return
  rightLocalPath.value = item.path
  await loadRightLocalFs()
}
const openRightItem = async (item: any) => {
  if (rightPanelMode.value === 'local') {
    await openRightLocalItem(item)
    return
  }
  await openRemoteItem(item)
}
const openRemoteItem = async (item: any) => {
  hideRemoteMenu()
  if (item?.isDir) {
    sftpPath.value = `${sftpPath.value.replace(/\/$/, '')}/${item.filename}`
    await loadSftp()
    return
  }
  selectedRemoteFile.value = item.filename
}

const onLeftDrop = async () => {
  if (leftPanelMode.value === 'local' && rightPanelMode.value === 'remote') {
    await onLocalDrop()
    return
  }
  sftpStatus.value = '当前左右组合暂不支持此拖拽操作'
}

const onRightDrop = async () => {
  if (leftPanelMode.value === 'local' && rightPanelMode.value === 'remote') {
    await onRemoteDrop()
    return
  }
  sftpStatus.value = '当前左右组合暂不支持此拖拽操作'
}

const onLeftDragStart = (item: any) => {
  if (leftPanelMode.value !== 'local') return
  onLocalDragStart(item)
}

const onRightDragStart = (item: any) => {
  if (rightPanelMode.value === 'remote') {
    onRemoteDragStart(item)
    return
  }
  onLocalDragStart(item)
}

const onLocalDragStart = (item: any) => {
  if (item?.isDir) return
  sftpDragLocalPath.value = item.path
}

const onRemoteDragStart = (item: any) => {
  if (item?.isDir) return
  sftpDragRemoteFile.value = item.filename
}

const onRemoteDrop = async () => {
  if (!sftpDragLocalPath.value) return
  selectedLocalFile.value = sftpDragLocalPath.value
  await uploadSftp()
  sftpDragLocalPath.value = ''
}

const onLocalDrop = async () => {
  const { config, error } = await getSftpConfig()
  if (!config) {
    sftpStatus.value = error || '请先选择并连接 SSH 服务器'
    return
  }
  if (!sftpDragRemoteFile.value) return
  if (isWindowsClient.value && !localPath.value) {
    sftpStatus.value = '请先进入左侧具体盘符目录，再接收下载文件'
    return
  }
  const remoteFile = `${sftpPath.value.replace(/\/$/, '')}/${sftpDragRemoteFile.value}`
  const res = await window.lightterm.sftpDownloadToLocal({ ...config, remoteFile, localDir: localPath.value || '', filename: sftpDragRemoteFile.value, conflictPolicy: 'resume', resume: true })
  sftpStatus.value = res.ok ? `拖拽下载成功：${res.filePath}` : `拖拽下载失败：${res.error}`
  sftpDragRemoteFile.value = ''
  if (res.ok) await loadLocalFs()
}
const showRemoteMenu = (event: MouseEvent, item: any) => {
  event.preventDefault()
  selectedRemoteFile.value = item.filename
  remoteMenu.value = { visible: true, x: event.clientX, y: event.clientY, filename: item.filename }
}
const hideRemoteMenu = () => {
  remoteMenu.value.visible = false
}
const openTerminalContextMenu = (event: MouseEvent) => {
  event.preventDefault()
  hideRemoteMenu()
  textMenu.value = { visible: true, x: event.clientX, y: event.clientY, mode: 'terminal' }
}
const openEditorContextMenu = (event: MouseEvent) => {
  event.preventDefault()
  hideRemoteMenu()
  const target = event.target as HTMLInputElement | HTMLTextAreaElement | null
  if (!target || typeof target.value !== 'string') return
  editorMenuTarget.value = target
  target.focus()
  textMenu.value = { visible: true, x: event.clientX, y: event.clientY, mode: 'editor' }
}
const hideTextMenu = () => {
  textMenu.value.visible = false
}
const hideAllMenus = () => {
  hideRemoteMenu()
  hideTextMenu()
}
const getEditorTarget = () => editorMenuTarget.value
const getEditorSelection = () => {
  const el = getEditorTarget()
  if (!el) return ''
  const start = el.selectionStart ?? 0
  const end = el.selectionEnd ?? start
  return el.value.slice(start, end)
}
const replaceEditorSelection = (text: string) => {
  const el = getEditorTarget()
  if (!el) return
  const start = el.selectionStart ?? 0
  const end = el.selectionEnd ?? start
  el.value = `${el.value.slice(0, start)}${text}${el.value.slice(end)}`
  const pos = start + text.length
  el.setSelectionRange(pos, pos)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.focus()
}
const copyFromTextMenu = async () => {
  if (textMenu.value.mode === 'terminal') {
    await copyTerminalSelection()
    hideTextMenu()
    return
  }
  const text = getEditorSelection()
  if (!text) {
    sshStatus.value = '请先选中文本'
    hideTextMenu()
    return
  }
  const res = await window.lightterm.clipboardWrite({ text })
  sshStatus.value = res.ok ? '已复制选中文本' : `复制失败：${res.error || '未知错误'}`
  hideTextMenu()
}
const cutFromTextMenu = async () => {
  if (textMenu.value.mode !== 'editor') return
  const text = getEditorSelection()
  if (!text) {
    sshStatus.value = '请先选中文本'
    hideTextMenu()
    return
  }
  const res = await window.lightterm.clipboardWrite({ text })
  if (!res.ok) {
    sshStatus.value = `剪切失败：${res.error || '未知错误'}`
    hideTextMenu()
    return
  }
  replaceEditorSelection('')
  sshStatus.value = '已剪切选中文本'
  hideTextMenu()
}
const pasteFromTextMenu = async () => {
  if (textMenu.value.mode === 'terminal') {
    await pasteToTerminal()
    hideTextMenu()
    return
  }
  const text = await readClipboardText()
  if (!text) {
    sshStatus.value = '剪贴板为空'
    hideTextMenu()
    return
  }
  replaceEditorSelection(text)
  sshStatus.value = '已粘贴文本'
  hideTextMenu()
}
const selectAllFromTextMenu = () => {
  if (textMenu.value.mode === 'terminal') {
    selectAllTerminal()
    hideTextMenu()
    return
  }
  const el = getEditorTarget()
  if (!el) {
    hideTextMenu()
    return
  }
  el.focus()
  el.setSelectionRange(0, el.value.length)
  hideTextMenu()
}
const menuDownload = async () => {
  hideRemoteMenu()
  await downloadSftp()
}
const menuRename = async () => {
  hideRemoteMenu()
  const next = window.prompt('重命名为', selectedRemoteFile.value)
  if (!next) return
  sftpRenameTo.value = next
  await renameSftp()
}
const menuDelete = async () => {
  hideRemoteMenu()
  await deleteSftp()
}

const promptMkdirSftp = async () => {
  const name = window.prompt('新目录名', '')
  if (!name) return
  sftpNewDirName.value = name
  await mkdirSftp()
}
const remoteGoUp = async () => {
  if (rightPanelMode.value === 'local') {
    if (!rightLocalPath.value) {
      if (isWindowsClient.value) {
        await loadRightLocalFs()
      }
      return
    }
    rightLocalPath.value = getLocalParentPath(rightLocalPath.value)
    await loadRightLocalFs()
    return
  }
  const parts = sftpPath.value.split('/').filter(Boolean)
  sftpPath.value = parts.length ? `/${parts.slice(0, -1).join('/')}` || '/' : '/'
  await loadSftp()
}
const plainVaultMessage = (msg: string) => String(msg || '').replace(/^[✅❌]\s*/, '').trim()
const dbFolderFromPath = (dbPath: string) => String(dbPath || '').replace(/[\\/](lightterm\.db|astrashell\.data\.json)$/i, '')
const isStorageFilePath = (value: string) => /\.(json|db)$/i.test(String(value || '').trim())
const normalizeStoragePathForCompare = (value: string) => {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  const normalized = isStorageFilePath(trimmed)
    ? trimmed
    : `${trimmed.replace(/[\\/]+$/, '')}/astrashell.data.json`
  return normalized.replace(/\\/g, '/').toLowerCase()
}
const formatAppError = (error: unknown) => {
  if (error instanceof Error) return error.message || String(error)
  return String(error || '未知错误')
}

const ensureStartupDbPath = () => {
  if (startupDbPath.value) return
  if (storageDbPath.value) startupDbPath.value = storageDbPath.value
}

const beginStartupInit = () => {
  ensureStartupDbPath()
  startupGateMode.value = 'init'
  startupGateError.value = ''
}

const evaluateVaultGate = () => {
  if (!vaultInitialized.value) {
    startupGateMode.value = 'init'
    startupGateVisible.value = true
    ensureStartupDbPath()
    return
  }
  if (!vaultUnlocked.value) {
    startupGateMode.value = 'unlock'
    startupGateVisible.value = true
    return
  }
  startupGateVisible.value = false
  startupGateError.value = ''
  startupMasterConfirm.value = ''
}

const pickStartupDbPath = async () => {
  const res = await window.lightterm.appPickStorageFile()
  if (res.ok && res.filePath) {
    startupDbPath.value = res.filePath
    startupGateError.value = ''
  }
}

const pickStartupDbSavePath = async () => {
  const res = await window.lightterm.appPickStorageSaveFile()
  if (res.ok && res.filePath) {
    startupDbPath.value = res.filePath
    startupGateError.value = ''
  }
}

const pickStartupDbFolder = async () => {
  const res = await window.lightterm.appPickStorageFolder()
  if (res.ok && res.folder) {
    startupDbPath.value = res.folder
    startupGateError.value = ''
  }
}

const useCurrentDbPath = () => {
  startupDbPath.value = storageDbPath.value || dbFolderFromPath(storageDbPath.value)
  startupGateError.value = ''
}

const applyStartupStoragePath = async () => {
  const targetPath = startupDbPath.value.trim()
  const currentPath = storageDbPath.value.trim()
  if (!targetPath) return { ok: false, error: '请先选择数据文件路径' }
  if (normalizeStoragePathForCompare(targetPath) === normalizeStoragePathForCompare(currentPath)) {
    return { ok: true, changed: false }
  }
  const setRes = await window.lightterm.appSetStorageFolder({ folder: targetPath })
  if (!setRes.ok) return { ok: false, error: setRes.error || '未知错误' }
  startupGateError.value = '数据文件路径已设置，应用正在重启...'
  await window.lightterm.appRestart()
  return { ok: true, changed: true }
}

const runUseExistingStorage = async () => {
  if (startupGateBusy.value) return
  startupGateBusy.value = true
  startupGateError.value = ''
  try {
    const result = await applyStartupStoragePath()
    if (!result.ok || result.changed) {
      if (!result.ok) startupGateError.value = `数据文件路径设置失败：${result.error}`
      return
    }
    await checkVault()
    if (!vaultInitialized.value) {
      startupGateError.value = '当前文件不是已初始化的数据文件，请重新选择，或者改为初始化新数据库。'
    }
  } finally {
    startupGateBusy.value = false
  }
}

const runStartupInit = async () => {
  if (startupGateBusy.value) return
  if (!startupDbPath.value.trim()) {
    startupGateError.value = '请先选择数据文件路径'
    return
  }
  if (!vaultMaster.value) {
    startupGateError.value = '请设置主密码'
    return
  }
  if (vaultMaster.value !== startupMasterConfirm.value) {
    startupGateError.value = '两次输入的主密码不一致'
    return
  }
  startupGateBusy.value = true
  startupGateError.value = ''
  try {
    const result = await applyStartupStoragePath()
    if (!result.ok || result.changed) {
      if (!result.ok) startupGateError.value = `数据文件路径设置失败：${result.error}`
      return
    }

    await initVault()
    if (!vaultUnlocked.value) {
      startupGateError.value = plainVaultMessage(vaultStatus.value) || '初始化失败'
      return
    }
    startupGateVisible.value = false
  } finally {
    startupGateBusy.value = false
  }
}

const runStartupUnlock = async () => {
  if (startupGateBusy.value) return
  if (!vaultMaster.value) {
    startupGateError.value = '请输入主密码'
    return
  }
  startupGateBusy.value = true
  startupGateError.value = ''
  try {
    await unlockVault()
    if (!vaultUnlocked.value) {
      startupGateError.value = plainVaultMessage(vaultStatus.value) || '解锁失败'
      return
    }
    startupGateVisible.value = false
  } finally {
    startupGateBusy.value = false
  }
}

const runPostUnlockStartupTasks = async () => {
  if (startupTasksLoaded.value) return
  if (startupGateVisible.value) return

  const startupTasks: Array<[string, () => Promise<unknown>]> = [
    ['主机列表', refreshHosts],
    ['存储信息', refreshStorageOverview],
    ['更新状态', refreshUpdateState],
  ]
  if (vaultUnlocked.value) startupTasks.push(['密钥列表', refreshVaultKeys])

  const failures: string[] = []
  const settled = await Promise.allSettled(startupTasks.map(async ([, task]) => await task()))
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') return
    const label = startupTasks[index]?.[0] || `任务${index + 1}`
    failures.push(`${label}加载失败：${formatAppError(result.reason)}`)
  })

  startupTasksLoaded.value = true
  if (failures.length > 0) {
    const message = failures[0] || '启动初始化失败'
    if (!snippetStatus.value) snippetStatus.value = message
    console.error('[startup]', failures)
  }
}

const checkVault = async () => {
  if (!window.lightterm?.vaultStatus) {
    bridgeReady.value = false
    vaultStatus.value = '❌ 桌面桥接未加载（请完全退出 AstraShell 后重新打开桌面版 App）'
    return
  }
  bridgeReady.value = true
  try {
    const res = await window.lightterm.vaultStatus()
    vaultInitialized.value = !!res.initialized
    vaultUnlocked.value = !!res.unlocked
    if (!res.configured) {
      startupGateMode.value = 'select'
      startupGateVisible.value = true
      startupGateError.value = '请先选择是初始化新数据库，还是使用已有数据库。'
      return
    }
    ensureStartupDbPath()
    if (res.error) {
      startupGateMode.value = 'select'
      startupGateVisible.value = true
      startupGateError.value = `数据文件读取失败：${res.error}`
      return
    }
    if (!res.exists) {
      startupGateMode.value = 'select'
      startupGateVisible.value = true
      startupGateError.value = '当前路径还没有数据文件。首次使用请选择初始化；如果你要使用已有数据库，请重新选择正确文件。'
      return
    }
    evaluateVaultGate()
  } catch (error) {
    bridgeReady.value = false
    vaultInitialized.value = false
    vaultUnlocked.value = false
    startupGateMode.value = 'select'
    startupGateVisible.value = true
    vaultStatus.value = `❌ 读取密钥仓库状态失败：${formatAppError(error)}`
  }
}
const initVault = async () => {
  try {
    if (!vaultMaster.value) {
      vaultStatus.value = '主密码不能为空'
      return
    }
    if (!window.lightterm?.vaultSetMaster) {
      bridgeReady.value = false
      vaultStatus.value = '❌ 桌面桥接未加载（当前不是可写入版本）'
      return
    }
    vaultStatus.value = '正在初始化仓库...'
    const res = await window.lightterm.vaultSetMaster({ masterPassword: vaultMaster.value })
    vaultStatus.value = res.ok ? '✅ 密钥仓库初始化成功（已解锁）' : `❌ 初始化失败：${res.error || '未知错误'}`
    await checkVault()
  } catch (e: any) {
    vaultStatus.value = `❌ 初始化异常：${e?.message || e}`
  }
}
const unlockVault = async () => {
  try {
    if (!vaultMaster.value) {
      vaultStatus.value = '请输入主密码'
      return
    }
    if (!window.lightterm?.vaultUnlock) {
      bridgeReady.value = false
      vaultStatus.value = '❌ 桌面桥接未加载（当前不是可写入版本）'
      return
    }
    vaultStatus.value = '正在解锁仓库...'
    const res = await window.lightterm.vaultUnlock({ masterPassword: vaultMaster.value })
    vaultStatus.value = res.ok ? '✅ 密钥仓库已解锁' : `❌ 解锁失败：${res.error || '未知错误'}`
    await checkVault()
    if (res.ok) await refreshVaultKeys()
  } catch (e: any) {
    vaultStatus.value = `❌ 解锁异常：${e?.message || e}`
  }
}
const resetVault = async () => {
  try {
    if (!window.lightterm?.vaultReset) {
      bridgeReady.value = false
      vaultStatus.value = '❌ 桌面桥接未加载（当前不是可写入版本）'
      return
    }
    vaultStatus.value = '正在重置仓库...'
    const res = await window.lightterm.vaultReset()
    vaultStatus.value = res.ok ? '✅ 密钥仓库已重置，请重新初始化' : `❌ 重置失败：${res.error || '未知错误'}`
    vaultMaster.value = ''
    await checkVault()
    await refreshVaultKeys()
    clearVaultEditor()
  } catch (e: any) {
    vaultStatus.value = `❌ 重置异常：${e?.message || e}`
  }
}

const clearVaultEditor = () => {
  selectedVaultKeyId.value = ''
  vaultKeyName.value = ''
  vaultPrivateKey.value = ''
  vaultPublicKey.value = ''
  vaultCertificate.value = ''
  vaultKeyType.value = 'auto'
  vaultEditorVisible.value = true
}

const openVaultEditor = async (item: any) => {
  if (!item?.id) return
  if (!vaultUnlocked.value) {
    vaultStatus.value = '请先解锁密钥仓库'
    return
  }
  const res = await window.lightterm.vaultKeyGet({ id: item.id })
  if (!res.ok) {
    vaultStatus.value = `读取密钥失败：${res.error || '未知错误'}`
    return
  }
  selectedVaultKeyId.value = item.id
  vaultKeyName.value = res.item?.name || item.name || ''
  vaultPrivateKey.value = res.item?.privateKey || ''
  vaultPublicKey.value = res.item?.publicKey || ''
  vaultCertificate.value = res.item?.certificate || ''
  vaultKeyType.value = res.item?.type || item.type || 'auto'
  vaultEditorVisible.value = true
}

const saveVaultKey = async () => {
  if (!vaultUnlocked.value) {
    vaultStatus.value = '请先解锁密钥仓库'
    return
  }
  const privateKey = vaultPrivateKey.value.trim()
  const publicKey = vaultPublicKey.value.trim()
  const certificate = vaultCertificate.value.trim()
  if (!privateKey && !publicKey && !certificate) {
    vaultStatus.value = '请至少填写私钥/公钥/证书中的一项'
    return
  }
  const res = await window.lightterm.vaultKeySave({
    id: selectedVaultKeyId.value || undefined,
    name: vaultKeyName.value || '未命名密钥',
    privateKey,
    publicKey,
    certificate,
    type: vaultKeyType.value,
  })
  vaultStatus.value = res.ok ? `密钥已保存（格式：${res.detectedType || vaultKeyType.value}）` : `保存失败：${res.error}`
  if (res.ok) {
    selectedVaultKeyId.value = res.id || selectedVaultKeyId.value
    await refreshVaultKeys()
    if (selectedVaultKeyId.value) {
      const current = vaultItems.value.find((k) => k.id === selectedVaultKeyId.value)
      if (current) await openVaultEditor(current)
    }
  }
}
const importVaultKeyFile = async () => {
  const res = await window.lightterm.vaultKeyImportFile()
  if (!res.ok) {
    vaultStatus.value = res.error || '导入失败'
    if (res.raw) {
      vaultPrivateKey.value = res.raw
      vaultKeyType.value = 'ppk'
    }
    return
  }
  vaultPrivateKey.value = res.content || ''
  vaultKeyType.value = res.detectedType || 'openssh'
  if (!vaultKeyName.value && res.filePath) {
    const parts = res.filePath.split('/')
    vaultKeyName.value = parts[parts.length - 1] || ''
  }
  vaultStatus.value = `已导入文件：${res.filePath}`
}
const refreshVaultKeys = async () => {
  const res = await window.lightterm.vaultKeyList()
  if (res.ok) {
    vaultItems.value = res.items || []
    vaultKeysLoaded.value = true
    if (selectedVaultKeyId.value && !vaultItems.value.some((k) => k.id === selectedVaultKeyId.value)) {
      clearVaultEditor()
    }
  }
}

const mergeUpdateState = (payload: UpdateStatePayload = {}) => {
  const prev = updateInfo.value
  updateInfo.value = {
    status: payload.status ?? prev.status,
    message: payload.message ?? prev.message,
    currentVersion: payload.currentVersion ?? prev.currentVersion,
    latestVersion: payload.latestVersion ?? prev.latestVersion,
    source: payload.source ?? prev.source,
    hasUpdate: payload.hasUpdate ?? prev.hasUpdate,
    downloaded: payload.downloaded ?? prev.downloaded,
    checking: payload.checking ?? prev.checking,
    downloading: payload.downloading ?? prev.downloading,
    progress: Number(payload.progress ?? prev.progress ?? 0),
    downloadUrl: payload.downloadUrl ?? prev.downloadUrl,
    releaseUrl: payload.releaseUrl ?? prev.releaseUrl,
  }
}

const runUpdateAction = async (
  action: () => Promise<UpdateActionResult>,
  failurePrefix: string,
) => {
  updateActionBusy.value = true
  try {
    const res = await action()
    if (!res.ok) {
      mergeUpdateState({ message: `${failurePrefix}：${res.error || '未知错误'}` })
    }
  } finally {
    updateActionBusy.value = false
  }
}

const refreshUpdateState = async () => {
  const res = await window.lightterm.updateGetState()
  if (!res.ok) return
  mergeUpdateState(res)
  updateStateLoaded.value = true
}

const checkAppUpdate = async () => runUpdateAction(() => window.lightterm.updateCheck(), '检查更新失败')

const downloadAppUpdate = async () => runUpdateAction(() => window.lightterm.updateDownload(), '下载更新失败')

const installAppUpdate = async () => runUpdateAction(() => window.lightterm.updateInstall(), '安装更新失败')

const openManualUpdateLink = async (url: string) => {
  if (!url) return
  const res = await window.lightterm.appOpenExternal({ url })
  if (!res.ok) {
    mergeUpdateState({ message: `打开下载链接失败：${res.error || '未知错误'}` })
  }
}

const refreshStorageInfo = async () => {
  try {
    const [res, meta] = await Promise.all([
      window.lightterm.appGetStorage(),
      window.lightterm.appGetStorageMeta(),
    ])
    if (res.ok) {
      storageDbPath.value = res.dbPath || meta.dbPath || ''
      ensureStartupDbPath()
      if (!storagePathInput.value && storageDbPath.value) storagePathInput.value = storageDbPath.value
    }
    if (meta.ok) {
      if (!meta.configured) {
        storageMetaText.value = '尚未选择数据文件。首次启动请先选择“初始化新数据库”或“使用已有数据库”。'
        return
      }
      const modified = meta.mtimeMs ? new Date(meta.mtimeMs).toLocaleString() : '-'
      const kb = Math.max(0, Number(meta.size || 0)) / 1024
      const encrypted = meta.encrypted ? '已加密' : '未加密'
      const fileState = meta.exists ? '存在' : '不存在'
      storageMetaText.value = `当前读取：${meta.dbPath || '-'} ｜ 文件：${fileState} ｜ 大小：${kb.toFixed(1)} KB ｜ 修改时间：${modified} ｜ 数据：主机 ${meta.hosts || 0} / 片段 ${meta.snippets || 0} / 密钥 ${meta.vaultKeys || 0} / 日志 ${meta.logs || 0} ｜ 加密：${encrypted} ｜ 格式：v${meta.storageVersion || 1}`
    }
  } catch (error) {
    startupGateError.value = `读取数据文件路径失败：${formatAppError(error)}`
  }
}

const refreshStorageOverview = async () => {
  await refreshStorageInfo()
}

const refreshStorageDataNow = async () => {
  const res = await window.lightterm.appRefreshStorageData()
  if (!res?.ok) {
    storageMsg.value = `刷新失败：${res?.error || '未知错误'}`
    return
  }
  await refreshStorageOverview()
  await refreshHosts()
  if (snippetsLoaded.value || nav.value === 'snippets') await restoreSnippets()
  if (vaultUnlocked.value && (vaultKeysLoaded.value || nav.value === 'vault')) await refreshVaultKeys()
  storageMsg.value = res.changed ? '已强制刷新共享数据文件并同步界面' : '已刷新（文件无新变更）'
}

let storageDataRefreshTimer: number | null = null
const scheduleStorageDataRefresh = () => {
  if (storageDataRefreshTimer) window.clearTimeout(storageDataRefreshTimer)
  storageDataRefreshTimer = window.setTimeout(async () => {
    storageDataRefreshTimer = null
    if (startupGateVisible.value) return
    await refreshStorageOverview()
    await refreshHosts()
    if (snippetsLoaded.value || nav.value === 'snippets') await restoreSnippets()
    if (vaultUnlocked.value && (vaultKeysLoaded.value || nav.value === 'vault')) await refreshVaultKeys()
    storageMsg.value = '检测到共享数据文件更新，已自动刷新'
  }, 320)
}

const pickStorageFile = async () => {
  const res = await window.lightterm.appPickStorageFile()
  if (res.ok && res.filePath) storagePathInput.value = res.filePath
}

const pickStorageFolder = async () => {
  const res = await window.lightterm.appPickStorageFolder()
  if (res.ok && res.folder) storagePathInput.value = res.folder
}
const applyStoragePath = async () => {
  if (!storagePathInput.value.trim()) return
  const res = await window.lightterm.appSetStorageFolder({ folder: storagePathInput.value.trim() })
  storageMsg.value = res.ok
    ? `已设置数据文件：${res.dbPath}（重启应用生效）`
    : `设置失败：${res.error}`
  await refreshStorageOverview()
}

const refreshBackupList = async () => {
  const res = await window.lightterm.appListBackups()
  if (!res.ok) {
    storageMsg.value = `读取备份列表失败：${res.error || '未知错误'}`
    return
  }
  backupItems.value = res.items || []
  if (!backupItems.value.some((item) => item.path === selectedBackupPath.value)) {
    selectedBackupPath.value = backupItems.value[0]?.path || ''
  }
}

const createDataBackup = async () => {
  const res = await window.lightterm.appCreateBackup()
  storageMsg.value = res.ok
    ? `备份已创建：${res.backupPath}`
    : `备份失败：${res.error || '未知错误'}`
  if (res.ok) await refreshBackupList()
}

const restoreDataBackup = async () => {
  if (!selectedBackupPath.value) {
    storageMsg.value = '请先选择备份文件'
    return
  }
  const ok = window.confirm('恢复备份会覆盖当前共享数据文件，确定继续吗？')
  if (!ok) return
  const res = await window.lightterm.appRestoreBackup({ backupPath: selectedBackupPath.value })
  storageMsg.value = res.ok
    ? '备份已恢复并重新加载数据'
    : `恢复失败：${res.error || '未知错误'}`
  if (res.ok) {
    await refreshStorageDataNow()
    await refreshBackupList()
  }
}

const loadSerialPorts = async () => {
  serialPorts.value = await window.lightterm.listSerialPorts()
  serialPortsLoaded.value = true
  if (!serialForm.value.path && serialPorts.value.length > 0) serialForm.value.path = serialPorts.value[0].path
}
const openSerial = async () => {
  if (!serialForm.value.path) return
  if (serialTimer) {
    clearInterval(serialTimer)
    serialTimer = null
  }
  const res = await window.lightterm.openSerial({
    ...serialForm.value,
    rtscts: serialFlowControl.value === 'rtscts',
    dsrdtr: serialFlowControl.value === 'dsrdtr',
    xon: serialFlowControl.value === 'xonxoff',
    xoff: serialFlowControl.value === 'xonxoff',
  })
  if (!res.ok) {
    sshStatus.value = `串口打开失败：${res.error || '未知错误'}`
    pushSerialDialog('err', `连接失败：${res.error || '未知错误'}`)
    terminal?.writeln(`\r\n串口打开失败：${res.error || '未知错误'}`)
    return
  }
  serialConnected.value = true
  serialCurrentPath.value = serialForm.value.path
  activeTerminalMode.value = 'serial'
  focusTerminal.value = false
  await nextTick()
  initTerminal()
  applyTerminalTheme()
  pushSerialDialog('sys', `连接成功：${serialCurrentPath.value}（${serialForm.value.baudRate} bps）`)
  sshStatus.value = `串口已连接：${serialCurrentPath.value}`
}
const sendSerial = async () => {
  const pathValue = serialCurrentPath.value || serialForm.value.path
  if (!pathValue || !serialSendText.value) return
  const res = await window.lightterm.sendSerial({ path: pathValue, data: serialSendText.value, isHex: serialHexMode.value })
  if (res.ok) {
    pushSerialDialog('tx', serialSendText.value)
    return
  }
  pushSerialDialog('err', `发送失败：${res.error || '未知错误'}`)
  terminal?.writeln(`\r\n发送失败：${res.error}`)
}
const closeSerial = async () => {
  const pathValue = serialCurrentPath.value || serialForm.value.path
  if (!pathValue) return
  if (serialTimer) {
    clearInterval(serialTimer)
    serialTimer = null
  }
  const res = await window.lightterm.closeSerial({ path: pathValue })
  if (res.ok) {
    serialConnected.value = false
    serialCurrentPath.value = ''
    sshStatus.value = `串口已断开：${pathValue}`
    pushSerialDialog('sys', `串口已断开：${pathValue}`)
    terminal?.writeln(`\r\n[串口已断开] ${pathValue}`)
    if (activeTerminalMode.value === 'serial') focusTerminal.value = false
    return
  }
  sshStatus.value = `串口断开失败：${res.error || '未知错误'}`
  pushSerialDialog('err', `断开失败：${res.error || '未知错误'}`)
}

const createLocalSessionId = () => `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const createLocalTabId = () => `ltab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const localSessionLabel = (cwd: string, idx: number) => {
  const normalized = String(cwd || '').trim()
  const tail = normalized.split(/[\\/]/).filter(Boolean).pop() || '~'
  return `${tail} · ${idx}`
}

const switchLocalTab = async (tabId: string) => {
  const tab = localTabs.value.find((item) => item.id === tabId)
  if (!tab) return
  activeLocalTabId.value = tab.id
  localStatus.value = tab.status || (tab.connected ? '已连接' : '未连接')
  localCwd.value = tab.cwd || localCwd.value
  activeTerminalMode.value = 'local'
  if (focusTerminal.value) {
    await nextTick()
    initTerminal()
    applyTerminalTheme()
    terminal?.reset()
    terminal?.write(localBufferBySession.value[tab.sessionId] || '')
    terminal?.focus()
    await syncLocalTerminalSize()
  }
}

const connectLocalTerminal = async () => {
  const sessionId = createLocalSessionId()
  const tabId = createLocalTabId()
  const tabIndex = localTabs.value.length + 1
  const res = await window.lightterm.localConnect({
    sessionId,
    cwd: localCwd.value.trim() || undefined,
    cols: 120,
    rows: 30,
    shellType: localShellType.value,
    elevated: false,
  })
  if (!res.ok) {
    localStatus.value = `连接失败：${res.error || '未知错误'}`
    return
  }

  const finalCwd = String(res.cwd || localCwd.value || '~')
  const warningText = String((res as any)?.warning || '').trim()
  const tab: LocalTabItem = {
    id: tabId,
    sessionId,
    name: localSessionLabel(finalCwd, tabIndex),
    cwd: finalCwd,
    connected: true,
    status: `${res.shell || 'shell'} @ ${finalCwd}`,
  }
  localTabs.value.push(tab)
  localBufferBySession.value[sessionId] = ''
  await switchLocalTab(tabId)

  activeTerminalMode.value = 'local'
  focusTerminal.value = true
  saveSessionRestoreState({ type: 'local', cwd: finalCwd })
  localStatus.value = warningText ? `${tab.status} ｜ ⚠ ${warningText}` : tab.status
  localCwd.value = finalCwd
  await nextTick()
  initTerminal()
  applyTerminalTheme()
  terminal?.reset()
  terminal?.writeln(`[本地终端已连接] ${tab.status}`)
  terminal?.focus()
  await syncLocalTerminalSize()
}

const closeLocalTab = async (tabId: string) => {
  const tab = localTabs.value.find((item) => item.id === tabId)
  if (!tab) return
  if (tab.connected && tab.sessionId) {
    await window.lightterm.localDisconnect({ sessionId: tab.sessionId })
  }
  localTabs.value = localTabs.value.filter((item) => item.id !== tabId)
  delete localBufferBySession.value[tab.sessionId]

  if (!localTabs.value.length) {
    activeLocalTabId.value = ''
    localStatus.value = '已断开'
    clearSessionRestoreState()
    if (activeTerminalMode.value === 'local') focusTerminal.value = false
    return
  }

  if (activeLocalTabId.value === tabId) {
    const fallback = localTabs.value[localTabs.value.length - 1]
    if (fallback) await switchLocalTab(fallback.id)
  }
}

const disconnectLocalTerminal = async () => {
  if (!activeLocalTabId.value) return
  await closeLocalTab(activeLocalTabId.value)
}

const runLocalQuickCommand = async (cmd: string) => {
  const text = String(cmd || '').trim()
  if (!localConnected.value || !activeLocalSessionId.value) {
    localStatus.value = '请先连接本地终端'
    return
  }
  if (!text) return
  const res = await window.lightterm.localWrite({ sessionId: activeLocalSessionId.value, data: `${text}\n` })
  if (!res.ok) {
    localStatus.value = `发送失败：${res.error || '未知错误'}`
    return
  }
  activeTerminalMode.value = 'local'
  focusTerminal.value = true
  await nextTick()
  initTerminal()
  applyTerminalTheme()
  terminal?.reset()
  terminal?.write(localBufferBySession.value[activeLocalSessionId.value] || '')
  terminal?.focus()
  await syncLocalTerminalSize()
}

const restoreLastSessionIfNeeded = async () => {
  const state = restoreSessionRestoreState()
  if (!state || typeof state !== 'object') return
  if (state.type === 'local') {
    if (!localConnected.value) {
      if (state.cwd) localCwd.value = String(state.cwd)
      await connectLocalTerminal()
    }
    return
  }
  if (state.type === 'ssh') {
    if (!state.host || !state.username) return
    sshForm.value.host = String(state.host)
    sshForm.value.port = Number(state.port || 22)
    sshForm.value.username = String(state.username)
    hostName.value = String(state.hostName || `${state.username}@${state.host}`)
    authType.value = state.authType === 'key' ? 'key' : 'password'
    selectedKeyRef.value = String(state.keyRef || '')
    await connectSSH({ keepNav: true })
  }
}

const refreshAuditLogs = async () => {
  const res = await window.lightterm.auditList({
    limit: 1200,
    source: auditSource.value,
    keyword: auditKeyword.value.trim(),
  })
  if (!res.ok) {
    auditStatus.value = `读取日志失败：${res.error || '未知错误'}`
    return
  }
  auditLogs.value = (res.items || []) as AuditLogItem[]
  auditLoaded.value = true
  auditStatus.value = `共 ${auditLogs.value.length} 条日志`
}

const clearAuditLogs = async () => {
  const confirmed = window.confirm('确认清空全部日志吗？')
  if (!confirmed) return
  const res = await window.lightterm.auditClear()
  if (!res.ok) {
    auditStatus.value = `清空失败：${res.error || '未知错误'}`
    return
  }
  auditLogs.value = []
  auditStatus.value = '日志已清空'
}

const formatAuditTime = (ts: number) => {
  if (!ts) return '-'
  return new Date(ts).toLocaleString()
}

const formatAuditSource = (source: string) => {
  if (source === 'ssh') return 'SSH'
  if (source === 'serial') return '串口'
  if (source === 'local') return '本地'
  return '系统'
}

const formatAuditAction = (action: string) => {
  if (action === 'connect') return '连接成功'
  if (action === 'disconnect') return '会话结束'
  if (action === 'command') return '输入命令'
  if (action === 'response') return '终端反馈'
  if (action === 'error') return '异常'
  return action || '事件'
}
const toggleTimerSend = () => {
  if (serialTimer) {
    clearInterval(serialTimer)
    serialTimer = null
    pushSerialDialog('sys', '已停止定时发送')
    return
  }
  if (!serialTimerMs.value || serialTimerMs.value < 50) return
  serialTimer = window.setInterval(() => sendSerial(), serialTimerMs.value)
  pushSerialDialog('sys', `已开启定时发送：${serialTimerMs.value} ms`)
}

watch(nav, async (value) => {
  if (value === 'hosts') {
    if (vaultUnlocked.value && !vaultKeysLoaded.value) await refreshVaultKeys()
    return
  }

  cancelHostProbe()

  if (value === 'sftp') {
    if (!localFsLoaded.value) await loadLocalFs()
    if (!rightLocalFsLoaded.value && rightPanelMode.value === 'local') await loadRightLocalFs()
    return
  }

  if (value === 'snippets') {
    if (!snippetsLoaded.value) await restoreSnippets()
    return
  }

  if (value === 'serial') {
    if (!serialPortsLoaded.value) await loadSerialPorts()
    return
  }

  if (value === 'local') {
    return
  }

  if (value === 'vault') {
    if (vaultUnlocked.value && !vaultKeysLoaded.value) await refreshVaultKeys()
    return
  }

  if (value === 'settings' && !updateStateLoaded.value) {
    await refreshUpdateState()
    return
  }

  if (value === 'logs') {
    await refreshAuditLogs()
  }
})

watch(startupGateVisible, (visible) => {
  if (!visible) {
    void runPostUnlockStartupTasks()
    if (!sessionRestoreTried.value) {
      sessionRestoreTried.value = true
      void restoreLastSessionIfNeeded()
    }
  }
})

onMounted(async () => {
  startupGateVisible.value = true
  startupGateMode.value = 'loading'
  startupGateError.value = ''
  void refreshStorageInfo()
  try {
    await checkVault()
  } catch (error) {
    startupGateError.value = `启动检查失败：${formatAppError(error)}`
    if (startupGateMode.value === 'loading') startupGateMode.value = 'select'
  }

  restoreSshTabs()
  restoreLocalQuickItems()
  resetLocalQuickDraft()
  loadTerminalEncoding()
  void refreshBackupList()
  if (!startupGateVisible.value) {
    await runPostUnlockStartupTasks()
    sessionRestoreTried.value = true
    await restoreLastSessionIfNeeded()
  }

  window.addEventListener('resize', () => {
    fitAddon?.fit()
    if (activeTerminalMode.value === 'ssh' && sshConnected.value && terminal) {
      window.lightterm.sshResize({ sessionId: sshSessionId.value, cols: terminal.cols, rows: terminal.rows })
    } else if (activeTerminalMode.value === 'local') {
      void syncLocalTerminalSize()
    }
  })
  window.lightterm.onSftpProgress((p) => {
    if (p.type === 'upload') sftpUploadProgress.value = p.percent
    if (p.type === 'download') sftpDownloadProgress.value = p.percent
  })
  window.lightterm.onUpdateStatus((payload) => mergeUpdateState(payload))
  window.lightterm.onStorageDataChanged(() => scheduleStorageDataRefresh())
  window.lightterm.onAuditAppended((item) => {
    auditLogs.value = [item as AuditLogItem, ...auditLogs.value]
    if (auditLogs.value.length > 1200) auditLogs.value = auditLogs.value.slice(0, 1200)
    auditStatus.value = `共 ${auditLogs.value.length} 条日志`
    if (!auditLoaded.value) auditLoaded.value = true
  })
  window.addEventListener('click', hideAllMenus)
  window.addEventListener('keydown', handleTerminalHotkeys, true)
})

onBeforeUnmount(() => {
  cancelHostProbe()
  if (storageDataRefreshTimer) {
    window.clearTimeout(storageDataRefreshTimer)
    storageDataRefreshTimer = null
  }
  if (serialTimer) {
    clearInterval(serialTimer)
    serialTimer = null
  }
  if (serialConnected.value && serialCurrentPath.value) {
    void window.lightterm.closeSerial({ path: serialCurrentPath.value })
  }
  for (const tab of localTabs.value) {
    if (tab.connected && tab.sessionId) void window.lightterm.localDisconnect({ sessionId: tab.sessionId })
  }
  window.removeEventListener('keydown', handleTerminalHotkeys, true)
  window.removeEventListener('click', hideAllMenus)
})
</script>

<template>
  <div class="layout" :class="{ 'terminal-layout': focusTerminal }">
    <aside class="sidebar">
      <div class="brand">
        <img src="/logo-astrashell.png?v=12" alt="AstraShell Banner" class="brand-logo brand-logo-wide" />
      </div>
      <ul class="sidebar-nav">
        <li :class="{ active: nav === 'hosts' }" @click="focusTerminal = false; nav = 'hosts'"><Server :size="16" /> 主机管理</li>
        <li :class="{ active: nav === 'sftp' }" @click="focusTerminal = false; nav = 'sftp'"><FolderTree :size="16" /> 文件传输</li>
        <li :class="{ active: nav === 'snippets' }" @click="focusTerminal = false; nav = 'snippets'"><Pencil :size="16" /> 代码片段</li>
        <li :class="{ active: nav === 'serial' }" @click="focusTerminal = false; nav = 'serial'"><Cable :size="16" /> 串口工具</li>
        <li :class="{ active: nav === 'local' }" @click="focusTerminal = false; nav = 'local'"><Server :size="16" /> 本地终端</li>
        <li :class="{ active: nav === 'vault' }" @click="focusTerminal = false; nav = 'vault'"><KeyRound :size="16" /> 密钥管理</li>
        <li :class="{ active: nav === 'settings' }" @click="focusTerminal = false; nav = 'settings'"><Settings :size="16" /> 应用设置</li>
        <li :class="{ active: nav === 'logs' }" @click="focusTerminal = false; nav = 'logs'"><Pencil :size="16" /> 操作日志</li>
      </ul>
      <div class="sidebar-footer">
        <img src="/logo-astrashell-app.png?v=11" alt="AstraShell Logo" class="sidebar-footer-logo sidebar-footer-logo-wide" />
        <div class="sidebar-footer-text">
          <div class="sidebar-footer-title">AstraShell</div>
          <div class="sidebar-footer-sub">制作人：GetIDC</div>
          <a class="sidebar-footer-link" href="http://astrashell.851108.xyz" target="_blank" rel="noreferrer">astrashell.851108.xyz</a>
        </div>
      </div>
    </aside>

    <main class="main">
      <div class="top-actions terminal-top-actions" v-if="focusTerminal">
        <div class="terminal-mode-line">
          <span class="status-pill mode">{{ terminalModeLabel }}</span>
          <span class="status-pill plain">{{ terminalTargetLabel }}</span>
        </div>
        <div v-if="activeTerminalMode === 'ssh'" class="terminal-tabs">
          <div
            class="terminal-tab"
            v-for="tab in sshTabs"
            :key="tab.id"
            :class="{ active: sshSessionId === tab.id }"
            @click="switchSshTab(tab.id)"
          >
            <span class="terminal-tab-name">{{ tab.name }}</span>
            <span class="status-dot" :class="tab.connected ? 'online' : 'offline'"></span>
            <button class="terminal-tab-close" title="关闭并断开" @click.stop="closeSshTab(tab.id)">×</button>
          </div>
          <button class="ghost small" @click="createSshTab()">+ 新标签</button>
        </div>
        <div v-else-if="activeTerminalMode === 'local'" class="terminal-tabs">
          <div
            class="terminal-tab"
            v-for="tab in localTabs"
            :key="tab.id"
            :class="{ active: activeLocalTabId === tab.id }"
            @click="switchLocalTab(tab.id)"
          >
            <span class="terminal-tab-name">{{ tab.name }}</span>
            <span class="status-dot" :class="tab.connected ? 'online' : 'offline'"></span>
            <button class="terminal-tab-close" title="关闭本地标签" @click.stop="closeLocalTab(tab.id)">×</button>
          </div>
          <button class="ghost small" @click="connectLocalTerminal()">+ 本地标签</button>
        </div>
        <div class="terminal-actions-row" v-if="activeTerminalMode !== 'serial'">
          <div class="terminal-tools-left">
            <button class="ghost" @click="focusTerminal = false">返回模块视图</button>
            <button class="ghost" @click="selectAllTerminal">全选</button>
            <button class="ghost" @click="copyTerminalSelection">复制选中</button>
            <button class="ghost" @click="pasteToTerminal">粘贴</button>
            <button v-if="activeTerminalMode === 'local'" class="danger" @click="disconnectLocalTerminal">断开本地</button>
          </div>
          <div class="terminal-tools-right">
            <select v-model="terminalEncoding" class="encoding-select" title="终端解码">
              <option value="utf-8">终端编码：UTF-8</option>
              <option value="gb18030">终端编码：GBK/GB18030</option>
            </select>
            <select v-model="terminalSnippetId">
              <option value="">选择代码片段</option>
              <option v-for="item in terminalSnippetItems" :key="item.id" :value="item.id">
                {{ item.name }} · {{ item.category }}
              </option>
            </select>
            <button class="muted" @click="runTerminalSnippet" :disabled="snippetRunning">执行片段</button>
            <button class="ghost" @click="sendSnippetRawToTerminal">发送原文</button>
            <button class="ghost" @click="nav = 'snippets'; focusTerminal = false">打开片段</button>
          </div>
        </div>
        <div class="serial-live-toolbar" v-else>
          <div class="terminal-tools-left">
            <button class="ghost" @click="focusTerminal = false">返回串口面板</button>
            <button class="ghost" @click="copyTerminalSelection">复制选中</button>
            <button class="ghost" @click="pasteToTerminal">粘贴</button>
            <button class="danger" @click="closeSerial">断开串口</button>
          </div>
          <div class="terminal-tools-right">
            <select v-model="terminalSnippetId">
              <option value="">选择代码片段</option>
              <option v-for="item in terminalSnippetItems" :key="item.id" :value="item.id">
                {{ item.name }} · {{ item.category }}
              </option>
            </select>
            <button class="muted" @click="runTerminalSnippet" :disabled="snippetRunning">执行片段</button>
          </div>
        </div>
      </div>

      <div class="session-strip" v-else-if="sshTabs.length > 0 && activeTerminalMode === 'ssh'">
        <div class="session-strip-title">活动 SSH 会话</div>
        <div class="terminal-tabs session-strip-tabs">
          <div
            class="terminal-tab"
            v-for="tab in sshTabs"
            :key="tab.id"
            :class="{ active: sshSessionId === tab.id }"
            @click="switchSshTab(tab.id); focusTerminal = true"
          >
            <span class="terminal-tab-name">{{ tab.name }}</span>
            <span class="status-dot" :class="tab.connected ? 'online' : 'offline'"></span>
            <button class="terminal-tab-close" title="关闭并断开" @click.stop="closeSshTab(tab.id)">×</button>
          </div>
          <button class="ghost small" @click="createSshTab(); focusTerminal = true">+ 新标签</button>
        </div>
      </div>

      <section v-if="!focusTerminal && nav === 'hosts'" class="panel hosts-panel">
        <div class="hosts-header">
          <div>
            <h3>主机管理</h3>
            <p class="hosts-header-sub">快速筛选主机并在右侧编辑详情</p>
          </div>
          <div class="hosts-quick-connect">
            <input v-model="quickConnectInput" placeholder="SSH 快速连接，例如 root@1.2.3.4 或 admin@1.2.3.4:22" @keyup.enter="connectSSHFromHosts" />
            <button class="ghost small" @click="saveCurrentHost">保存</button>
            <button class="muted small" @click="connectSSHFromHosts">连接</button>
          </div>
        </div>

        <div class="hosts-layout new-layout">
          <div class="hosts-left">
            <div class="hosts-left-title">
              <span>分类</span>
              <button class="ghost tiny" @click="beginAddCategory">+ 新建</button>
            </div>
            <div v-if="newCategoryInputVisible" class="cat-item input-item">
              <input v-model="newCategoryName" placeholder="输入分类名后回车" @keyup.enter="addCategory" @blur="addCategory" />
            </div>
            <div v-for="c in displayCategories" :key="c" class="cat-item" :class="{ activeCat: selectedCategory === c }">
              <button class="cat-name" @click="selectedCategory = c">{{ c }}</button>
              <button v-if="c !== DEFAULT_CATEGORY && c !== ALL_CATEGORY" class="icon-btn" @click="renameCategoryInline(c)"><Pencil :size="12" /></button>
            </div>
          </div>

          <div class="hosts-center">
            <div class="hosts-toolbar">
              <input v-model="hostKeyword" placeholder="搜索主机 / IP / 用户名" />
              <button class="ghost tiny" :disabled="hostProbeRunning || filteredHosts.length === 0" @click="probeFilteredHosts">
                {{ hostProbeRunning ? '检测中...' : '检测当前列表' }}
              </button>
              <button class="muted tiny" @click="openCreateHostEditor">新建服务器</button>
              <span class="hosts-stat">显示 {{ filteredHosts.length }} / {{ hostItems.length }} 台主机</span>
            </div>
            <div class="host-grid">
              <div
                class="host-card"
                v-for="h in filteredHosts"
                :key="h.id"
                @click="useHost(h)"
                @dblclick="openHostTerminal(h)"
                :class="{ activeHost: selectedHostId === h.id }"
              >
                <div class="host-card-main">
                  <span class="host-icon">{{ h.auth_type === 'key' ? '🔑' : '🖥' }}</span>
                  <div class="host-card-body">
                    <div class="host-card-title">{{ h.name }}</div>
                    <div class="host-line">{{ h.host }} · {{ h.username }}</div>
                  </div>
                </div>
                <div class="host-card-meta">
                  <span class="pill ghost">{{ h.auth_type === 'key' ? '密钥' : '密码' }}</span>
                  <button class="status-dot-btn" :title="hostProbeTitle(h)" @click.stop="testHostReachability(h)">
                    <span class="status-dot" :class="hostProbeClass(h.id)"></span>
                  </button>
                  <button class="host-edit-btn" title="编辑主机" @click.stop="openHostEditor(h)">
                    <Pencil :size="12" />
                  </button>
                </div>
              </div>
              <div v-if="filteredHosts.length === 0" class="file-row empty">暂无主机</div>
            </div>
          </div>

          <div class="hosts-editor-column" :class="{ visible: hostEditorVisible }">
            <div class="host-editor-panel" v-if="hostEditorVisible">
              <div class="editor-title">
                <Pencil :size="14" /> SSH 编辑
                <button class="ghost small" @click="hostEditorVisible = false">收起</button>
              </div>
              <div v-if="editingHost" class="ssh-edit-zone">
                <div class="ssh-edit-grid">
                  <div class="ssh-module">
                    <div class="module-title">基础信息</div>
                    <input v-model="editingHost.name" placeholder="连接名称" />
                    <select v-model="editingHost.category">
                      <option v-for="c in hostCategories" :key="c" :value="c">{{ c }}</option>
                    </select>
                    <input v-model="editingHost.host" placeholder="主机/IP" />
                    <input v-model.number="editingHost.port" type="number" placeholder="端口" />
                    <input v-model="editingHost.username" placeholder="用户名" />
                  </div>
                  <div class="ssh-module">
                    <div class="module-title">认证</div>
                    <select v-model="editingHost.authType">
                      <option value="password">密码认证</option>
                      <option value="key">密钥认证</option>
                    </select>
                    <div v-if="editingHost.authType === 'password'" class="password-field">
                      <input v-model="editingHost.password" :type="editPasswordVisible ? 'text' : 'password'" placeholder="密码" />
                      <button class="icon-btn password-toggle" type="button" :title="editPasswordVisible ? '隐藏密码' : '显示密码'" @click="editPasswordVisible = !editPasswordVisible">
                        <EyeOff v-if="editPasswordVisible" :size="14" />
                        <Eye v-else :size="14" />
                      </button>
                    </div>
                    <select v-else v-model="editingHost.privateKeyRef">
                      <option value="">选择密钥</option>
                      <option v-for="k in vaultItems" :key="k.id" :value="k.id">{{ k.name }} ({{ k.type }})</option>
                    </select>
                  </div>
                </div>
                <div class="ssh-edit-grid">
                  <div class="ssh-module">
                    <div class="module-title">资产信息</div>
                    <label>购买日期</label>
                    <input v-model="editingHost.purchaseDate" type="date" />
                    <label>有效期</label>
                    <input v-model="editingHost.expiryDate" type="date" />
                  </div>
                  <div class="ssh-module">
                    <div class="module-title">操作</div>
                    <div class="ssh-actions">
                      <button @click="saveEditedHost">保存修改</button>
                      <button class="muted" @click="openHostTerminal(editingHost)">连接终端</button>
                      <button class="danger" @click="selectedHostId = editingHost.id; deleteCurrentHost()">删除主机</button>
                    </div>
                  </div>
                </div>
              </div>
              <div v-else class="empty-tip">先在中间选择一个 SSH 条目进行编辑</div>
            </div>
          </div>
        </div>
      </section>

      <section v-else-if="!focusTerminal && nav === 'sftp'" class="panel sftp-panel">
        <h3>SFTP 文件传输</h3>
        <div class="sftp-status-line">
          <span class="status-pill" :class="{ online: sftpConnected }">{{ sftpConnected ? '已连接' : '未连接' }}</span>
          <span class="status-pill mode">{{ sftpTransferModeLabel }}</span>
          <span class="status-pill plain">{{ sftpStatus || '就绪' }}</span>
        </div>
        <div class="split-head">
          <div class="head-left">
            <article class="path-chip">
              <header>
                <b>左侧连接</b>
                <em>{{ leftPanelStateLabel }}</em>
              </header>
              <span>{{ leftLinkLabel }}</span>
              <small>{{ leftPanelMode === 'local' ? leftLocalPathDisplay : leftSftpPath }}</small>
              <i>共 {{ leftDisplayRows.length }} 项</i>
            </article>
            <article class="path-chip">
              <header>
                <b>右侧连接</b>
                <em>{{ rightPanelStateLabel }}</em>
              </header>
              <span>{{ rightLinkLabel }}</span>
              <small>{{ rightPanelMode === 'local' ? rightLocalPathDisplay : sftpPath }}</small>
              <i>共 {{ rightDisplayRows.length }} 项</i>
            </article>
          </div>
        </div>

        <div class="split">
          <div @dragover.prevent @drop="onLeftDrop" class="file-panel local-panel">
            <div class="file-panel-head">
              <h4>{{ leftPanelMode === 'local' ? '左侧：本地（可接收远程拖拽下载）' : '左侧：远程浏览' }}</h4>
              <div class="file-head-actions">
                <button class="ghost small" @click="localGoUp">上一级</button>
                <button class="ghost small" @click="leftPanelMode === 'local' ? loadLocalFs() : loadLeftSftp()">刷新</button>
                <button class="ghost small" @click="toggleLeftConnectPanel">链接</button>
                <select v-model="localSortBy" class="file-sort">
                  <option value="name">A-Z 排序</option>
                  <option value="createdAt">创建时间</option>
                  <option value="modifiedAt">修改时间</option>
                </select>
              </div>
            </div>
            <div v-if="leftConnectPanelOpen" class="connect-inline">
              <div class="connect-filters">
                <select v-model="leftConnectCategory">
                  <option :value="ALL_CATEGORY">全部分类</option>
                  <option v-for="c in hostCategories" :key="`left-cat-${c}`" :value="c">{{ c }}</option>
                </select>
                <input v-model="leftConnectKeyword" placeholder="搜索服务器/IP/用户名" />
              </div>
              <select v-model="leftConnectTarget">
                <option value="local">本地目录</option>
                <optgroup v-for="group in leftConnectGroups" :key="`left-group-${group.category}`" :label="group.category">
                  <option v-for="h in group.items" :key="h.id" :value="h.id">{{ h.name }} ({{ h.host }})</option>
                </optgroup>
              </select>
              <button @click="connectLeftPanel">切换左侧</button>
            </div>
            <div class="file-search-row">
              <input v-model="leftFileKeyword" placeholder="筛选当前左侧文件列表" />
            </div>
            <div class="file-stack">
              <div
                v-for="l in leftDisplayRows"
                :key="leftPanelMode === 'local' ? l.path : l.filename"
                class="file-row"
                :class="{ 'is-dir': l.isDir, active: leftPanelMode === 'local' ? selectedLocalFile === l.path : selectedRemoteFile === l.filename }"
                @click="openLeftItem(l)"
                :draggable="leftPanelMode === 'local' && !l.isDir"
                @dragstart="onLeftDragStart(l)"
              >
                <div class="file-info">
                  <span class="file-icon">{{ l.isDir ? '📁' : '📄' }}</span>
                  <span class="file-name">{{ leftPanelMode === 'local' ? l.name : l.filename }}</span>
                </div>
                <div class="file-meta">
                  <span>{{ l.isDir ? '目录' : (leftPanelMode === 'local' ? '文件' : (l.size ?? '-')) }}</span>
                  <span>{{ formatFsTime(leftPanelMode === 'local' ? l.modifiedAt : (l.modifiedAt || l.mtime)) }}</span>
                </div>
              </div>
              <div v-if="leftDisplayRows.length === 0" class="file-row empty">目录空</div>
            </div>
          </div>
          <div @dragover.prevent @drop="onRightDrop" class="file-panel remote-panel">
            <div class="file-panel-head">
              <h4>{{ rightPanelMode === 'remote' ? '右侧：远程（可接收本地拖拽上传）' : '右侧：本地目录' }}</h4>
              <div class="file-head-actions">
                <button class="ghost small" @click="remoteGoUp">上一级</button>
                <button class="ghost small" @click="loadSftp">刷新</button>
                <button v-if="rightPanelMode === 'remote'" class="ghost small" @click="promptMkdirSftp">新建目录</button>
                <button class="ghost small" @click="toggleRightConnectPanel">链接</button>
                <select v-model="remoteSortBy" class="file-sort">
                  <option value="name">A-Z 排序</option>
                  <option value="createdAt">创建时间</option>
                  <option value="modifiedAt">修改时间</option>
                </select>
              </div>
            </div>
            <div v-if="rightConnectPanelOpen" class="connect-inline">
              <div class="connect-filters">
                <select v-model="rightConnectCategory">
                  <option :value="ALL_CATEGORY">全部分类</option>
                  <option v-for="c in hostCategories" :key="`right-cat-${c}`" :value="c">{{ c }}</option>
                </select>
                <input v-model="rightConnectKeyword" placeholder="搜索服务器/IP/用户名" />
              </div>
              <select v-model="rightConnectTarget">
                <option value="local">本地目录</option>
                <optgroup v-for="group in rightConnectGroups" :key="`right-group-${group.category}`" :label="group.category">
                  <option v-for="h in group.items" :key="h.id" :value="h.id">{{ h.name }} ({{ h.host }})</option>
                </optgroup>
              </select>
              <button @click="connectSftp">切换右侧</button>
            </div>
            <div class="file-search-row">
              <input v-model="rightFileKeyword" placeholder="筛选当前右侧文件列表" />
            </div>
            <div class="file-stack">
              <div
                v-for="r in rightDisplayRows"
                :key="rightPanelMode === 'remote' ? r.filename : r.path"
                class="file-row"
                :class="{ 'is-dir': r.isDir, active: rightPanelMode === 'remote' ? selectedRemoteFile === r.filename : selectedLocalFile === r.path }"
                @click="openRightItem(r)"
                @contextmenu="rightPanelMode === 'remote' ? showRemoteMenu($event, r) : undefined"
                :draggable="!r.isDir"
                @dragstart="onRightDragStart(r)"
              >
                <div class="file-info">
                  <span class="file-icon">{{ r.isDir ? '📁' : '📄' }}</span>
                  <span class="file-name">{{ rightPanelMode === 'remote' ? r.filename : r.name }}</span>
                </div>
                <div class="file-meta">
                  <span>{{ r.isDir ? '目录' : (rightPanelMode === 'remote' ? (r.size ?? '-') : '文件') }}</span>
                  <span>{{ r.isDir ? '' : formatFsTime(rightPanelMode === 'remote' ? (r.modifiedAt || r.mtime) : r.modifiedAt) }}</span>
                </div>
              </div>
              <div v-if="rightDisplayRows.length === 0" class="file-row empty">目录空</div>
            </div>
          </div>
        </div>
        <div
          v-if="rightPanelMode === 'remote' && remoteMenu.visible"
          class="context-menu"
          :style="{ left: `${remoteMenu.x}px`, top: `${remoteMenu.y}px` }"
        >
          <button class="menu-item" @click="menuDownload">下载</button>
          <button class="menu-item" @click="menuRename">重命名</button>
          <button class="menu-item danger" @click="menuDelete">删除</button>
        </div>
      </section>

      <section v-else-if="!focusTerminal && nav === 'snippets'" class="panel snippets-panel">
        <div class="snippets-header">
          <div>
            <h3>代码片段</h3>
            <p class="hosts-header-sub">保存常用脚本，连接服务器后一键逐条执行</p>
          </div>
          <div class="snippets-run-settings">
            <label>执行间隔(ms)</label>
            <input v-model.number="snippetRunDelayMs" type="number" min="200" step="100" />
          </div>
        </div>

        <div class="snippets-layout">
          <div class="snippets-left">
            <div class="hosts-left-title">
              <span>分类</span>
              <button class="ghost tiny" @click="beginAddSnippetCategory">+ 新建</button>
            </div>
            <div v-if="newSnippetCategoryInputVisible" class="cat-item input-item">
              <input v-model="newSnippetCategoryName" placeholder="输入分类名后回车" @keyup.enter="addSnippetCategory" @blur="addSnippetCategory" />
            </div>
            <div v-for="c in displaySnippetCategories" :key="c" class="cat-item" :class="{ activeCat: snippetCategory === c }">
              <button class="cat-name" @click="snippetCategory = c">{{ c }}</button>
            </div>
          </div>

          <div class="snippets-center">
            <div class="snippets-toolbar">
              <input v-model="snippetKeyword" placeholder="搜索片段名称/说明/命令" />
              <button class="ghost small" @click="clearSnippetEditor">新建片段</button>
              <span class="hosts-stat">共 {{ filteredSnippetItems.length }} 条</span>
            </div>

            <div class="snippet-grid">
              <article
                v-for="item in filteredSnippetItems"
                :key="item.id"
                class="snippet-card"
                :class="{ activeSnippet: selectedSnippetId === item.id }"
                @click="openSnippetEditor(item)"
              >
                <div class="snippet-card-head">
                  <div class="snippet-card-title">{{ item.name }}</div>
                  <span class="pill">{{ item.category }}</span>
                </div>
                <div class="snippet-card-desc">{{ item.description || '无说明' }}</div>
                <div class="snippet-card-host">{{ snippetHostLabel(item.hostId) }}</div>
                <div class="snippet-card-foot">
                  <span>{{ snippetCommandLines(item.commands).length }} 条命令</span>
                  <button class="snippet-run-btn" @click.stop="runSnippet(item)" :disabled="snippetRunning">执行</button>
                </div>
              </article>
              <div v-if="filteredSnippetItems.length === 0" class="file-row empty">暂无代码片段</div>
            </div>
          </div>

          <div class="snippets-editor-column" :class="{ visible: snippetEditorVisible }">
            <div class="snippets-editor-panel">
              <div class="editor-title">
                <Pencil :size="14" /> 片段编辑
                <button class="ghost small" @click="clearSnippetEditor">清空</button>
              </div>
              <div class="vault-form-grid snippet-form-grid">
                <input v-model="snippetEdit.name" placeholder="片段名称（如：部署 Docker）" />
                <select v-model="snippetEdit.category">
                  <option v-for="c in snippetCategories" :key="c" :value="c">{{ c }}</option>
                </select>
                <select v-model="snippetEdit.hostId">
                  <option value="">使用当前 SSH 会话</option>
                  <option v-for="h in hostItems" :key="h.id" :value="h.id">{{ h.name }} ({{ h.host }})</option>
                </select>
                <input v-model="snippetEdit.description" class="snippet-desc-input" placeholder="用途说明（可选）" />
                <textarea
                  v-model="snippetEdit.commands"
                  class="snippet-command-input"
                  placeholder="每行一条命令。以 # 开头会视为注释并跳过。"
                  @contextmenu.prevent="openEditorContextMenu"
                ></textarea>
                <p class="hint">点击执行后会按行自动发送到 SSH 终端，并自动回车执行。</p>
                <div class="snippet-actions">
                  <button class="snippet-btn ghost" @click="deleteSnippet">删除</button>
                  <button class="snippet-btn primary" @click="runSnippet()" :disabled="snippetRunning">执行片段</button>
                  <button class="snippet-btn danger" @click="stopSnippet" :disabled="!snippetRunning">停止</button>
                  <button class="snippet-btn success" @click="saveSnippet">保存片段</button>
                </div>
              </div>
              <p class="vault-status">{{ snippetStatus || '就绪' }}</p>
            </div>
          </div>
        </div>
      </section>

      <section v-else-if="!focusTerminal && nav === 'serial'" class="panel serial-panel">
        <div class="serial-connect-shell">
          <div class="serial-connect-card">
            <div class="serial-title">
              <span class="serial-title-icon">⌨</span>
              <h3>串口连接</h3>
            </div>
            <div class="serial-route-line">
              <span>端口</span>
              <i></i>
              <span>会话</span>
            </div>
            <div class="serial-form-stack">
              <label class="serial-field-label">端口选择</label>
              <select v-model="serialForm.path">
                <option value="">请选择串口端口</option>
                <option v-for="p in serialPorts" :key="p.path" :value="p.path">{{ p.path }}</option>
              </select>
              <label class="serial-field-label">波特率选择</label>
              <div class="serial-baud-row">
                <select v-model="serialBaudPreset">
                  <option v-for="rate in serialBaudRates" :key="`baud-preset-${rate}`" :value="String(rate)">{{ rate }} bps</option>
                  <option value="custom">自定义输入</option>
                </select>
                <input v-model.number="serialForm.baudRate" type="number" min="1" step="1" placeholder="手动输入波特率" />
              </div>
              <button class="serial-advanced-toggle ghost" @click="serialAdvancedOpen = !serialAdvancedOpen">
                高级参数 {{ serialAdvancedOpen ? '▾' : '▸' }}
              </button>
              <div v-if="serialAdvancedOpen" class="serial-advanced-panel">
                <label>字符编码</label>
                <select v-model="terminalEncoding">
                  <option value="utf-8">UTF-8（推荐）</option>
                  <option value="gb18030">GB18030（中文设备）</option>
                </select>

                <label>数据位</label>
                <div class="serial-segment">
                  <button class="seg-btn" :class="{ active: serialForm.dataBits === 8 }" @click="serialForm.dataBits = 8">8</button>
                  <button class="seg-btn" :class="{ active: serialForm.dataBits === 7 }" @click="serialForm.dataBits = 7">7</button>
                  <button class="seg-btn" :class="{ active: serialForm.dataBits === 6 }" @click="serialForm.dataBits = 6">6</button>
                  <button class="seg-btn" :class="{ active: serialForm.dataBits === 5 }" @click="serialForm.dataBits = 5">5</button>
                </div>

                <label>停止位</label>
                <div class="serial-segment">
                  <button class="seg-btn" :class="{ active: serialForm.stopBits === 1 }" @click="serialForm.stopBits = 1">1</button>
                  <button class="seg-btn" :class="{ active: serialForm.stopBits === 2 }" @click="serialForm.stopBits = 2">2</button>
                </div>

                <label>流控</label>
                <div class="serial-segment flow">
                  <button class="seg-btn" :class="{ active: serialFlowControl === 'none' }" @click="serialFlowControl = 'none'">无</button>
                  <button class="seg-btn" :class="{ active: serialFlowControl === 'rtscts' }" @click="serialFlowControl = 'rtscts'">RTS/CTS</button>
                  <button class="seg-btn" :class="{ active: serialFlowControl === 'dsrdtr' }" @click="serialFlowControl = 'dsrdtr'">DSR/DTR</button>
                  <button class="seg-btn" :class="{ active: serialFlowControl === 'xonxoff' }" @click="serialFlowControl = 'xonxoff'">XON/XOFF</button>
                </div>

                <label>校验位</label>
                <div class="serial-segment">
                  <button class="seg-btn" :class="{ active: serialForm.parity === 'none' }" @click="serialForm.parity = 'none'">无</button>
                  <button class="seg-btn" :class="{ active: serialForm.parity === 'odd' }" @click="serialForm.parity = 'odd'">奇校验</button>
                  <button class="seg-btn" :class="{ active: serialForm.parity === 'even' }" @click="serialForm.parity = 'even'">偶校验</button>
                </div>
              </div>
              <label class="serial-field-label">发送内容</label>
              <input v-model="serialSendText" :placeholder="serialHexMode ? 'HEX 示例：41 54 0D 0A' : '输入要发送的内容'" />
              <div class="serial-send-toolbar">
                <label class="serial-inline-check"><input v-model="serialHexMode" type="checkbox" /> HEX 模式</label>
                <input v-model.number="serialTimerMs" type="number" min="50" step="10" placeholder="定时发送 ms（>=50）" />
              </div>
              <div class="serial-send-actions">
                <button @click="sendSerial" :disabled="!serialConnected">发送</button>
                <button class="muted" @click="toggleTimerSend" :disabled="!serialConnected || !serialTimerMs || serialTimerMs < 50">
                  {{ serialTimerActive ? '停止定时' : '开启定时' }}
                </button>
              </div>
            </div>
            <div class="serial-connect-actions">
              <button class="muted" @click="loadSerialPorts">刷新端口</button>
              <button v-if="!serialConnected" class="serial-connect-btn" @click="openSerial">连接串口</button>
              <button v-else class="danger" @click="closeSerial">断开串口</button>
            </div>
          </div>
          <div class="serial-dialog-panel">
            <div class="serial-dialog-info">
              <div class="serial-dialog-info-title">连接信息</div>
              <div class="serial-dialog-info-main">{{ serialConnected ? '已连接' : '未连接' }}</div>
              <div class="serial-dialog-info-sub">{{ serialConnectionInfo }}</div>
            </div>
            <div class="serial-dialog-list">
              <article v-for="item in serialDialogLogs" :key="item.id" class="serial-dialog-item" :class="`type-${item.type}`">
                <header>
                  <span>{{ item.type === 'tx' ? '发送' : item.type === 'rx' ? '接收' : item.type === 'err' ? '错误' : '状态' }}</span>
                  <small>{{ formatAuditTime(item.ts) }}</small>
                </header>
                <pre>{{ item.text }}</pre>
              </article>
              <div v-if="serialDialogLogs.length === 0" class="file-row empty">连接后这里将显示串口交互内容</div>
            </div>
          </div>
        </div>
      </section>

      <section v-else-if="!focusTerminal && nav === 'local'" class="panel local-panel">
        <div class="serial-head">
          <div>
            <h3>本地终端</h3>
            <p class="hosts-header-sub">科技风终端皮肤，支持中文显示、快捷工具、代码片段复用</p>
          </div>
          <div class="serial-head-actions">
            <button class="ghost" @click="connectLocalTerminal">+ 新本地标签</button>
            <button class="muted" :disabled="!localConnected" @click="disconnectLocalTerminal">关闭当前标签</button>
          </div>
        </div>
        <div class="terminal-tabs local-tabs" v-if="localTabs.length > 0">
          <div
            class="terminal-tab"
            v-for="tab in localTabs"
            :key="tab.id"
            :class="{ active: activeLocalTabId === tab.id }"
            @click="switchLocalTab(tab.id)"
          >
            <span class="terminal-tab-name">{{ tab.name }}</span>
            <span class="status-dot" :class="tab.connected ? 'online' : 'offline'"></span>
            <button class="terminal-tab-close" title="关闭本地标签" @click.stop="closeLocalTab(tab.id)">×</button>
          </div>
        </div>
        <div class="grid local-shell-grid">
          <select v-model="localShellType">
            <option value="auto">终端类型：自动</option>
            <option value="cmd">终端类型：CMD</option>
            <option value="powershell">终端类型：PowerShell</option>
          </select>
          <label v-if="isWindowsClient" class="serial-inline-check" title="管理员模式正在重构中，当前版本暂不可用">
            <input v-model="localElevated" type="checkbox" disabled /> 管理员模式（暂不可用，避免弹外部窗口）
          </label>
        </div>
        <div class="local-status">{{ localStatus }}</div>
        <div class="local-tools-card">
          <div class="hosts-left-title">
            <span>快捷工具（可自定义）</span>
            <span class="hosts-stat">点击后自动跳到终端查看结果</span>
          </div>

          <div class="local-quick-toolbar">
            <select v-model="localQuickCategory" class="file-sort">
              <option v-for="cat in localQuickCategories" :key="cat" :value="cat">{{ cat }}</option>
            </select>
            <div class="serial-head-actions">
              <button class="ghost tiny" @click="openLocalQuickCreate">新建指令</button>
            </div>
          </div>

          <div class="local-quick-layout" :class="{ 'editor-open': localQuickEditorVisible }">
            <div class="local-tool-grid">
              <div v-for="item in filteredLocalQuickItems" :key="item.id" class="local-tool-item">
                <button class="ghost" @click="runLocalQuickCommand(item.cmd)">{{ item.label }}</button>
                <div class="local-tool-meta">
                  <span class="pill ghost">{{ item.category }}</span>
                  <button class="ghost tiny" @click="startEditLocalQuickItem(item)">编辑</button>
                  <button class="danger tiny" @click="removeLocalQuickItem(item.id)">删除</button>
                </div>
              </div>
              <div v-if="filteredLocalQuickItems.length === 0" class="file-row empty">当前分类暂无快捷指令</div>
            </div>

            <div class="local-quick-editor-column" :class="{ visible: localQuickEditorVisible }">
              <div class="local-quick-editor-panel">
                <div class="editor-title">
                  <Pencil :size="14" /> 快捷工具编辑
                  <button class="ghost small" @click="closeLocalQuickEditor">收起</button>
                </div>
                <div class="local-quick-editor">
                  <input v-model="localQuickDraftCategory" placeholder="分类（例如：系统/网络/部署）" />
                  <input v-model="localQuickDraftLabel" placeholder="指令名称（例如：查看端口）" />
                  <input v-model="localQuickDraftCmd" placeholder="命令（例如：lsof -iTCP -sTCP:LISTEN -n -P）" />
                  <div class="local-quick-editor-actions">
                    <button class="muted" @click="saveLocalQuickDraft">{{ localQuickEditId ? '保存修改' : '添加指令' }}</button>
                    <button class="ghost" @click="resetLocalQuickDraft">清空</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section v-else-if="!focusTerminal && nav === 'vault'" class="panel vault-panel">
        <div class="vault-header">
          <h3>密钥管理</h3>
          <div class="vault-toolbar">
            <input v-model="vaultMaster" type="password" placeholder="主密码" />
            <button v-if="!vaultInitialized" @click="initVault">初始化仓库</button>
            <button v-else @click="unlockVault">解锁仓库</button>
            <button class="muted" @click="refreshVaultKeys">刷新密钥列表</button>
            <button class="danger" @click="resetVault">重置仓库</button>
          </div>
          <p class="vault-status">{{ vaultStatus }} ｜ bridge={{ bridgeReady ? 'ok' : 'missing' }} ｜ initialized={{ vaultInitialized }} unlocked={{ vaultUnlocked }}</p>
        </div>

        <div class="vault-layout">
          <div class="vault-list">
            <div class="vault-list-head">
              <input v-model="vaultKeyword" placeholder="搜索密钥名/类型/指纹" />
              <button class="ghost small" @click="clearVaultEditor">新建密钥</button>
            </div>
            <div class="vault-card-grid">
              <button
                v-for="k in filteredVaultItems"
                :key="k.id"
                class="vault-mini-card"
                :class="{ active: selectedVaultKeyId === k.id }"
                @click="openVaultEditor(k)"
              >
                <div class="vault-mini-head">
                  <span class="vault-mini-title">{{ k.name }}</span>
                  <span class="pill ghost">{{ k.type }}</span>
                </div>
                <div class="vault-mini-fp">{{ k.fingerprint || '无指纹' }}</div>
                <div class="vault-mini-time">{{ k.updated_at ? new Date(k.updated_at).toLocaleDateString() : '未更新' }}</div>
              </button>
              <div v-if="filteredVaultItems.length === 0" class="file-row empty">暂无密钥数据</div>
            </div>
          </div>

          <div class="vault-editor-column" :class="{ visible: vaultEditorVisible }">
            <div class="vault-editor-panel">
              <div class="editor-title">
                <KeyRound :size="14" /> 密钥编辑
                <button class="ghost small" @click="clearVaultEditor">清空</button>
              </div>
              <div class="vault-form-grid">
                <input v-model="vaultKeyName" placeholder="密钥名称" />
                <select v-model="vaultKeyType">
                  <option value="auto">自动识别</option>
                  <option value="openssh">OpenSSH</option>
                  <option value="pem">PEM</option>
                  <option value="ppk">PPK</option>
                  <option value="public">Public</option>
                  <option value="certificate">Certificate</option>
                  <option value="bundle">Bundle</option>
                </select>
                <textarea v-model="vaultPrivateKey" class="key-input" placeholder="Private Key（可选）"></textarea>
                <textarea v-model="vaultPublicKey" class="key-input" placeholder="Public Key（可选）"></textarea>
                <textarea v-model="vaultCertificate" class="key-input" placeholder="Certificate（可选）"></textarea>
                <p class="hint">私钥/公钥/证书三项至少填写一项即可保存。</p>
                <div class="vault-actions">
                  <button class="ghost" @click="importVaultKeyFile">导入文件</button>
                  <button @click="saveVaultKey">{{ selectedVaultKeyId ? '保存修改' : '保存密钥组' }}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section v-else-if="!focusTerminal && nav === 'settings'" class="panel">
        <h3>应用设置</h3>
        <p class="hint">统一管理应用更新与本地数据文件目录。</p>
        <div class="divider"></div>
        <h3>应用更新</h3>
        <p>{{ updateStatusText }}</p>
        <div class="grid update-grid">
          <button class="muted" :disabled="updateActionBusy || updateInfo.checking" @click="checkAppUpdate">检查更新</button>
          <button class="muted" :disabled="updateActionBusy || !updateInfo.hasUpdate || updateInfo.downloaded" @click="downloadAppUpdate">下载更新</button>
          <button :disabled="updateActionBusy || !updateInfo.downloaded" @click="installAppUpdate">重启并安装</button>
          <button class="ghost" :disabled="updateActionBusy" @click="refreshUpdateState">刷新状态</button>
        </div>
        <div class="update-progress" v-if="updateInfo.downloading">
          <div class="update-progress-bar"><div class="update-progress-fill" :style="{ width: `${updateInfo.progress}%` }"></div></div>
          <span>{{ Math.round(updateInfo.progress) }}%</span>
        </div>
        <div v-if="showManualMacUpdate" class="manual-update-card">
          <div class="manual-update-head">
            <strong>mac 当前版本需手动安装</strong>
            <span>点击下方链接后会在浏览器中直接下载 DMG 到本地文件夹。</span>
          </div>
          <div class="manual-update-actions">
            <button class="muted" @click="openManualUpdateLink(updateInfo.downloadUrl)">下载 DMG</button>
            <button
              v-if="updateInfo.releaseUrl"
              class="ghost"
              @click="openManualUpdateLink(updateInfo.releaseUrl)"
            >
              打开 Release 页面
            </button>
          </div>
          <a class="manual-update-link" :href="updateInfo.downloadUrl" target="_blank" rel="noreferrer">{{ updateInfo.downloadUrl }}</a>
        </div>
        <p class="hint">官网：<a class="manual-update-link" href="http://astrashell.851108.xyz" target="_blank" rel="noreferrer">http://astrashell.851108.xyz</a></p>
        <p class="hint">发布新版本到 GitHub Release 后，应用启动会自动检查；也可手动检查并一键更新。</p>
        <div class="divider"></div>
        <h3>本地存储</h3>
        <p>当前数据文件：{{ storageDbPath }}</p>
        <div class="storage-path-row">
          <input v-model="storagePathInput" placeholder="输入共享路径（可填目录或 .json/.db 文件）" />
          <div class="storage-path-actions">
            <button class="muted tiny" @click="pickStorageFile">选文件</button>
            <button class="muted tiny" @click="pickStorageFolder">选目录</button>
            <button class="tiny" @click="applyStoragePath">应用</button>
            <button class="muted tiny" @click="refreshStorageDataNow">刷新</button>
          </div>
        </div>
        <p>{{ storageMsg }}</p>
        <p class="hint">{{ storageMetaText || '正在读取数据文件状态...' }}</p>
        <div class="storage-backup-card">
          <div class="hosts-left-title">
            <span>数据备份</span>
            <span class="hosts-stat">防止异常导致数据丢失</span>
          </div>
          <div class="storage-path-actions">
            <button class="muted tiny" @click="createDataBackup">立即备份</button>
            <button class="muted tiny" @click="refreshBackupList">刷新备份列表</button>
          </div>
          <div class="storage-path-row">
            <select v-model="selectedBackupPath">
              <option value="">请选择备份文件</option>
              <option v-for="item in backupItems" :key="item.path" :value="item.path">
                {{ new Date(item.mtimeMs).toLocaleString() }} ｜ {{ item.name }}
              </option>
            </select>
            <div class="storage-path-actions">
              <button class="danger tiny" @click="restoreDataBackup">恢复备份</button>
            </div>
          </div>
        </div>
        <p class="hint">建议直接选择同一个 `astrashell.data.json` 文件；也可填目录（会自动拼接默认文件名）。把文件放到 iCloud/OneDrive/共享盘/U 盘即可跨设备读取同一份数据。</p>
        <p class="hint">共享文件只保存：主机 / 片段 / 密钥 / 快捷工具。日志为本地数据，不参与多端同步。</p>
      </section>

      <section v-else-if="!focusTerminal && nav === 'logs'" class="panel logs-panel">
        <div class="serial-head">
          <div>
            <h3>操作日志</h3>
            <p class="hosts-header-sub">按服务器/目标分组，点开查看该目标完整历史操作</p>
          </div>
          <div class="serial-head-actions">
            <button class="ghost" @click="refreshAuditLogs">刷新</button>
            <button class="danger" @click="clearAuditLogs">清空日志</button>
          </div>
        </div>
        <div class="grid logs-filter-grid">
          <select v-model="auditSource">
            <option value="all">全部来源</option>
            <option value="ssh">SSH</option>
            <option value="serial">串口</option>
            <option value="local">本地终端</option>
            <option value="app">系统</option>
          </select>
          <input v-model="auditKeyword" placeholder="搜索目标 / 命令 / 错误信息" />
          <button class="muted" @click="refreshAuditLogs">按条件过滤</button>
          <span class="hosts-stat">{{ auditStatus || '未加载' }}</span>
        </div>
        <div class="logs-split">
          <aside class="logs-target-list">
            <button
              v-for="group in auditTargetGroups"
              :key="`target-${group.target}`"
              class="logs-target-item"
              :class="{ active: selectedAuditTarget === group.target }"
              @click="selectedAuditTarget = group.target"
            >
              <div class="logs-target-name">{{ group.target }}</div>
              <div class="logs-target-meta">
                <span>{{ formatAuditSource(group.source) }}</span>
                <span>{{ group.count }} 条</span>
              </div>
              <div class="logs-target-time">{{ formatAuditTime(group.lastTs) }}</div>
            </button>
            <div v-if="auditTargetGroups.length === 0" class="file-row empty">暂无目标</div>
          </aside>
          <div class="logs-list">
            <article v-for="item in currentAuditLogs" :key="item.id" class="log-item">
              <header>
                <span class="log-time">{{ formatAuditTime(item.ts) }}</span>
                <span class="pill">{{ formatAuditSource(item.source) }}</span>
                <span class="pill ghost">{{ formatAuditAction(item.action) }}</span>
              </header>
              <div class="log-target">{{ item.target || '未命名目标' }}</div>
              <pre>{{ item.content || '-' }}</pre>
            </article>
            <div v-if="currentAuditLogs.length === 0" class="file-row empty">请选择左侧目标查看详情</div>
          </div>
        </div>
      </section>

      <section v-else-if="!focusTerminal" class="panel"><h3>模块建设中</h3><p>当前页面：{{ nav }}</p></section>

      <section v-show="focusTerminal" class="terminal-wrap" :class="{ focus: focusTerminal, 'serial-live-shell': activeTerminalMode === 'serial' }">
        <div class="terminal-core">
          <div ref="termEl" class="terminal" @contextmenu.prevent="openTerminalContextMenu"></div>
        </div>
        <aside v-if="activeTerminalMode === 'serial'" class="serial-snippet-rail">
          <div class="serial-rail-head">
            <button class="ghost small" @click="nav = 'snippets'; focusTerminal = false">打开片段库</button>
          </div>
          <div class="serial-rail-search">
            <input v-model="snippetKeyword" placeholder="搜索片段" />
          </div>
          <div class="serial-rail-list">
            <article
              v-for="item in terminalSnippetItems.slice(0, 16)"
              :key="`serial-rail-${item.id}`"
              class="serial-rail-item"
              @click="terminalSnippetId = item.id"
            >
              <header>
                <span>{{ item.name }}</span>
                <small>{{ snippetCommandLines(item.commands).length }} 条</small>
              </header>
              <pre>{{ snippetCommandLines(item.commands).slice(0, 2).join(' ; ') }}</pre>
            </article>
          </div>
        </aside>
      </section>

      <div
        v-if="textMenu.visible"
        class="context-menu"
        :style="{ left: `${textMenu.x}px`, top: `${textMenu.y}px` }"
      >
        <button v-if="textMenu.mode === 'editor'" class="menu-item" @click="cutFromTextMenu">剪切</button>
        <button class="menu-item" @click="copyFromTextMenu">复制</button>
        <button class="menu-item" @click="pasteFromTextMenu">粘贴</button>
        <button class="menu-item" @click="selectAllFromTextMenu">全选</button>
      </div>
    </main>

    <footer class="status-bar fixed-bottom">
      <div class="status-left">状态：{{ snippetStatus || sftpStatus || sshStatus || localStatus || auditStatus || '就绪' }}</div>
      <div class="status-right">
        <span>↑ {{ sftpUploadProgress }}%</span>
        <div class="mini-bar"><div class="mini-fill" :style="{ width: `${sftpUploadProgress}%` }"></div></div>
        <span>↓ {{ sftpDownloadProgress }}%</span>
        <div class="mini-bar"><div class="mini-fill down" :style="{ width: `${sftpDownloadProgress}%` }"></div></div>
      </div>
    </footer>

    <div v-if="startupGateVisible" class="startup-overlay">
      <div class="startup-card">
        <h3 v-if="startupGateMode === 'loading'">正在检查密钥仓库...</h3>
        <template v-else-if="startupGateMode === 'select'">
          <h3>选择数据文件</h3>
          <p>安装完成后，请先决定是初始化一个新数据库，还是直接使用已有数据库文件。</p>
          <div class="grid startup-db-grid">
            <input v-model="startupDbPath" placeholder="数据路径（可选目录或 .json/.db 文件）" />
            <button class="muted" :disabled="startupGateBusy" @click="pickStartupDbPath">打开已有文件</button>
            <button class="muted" :disabled="startupGateBusy" @click="pickStartupDbFolder">选择目录</button>
            <button class="ghost" :disabled="startupGateBusy" @click="useCurrentDbPath">使用当前路径</button>
          </div>
          <div class="grid startup-auth-grid">
            <button class="muted" :disabled="startupGateBusy" @click="beginStartupInit">初始化新数据库</button>
            <button :disabled="startupGateBusy" @click="runUseExistingStorage">使用已有数据库</button>
          </div>
        </template>
        <template v-else-if="startupGateMode === 'init'">
          <h3>首次启动：初始化数据文件与密码</h3>
          <p>请先确定数据文件路径，然后设置主密码完成初始化。</p>
          <div class="grid startup-db-grid">
            <input v-model="startupDbPath" placeholder="数据路径（可选目录或 .json/.db 文件）" />
            <button class="muted" :disabled="startupGateBusy" @click="pickStartupDbSavePath">新建文件</button>
            <button class="muted" :disabled="startupGateBusy" @click="pickStartupDbFolder">选择目录</button>
            <button class="ghost" :disabled="startupGateBusy" @click="useCurrentDbPath">使用当前路径</button>
          </div>
          <p class="hint">当前数据文件：{{ storageDbPath || '读取中...' }}</p>
          <div class="grid startup-auth-grid">
            <input v-model="vaultMaster" type="password" placeholder="设置主密码" />
            <input v-model="startupMasterConfirm" type="password" placeholder="确认主密码" />
          </div>
          <button :disabled="startupGateBusy" @click="runStartupInit">创建并初始化</button>
        </template>
        <template v-else>
          <h3>解锁数据文件</h3>
          <p>进入软件前请先输入主密码。</p>
          <p class="hint">当前数据文件：{{ storageDbPath || '读取中...' }}</p>
          <div class="grid startup-auth-grid">
            <input v-model="vaultMaster" type="password" placeholder="输入主密码" @keyup.enter="runStartupUnlock" />
            <button :disabled="startupGateBusy" @click="runStartupUnlock">解锁并进入</button>
          </div>
        </template>
        <p class="vault-status">{{ startupGateError || plainVaultMessage(vaultStatus) || '就绪' }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.layout { display: grid; grid-template-columns: 220px 1fr; height: 100vh; padding-top: 0; }
.sidebar { background: linear-gradient(180deg, #eef2f7 0%, #e9edf3 100%); border-right: 1px solid var(--border); padding: 8px 16px 16px; display: flex; flex-direction: column; gap: 10px; }
.brand { margin-bottom: 6px; display: flex; justify-content: center; align-items: center; padding: 4px 0 8px; }
.brand-logo { width: 52px; height: 52px; border-radius: 0; object-fit: contain; }
.brand-logo-wide { width: 170px; height: auto; max-width: 100%; }
.sidebar ul { list-style: none; padding: 0; margin: 0; }
.sidebar-nav { flex: 1; min-height: 0; overflow: auto; }
.sidebar li { padding: 10px 10px; border-radius: 10px; color: var(--text-main); cursor: pointer; margin-bottom: 6px; display: flex; align-items: center; gap: 8px; }
.sidebar li:hover { background: #dfe5ee; }
.sidebar li.active { background: #dbeafe; color: #1d4ed8; font-weight: 600; }
.sidebar-footer { border: 1px solid #d4dde8; border-radius: 12px; background: #f7fafd; padding: 10px; display: grid; gap: 8px; justify-items: center; }
.sidebar-footer-logo { width: 34px; height: 34px; border-radius: 0; object-fit: contain; flex-shrink: 0; }
.sidebar-footer-logo-wide { width: 44px; height: auto; }
.sidebar-footer-text { width: 100%; display: grid; justify-items: center; gap: 2px; }
.sidebar-footer-title { font-size: 13px; font-weight: 700; color: #0f172a; }
.sidebar-footer-sub { font-size: 11px; color: #64748b; }
.sidebar-footer-link { font-size: 11px; color: #2563eb; text-decoration: none; }
.sidebar-footer-link:hover { text-decoration: underline; }
.main { padding: 12px; padding-bottom: 42px; display: flex; flex-direction: column; gap: 10px; height: 100vh; overflow: hidden; }
.top-actions { flex-shrink: 0; }
.terminal-top-actions { display: flex; flex-direction: column; gap: 8px; background: #f5f8fc; border: 1px solid #dbe3ee; border-radius: 12px; padding: 8px 10px; }
.terminal-mode-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.terminal-actions-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.terminal-tabs { display: flex; align-items: center; gap: 8px; overflow-x: auto; padding-bottom: 2px; }
.local-tabs { margin-bottom: 6px; }
.session-strip { display: flex; align-items: center; gap: 10px; background: #f5f8fc; border: 1px solid #dbe3ee; border-radius: 12px; padding: 8px 10px; }
.session-strip-title { font-size: 12px; color: #334155; white-space: nowrap; }
.session-strip-tabs { flex: 1; min-width: 0; }
.terminal-tab { display: inline-flex; align-items: center; gap: 8px; max-width: 240px; background: #e8edf6; border: 1px solid #d4dde9; border-radius: 999px; padding: 4px 10px; cursor: pointer; }
.terminal-tab.active { background: #dbeafe; border-color: #93c5fd; }
.terminal-tab-name { max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 12px; color: #0f172a; }
.terminal-tab-close { border: none; background: transparent; color: #64748b; font-size: 15px; line-height: 1; padding: 0 2px; min-width: auto; cursor: pointer; }
.terminal-tab-close:hover { color: #ef4444; }
.terminal-tools-left,
.terminal-tools-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.terminal-tools-right { margin-left: auto; }
.terminal-tools-right .encoding-select { min-width: 180px; }
.terminal-tools-right select { min-width: 220px; max-width: 360px; }
.topbar,.panel,.terminal-wrap { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 10px; }
.topbar { display: flex; align-items: center; justify-content: space-between; padding-left: 110px; min-height: 42px; -webkit-app-region: drag; flex-shrink: 0; }
.title { font-weight: 700; font-size: 14px; color: #111827; }
.actions { display: flex; gap: 8px; }
button.ghost { background: #f3f4f6; color: #111827; border: 1px solid #e5e7eb; display: inline-flex; align-items: center; gap: 6px; }
button.small { padding: 4px 8px; font-size: 12px; margin-left: auto; }
.topbar .actions, .topbar .actions *, .topbar button { -webkit-app-region: no-drag; }
.key-input { grid-column: span 2; }
.grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
.grid.update-grid { margin-top: 6px; }
.panel { overflow: auto; min-height: 120px; }
.hosts-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: linear-gradient(180deg, #d7dde3 0%, #d2d9df 100%); }
.sftp-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
input,select,button,textarea { padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; font-family: inherit; }
textarea { min-height: 74px; resize: vertical; }
button { background: #3b82f6; color: white; border: none; cursor: pointer; }
button.muted { background: #6b7280; }
button.danger { background: #ef4444; }
button.tiny { padding: 4px 10px; font-size: 11px; }
.tabs { display: flex; gap: 8px; margin: 8px 0 10px; flex-wrap: wrap; }
.tab { background: #e5e7eb; color: #111827; }
.tab.activeTab { background: #2563eb; color: #fff; }
.tab .x { margin-left: 6px; font-weight: 700; }
.send-box { display: grid; grid-template-columns: 1fr auto 180px 120px 120px; gap: 10px; margin-top: 10px; align-items: center; }
.serial-panel,
.local-panel,
.logs-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; overflow: hidden; }
.serial-connect-shell { flex: 1; min-height: 0; display: grid; grid-template-columns: 420px minmax(0, 1fr); gap: 14px; align-items: start; }
.serial-connect-card { width: 100%; border: 1px solid #cdd6e2; border-radius: 14px; padding: 14px; background: linear-gradient(180deg, #f8fbff 0%, #eef3f9 100%); display: grid; gap: 10px; box-shadow: inset 0 1px 0 rgba(255,255,255,.7); }
.serial-title { display: flex; align-items: center; gap: 10px; }
.serial-title h3 { margin: 0; font-size: 24px; letter-spacing: 0.02em; color: #1f2937; }
.serial-title-icon { width: 34px; height: 34px; border-radius: 10px; background: #1e293b; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 16px; }
.serial-route-line { display: flex; align-items: center; gap: 8px; color: #2563eb; font-size: 14px; }
.serial-route-line i { flex: 1; height: 4px; border-radius: 999px; background: linear-gradient(90deg, #3b82f6, #0f172a); display: block; }
.serial-form-stack { display: grid; gap: 8px; }
.serial-field-label { font-size: 12px; color: #2563eb; font-weight: 700; letter-spacing: 0.02em; }
.serial-form-stack > select,
.serial-form-stack > input { width: 100%; background: #fff; }
.serial-baud-row { display: grid; grid-template-columns: 170px minmax(0, 1fr); gap: 8px; }
.serial-baud-row > select,
.serial-baud-row > input { width: 100%; min-width: 0; background: #fff; }
.serial-advanced-toggle { justify-content: space-between; width: 100%; }
.serial-advanced-panel { border: 1px solid #d8e0ea; border-radius: 10px; background: #f4f7fb; padding: 10px; display: grid; gap: 8px; }
.serial-advanced-panel label { font-size: 12px; color: #3b82f6; font-weight: 600; }
.serial-segment { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.serial-segment.flow { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.seg-btn { background: #e5ebf2; color: #334155; border: 1px solid #d1dae6; border-radius: 8px; font-size: 12px; padding: 6px 4px; }
.seg-btn.active { background: #2f80ed; color: #fff; border-color: #2f80ed; }
.serial-send-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) 180px; gap: 8px; align-items: center; }
.serial-inline-check { display: inline-flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid #d1dae6; border-radius: 8px; background: #f8fbff; color: #334155; font-size: 12px; }
.serial-inline-check input { width: 14px; height: 14px; margin: 0; }
.serial-send-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.serial-send-actions button { width: 100%; }
.serial-connect-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.serial-connect-btn { min-width: 120px; background: #2563eb; }
.serial-dialog-panel { border: 1px solid #cbd7e6; border-radius: 14px; background: linear-gradient(180deg, #f8fbff 0%, #edf3fb 100%); padding: 12px; min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 10px; }
.serial-dialog-info { border: 1px solid #d3deeb; border-radius: 12px; background: #ffffff; padding: 10px 12px; display: grid; gap: 4px; }
.serial-dialog-info-title { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; }
.serial-dialog-info-main { font-size: 18px; line-height: 1.2; color: #0f172a; font-weight: 800; }
.serial-dialog-info-sub { font-size: 12px; color: #334155; }
.serial-dialog-list { min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
.serial-dialog-item { border: 1px solid #d6e0eb; border-radius: 10px; background: #fff; padding: 8px 10px; display: grid; gap: 6px; box-shadow: 0 1px 0 rgba(15, 23, 42, 0.04); }
.serial-dialog-item header { display: flex; justify-content: space-between; align-items: center; gap: 8px; color: #475569; font-size: 12px; font-weight: 600; }
.serial-dialog-item header small { color: #94a3b8; font-weight: 500; }
.serial-dialog-item pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; color: #0f172a; font-family: ui-monospace, Menlo, Monaco, Consolas, "PingFang SC", "Microsoft YaHei", monospace; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px; }
.serial-dialog-item.type-tx { border-left: 4px solid #2563eb; }
.serial-dialog-item.type-rx { border-left: 4px solid #16a34a; }
.serial-dialog-item.type-sys { border-left: 4px solid #0f172a; }
.serial-dialog-item.type-err { border-left: 4px solid #dc2626; background: #fff7f7; }
.serial-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.serial-head h3 { margin: 0; }
.serial-head-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.serial-config-card,
.local-tools-card { border: 1px solid #c9d6e5; border-radius: 14px; background: linear-gradient(180deg, #eef5ff 0%, #e6eef8 100%); padding: 12px; display: grid; gap: 10px; }
.serial-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 0; }
.baud-input-wrap { min-width: 0; }
.baud-input-wrap input { width: 100%; }
.local-shell-grid { grid-template-columns: 220px minmax(0, 1fr); margin-top: 0; align-items: center; }
.local-status { padding: 8px 10px; border-radius: 10px; border: 1px solid #cbd5e1; background: #f8fafc; color: #334155; font-size: 12px; }
.local-quick-layout { display: grid; grid-template-columns: minmax(0, 1fr) 0; gap: 10px; min-height: 0; }
.local-quick-layout.editor-open { grid-template-columns: minmax(0, 1fr) 340px; }
.local-tool-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; align-content: start; }
.local-tool-item { border: 1px solid #d1dae5; border-radius: 10px; background: #f8fbff; padding: 8px; display: grid; gap: 8px; }
.local-tool-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.local-quick-toolbar { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
.local-quick-editor-column { width: 100%; min-width: 0; overflow: hidden; transition: width .2s ease; }
.local-quick-editor-column.visible { width: 100%; min-width: 0; }
.local-quick-editor-panel { background: #f8fafc; border: 1px solid #d3dce6; border-radius: 12px; padding: 12px; height: 100%; }
.local-quick-editor { margin-top: 6px; display: grid; gap: 8px; }
.local-quick-editor-actions { display: flex; gap: 8px; justify-content: flex-end; }
.logs-filter-grid { grid-template-columns: 180px 1fr auto auto; margin-top: 0; align-items: center; }
.logs-split { flex: 1; min-height: 0; display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 10px; overflow: hidden; }
.logs-target-list { border: 1px solid #d1dae5; border-radius: 12px; background: #f8fbff; padding: 10px; overflow: auto; min-height: 0; display: grid; gap: 8px; align-content: start; }
.logs-target-item { text-align: left; border: 1px solid #d7dfeb; border-radius: 10px; background: #fff; color: #0f172a; display: grid; gap: 4px; }
.logs-target-item.active { border-color: #3b82f6; box-shadow: inset 0 0 0 1px #3b82f6; background: #eff6ff; }
.logs-target-name { font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.logs-target-meta { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; color: #64748b; }
.logs-target-time { font-size: 11px; color: #94a3b8; }
.logs-list { border: 1px solid #d1dae5; border-radius: 12px; background: #f8fbff; padding: 10px; overflow: auto; min-height: 0; display: flex; flex-direction: column; gap: 8px; }
.log-item { border: 1px solid #d7dfeb; border-radius: 10px; background: #fff; padding: 8px; display: grid; gap: 6px; }
.log-item header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.log-time { font-size: 12px; color: #334155; font-weight: 600; }
.log-target { font-size: 12px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.log-item pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; color: #0f172a; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px; max-height: 140px; overflow: auto; font-family: ui-monospace, Menlo, Monaco, Consolas, "PingFang SC", "Microsoft YaHei", monospace; }
.terminal-wrap { flex: 1; min-height: 220px; overflow: hidden; display: grid; grid-template-columns: 1fr; }
.terminal-wrap.focus { flex: 1; min-height: 0; }
.terminal-core { min-height: 0; height: 100%; }
.terminal { height: 100%; }
.terminal-wrap.focus .terminal { height: 100%; }
.serial-live-shell { grid-template-columns: minmax(0, 1fr) 300px; gap: 12px; }
.serial-snippet-rail { border: 1px solid #d1dae5; border-radius: 12px; background: #f3f6fb; padding: 10px; display: grid; grid-template-rows: auto auto 1fr; gap: 8px; min-height: 0; }
.serial-rail-head { display: flex; justify-content: flex-end; }
.serial-rail-search input { width: 100%; }
.serial-rail-list { overflow: auto; min-height: 0; display: grid; gap: 8px; align-content: start; }
.serial-rail-item { border: 1px solid #d7dfeb; border-radius: 10px; background: #fff; padding: 8px; display: grid; gap: 6px; cursor: pointer; }
.serial-rail-item header { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; }
.serial-rail-item pre { margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 11px; color: #64748b; }
.serial-live-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
:deep(.xterm .xterm-selection div) { background-color: rgba(96, 165, 250, 0.55) !important; }
:deep(.xterm .xterm-rows) { cursor: text; }
:deep(.xterm) {
  text-rendering: geometricPrecision;
  -webkit-font-smoothing: antialiased;
  font-feature-settings: "liga" 1, "calt" 1;
}
textarea::selection,
input::selection { background: #bfdbfe; color: #0f172a; }
.sftp-status-line { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0 10px; }
.status-pill { display: inline-flex; align-items: center; height: 24px; padding: 0 10px; border-radius: 999px; border: 1px solid #cbd5e1; background: #f8fafc; color: #334155; font-size: 12px; }
.status-pill.online { background: #dcfce7; border-color: #86efac; color: #166534; }
.status-pill.mode { background: #dbeafe; border-color: #93c5fd; color: #1d4ed8; }
.status-pill.plain { background: #f1f5f9; color: #475569; }
.split-head { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin:2px 0 10px; }
.head-left { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:8px; flex:1; }
.head-right { position:relative; }
.path-chip { display:flex; flex-direction:column; gap:4px; padding:8px 10px; border:1px solid #d0d8e2; border-radius:12px; background:linear-gradient(180deg, #f8fbff 0%, #edf3f9 100%); color:#334155; font-size:12px; min-width:0; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7); }
.path-chip header { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.path-chip b { font-size:11px; color:#475569; font-weight:700; }
.path-chip em { font-style: normal; font-size: 11px; color: #2563eb; border: 1px solid #bfdbfe; background: #eff6ff; border-radius: 999px; padding: 1px 8px; }
.path-chip span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-weight:600; }
.path-chip small { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#64748b; font-size:11px; }
.path-chip i { font-style: normal; color: #64748b; font-size: 11px; }
.connect-panel { position:absolute; right:0; top:38px; background:#fff; border:1px solid var(--border); border-radius:10px; padding:10px; display:grid; gap:8px; min-width:280px; z-index:20; }
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; min-height: 0; flex: 1; overflow: hidden; }
.split > div { border: 1px solid #dbe2ea; background: #f8fafc; border-radius: 10px; padding: 8px; display: flex; flex-direction: column; min-height: 0; }
.split > div:nth-child(2) { background: #f1f5f9; border-color: #cbd5e1; }
.file-panel { background: rgba(255, 255, 255, 0.85); border: 1px solid rgba(15,23,42,0.08); border-radius: 16px; padding: 14px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.6); min-height: 0; }
.file-panel-head { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.file-head-actions { display:flex; align-items:center; gap:6px; flex-wrap:wrap; justify-content:flex-end; }
.connect-inline { margin-top: 8px; padding: 10px; border: 1px solid #d3dce6; border-radius: 10px; background: #f8fbff; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 8px; align-items: center; }
.connect-inline > select { min-width: 0; background: #fff; }
.connect-inline > button { margin-left: 0; white-space: nowrap; }
.connect-filters { display: grid; grid-template-columns: 132px minmax(0, 1fr); gap: 8px; min-width: 0; }
.connect-filters input,
.connect-filters select { width: 100%; min-width: 0; background: #fff; }
.file-search-row { margin-top: 8px; }
.file-search-row input { width: 100%; background: #fff; }
.file-sort { min-width: 120px; padding: 6px 8px; font-size: 12px; }
.file-stack { display:flex; flex-direction:column; gap: 8px; flex: 1; min-height: 0; overflow:auto; margin-top: 8px; }
.file-row { display:flex; align-items:center; justify-content:space-between; gap: 12px; padding: 8px 10px; border-radius: 10px; border: 1px solid transparent; background: rgba(248, 250, 252, 0.8); transition: background 0.2s ease, border 0.2s ease; }
.file-row.is-dir { background: rgba(59, 130, 246, 0.1); }
.file-row.active { border-color: var(--primary); background: rgba(37, 99, 235, 0.15); }
.file-row:not(.empty):hover { background: rgba(59, 130, 246, 0.1); }
.file-row.empty { justify-content:center; color: #94a3b8; background: transparent; border: 1px dashed rgba(15,23,42,0.2); }
.file-info { display:flex; align-items:center; gap: 8px; font-weight: 400; font-size: 12px; }
.file-icon { font-size: 14px; }
.file-name { color: #0f172a; font-size: 12px; font-weight: 400; }
.file-meta { display:flex; align-items:center; gap: 14px; font-size: 11px; color: #475569; font-weight: 400; }
.file-meta span { opacity: 0.8; display:inline-flex; gap: 6px; }
.list { margin: 6px 0 0; padding-left: 18px; flex: 1; min-height: 0; overflow: auto; }
.list li { display: flex; justify-content: space-between; padding-right: 8px; cursor: pointer; }
h4 { margin: 4px 0; font-size: 12px; font-weight: 600; }
.hosts-header { display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; }
.hosts-header h3 { margin: 0; font-size: 19px; color: #111827; }
.hosts-header-sub { color: #475569; font-size: 12px; margin: 0; }
.hosts-quick-connect { display: grid; grid-template-columns: minmax(320px, 1fr) auto auto; gap: 8px; padding: 8px; border: 1px solid #cbd5e1; border-radius: 12px; background: #eef3f7; }
.hosts-quick-connect input { width: 100%; min-width: 0; background: #fff; }
.hosts-quick-connect button { white-space: nowrap; margin-left: 0; }
.password-field { display: flex; align-items: center; gap: 6px; width: 100%; }
.password-field input { flex: 1; min-width: 0; }
.password-toggle { flex-shrink: 0; }
.hosts-layout.new-layout { display: grid; grid-template-columns: 190px minmax(0, 1fr) auto; gap: 12px; align-items: stretch; flex: 1; min-height: 0; }
.hosts-left { background: #e7edf2; border: 1px solid #cbd5e1; border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 8px; min-height: 0; overflow: auto; }
.hosts-left-title { display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 13px; color: #1f2937; }
.cat-item { display: flex; align-items: center; gap: 6px; border: 1px solid #d1d9e2; background: #f7fafc; border-radius: 10px; padding: 4px; }
.cat-item.activeCat { border-color: #4f8cff; background: #e9f1ff; }
.cat-name { flex: 1; text-align: left; background: transparent; color: #0f172a; padding: 6px 8px; }
.icon-btn { width: 26px; height: 26px; border: 1px solid #dbe4ef; border-radius: 8px; background: #fff; color: #475569; display: inline-flex; align-items: center; justify-content: center; }
.input-item { border-style: dashed; background: #f8fbff; }
.input-item input { width: 100%; }
.hosts-center { border: 1px solid #c5ced8; border-radius: 12px; padding: 12px; background: #d6dde3; display: flex; flex-direction: column; gap: 12px; min-height: 0; overflow: hidden; }
.hosts-toolbar { display: flex; align-items: center; gap: 10px; }
.hosts-toolbar input { flex: 1; min-width: 0; background: #f7fbff; }
.hosts-stat { font-size: 12px; color: #475569; white-space: nowrap; }
.host-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px; overflow: auto; flex: 1; min-height: 0; align-content: start; }
.host-card { background: #f8fafc; border: 1px solid #d4dce6; border-radius: 12px; padding: 9px 10px; cursor: pointer; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.host-card:hover { border-color: #9bbcff; background: #f5f9ff; }
.host-card.activeHost { border-color: #3b82f6; box-shadow: inset 0 0 0 1px #3b82f6; background: #f0f6ff; }
.host-card-main { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
.host-icon { width: 34px; height: 34px; border-radius: 10px; background: #e9eff6; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; }
.host-card-body { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.host-card-title { font-weight: 700; font-size: 14px; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.host-line { font-size: 12px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.host-card-meta { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.pill { border-radius: 999px; padding: 2px 8px; font-size: 11px; background: #e8edf3; color: #334155; border: 1px solid #d7dee8; }
.pill.ghost { background: #f6f8fb; }
.status-dot-btn,
.host-edit-btn { width: 26px; height: 26px; border: 1px solid #d5dde8; border-radius: 8px; background: #f8fbff; color: #475569; display: inline-flex; align-items: center; justify-content: center; padding: 0; }
.status-dot-btn:hover,
.host-edit-btn:hover { background: #eef5ff; border-color: #93c5fd; color: #1d4ed8; }
.status-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; background: #94a3b8; }
.status-dot.online { background: #22c55e; box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.18); }
.status-dot.offline { background: #ef4444; box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.16); }
.status-dot.unknown { background: #94a3b8; }
.status-dot.checking { background: #3b82f6; animation: host-ping 1s ease-in-out infinite; }
@keyframes host-ping {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.25); opacity: 0.7; }
}
.hosts-editor-column { width: 0; min-width: 0; overflow: hidden; transition: width 0.2s ease; }
.hosts-editor-column.visible { width: 340px; min-width: 340px; }
.host-editor-panel { background: #f2f6fb; border-radius: 12px; padding: 12px; border: 1px solid #c5d1dc; height: 100%; overflow: auto; }
.editor-title { display: flex; align-items: center; gap: 6px; justify-content: space-between; font-weight: 700; color: #111827; position: sticky; top: 0; background: #f2f6fb; padding-bottom: 8px; z-index: 2; }
.grid.compact { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.ssh-edit-zone { margin-top: 4px; display: flex; flex-direction: column; gap: 10px; }
.ssh-edit-grid { display: grid; grid-template-columns: 1fr; gap: 10px; }
.ssh-module { background: #ffffff; border: 1px solid #d8e1eb; border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.module-title { font-size: 12px; font-weight: 700; color: #2563eb; letter-spacing: 0.02em; text-transform: uppercase; }
.ssh-module input,
.ssh-module select { width: 100%; }
.ssh-module label { font-size: 12px; color: #475569; }
.ssh-actions { display:flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
.ssh-actions button { flex: 1 1 auto; }
.snippets-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 10px; overflow: hidden; }
.snippets-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.snippets-header h3 { margin: 0; }
.snippets-run-settings { display: flex; align-items: center; gap: 8px; }
.snippets-run-settings label { font-size: 12px; color: #475569; white-space: nowrap; }
.snippets-run-settings input { width: 110px; }
.snippets-layout { display: grid; grid-template-columns: 160px minmax(260px, 0.82fr) minmax(520px, 1.18fr); gap: 12px; flex: 1; min-height: 0; overflow: hidden; }
.snippets-layout > * { min-width: 0; }
.snippets-left { background: #edf2f8; border: 1px solid #d4dde8; border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 8px; overflow: auto; }
.snippets-center { border: 1px solid #d1dae5; border-radius: 12px; padding: 10px; background: #edf3f8; display: flex; flex-direction: column; gap: 8px; min-height: 0; overflow: hidden; }
.snippets-toolbar { display: flex; align-items: center; gap: 8px; }
.snippets-toolbar input { flex: 1; min-width: 0; background: #fff; }
.snippet-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(178px, 1fr)); gap: 8px; overflow: auto; min-height: 0; align-content: start; }
.snippet-card { background: #f8fafc; border: 1px solid #d4dce6; border-radius: 12px; padding: 8px; display: flex; flex-direction: column; gap: 6px; cursor: pointer; min-height: 104px; }
.snippet-card:hover { border-color: #93c5fd; background: #f3f8ff; }
.snippet-card.activeSnippet { border-color: #3b82f6; box-shadow: inset 0 0 0 1px #3b82f6; background: #eff6ff; }
.snippet-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.snippet-card-title { font-size: 13px; font-weight: 700; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.snippet-card-desc { font-size: 11px; color: #475569; line-height: 1.35; min-height: 28px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.snippet-card-host { font-size: 11px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.snippet-card-foot { margin-top: auto; display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: #64748b; gap: 8px; }
.snippet-run-btn { flex-shrink: 0; border: 1px solid #4f46e5; border-radius: 999px; background: linear-gradient(135deg, #4f46e5, #2563eb); color: #fff; font-size: 11px; padding: 4px 10px; }
.snippets-editor-column { min-width: 0; }
.snippets-editor-column.visible { min-width: 0; }
.snippets-editor-panel { background: #f8fafc; border: 1px solid #d3dce6; border-radius: 12px; padding: 12px; height: 100%; min-height: 0; overflow: hidden; display: flex; flex-direction: column; gap: 10px; }
.snippet-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; flex: 1; min-height: 0; overflow: auto; align-content: start; }
.snippet-form-grid .snippet-desc-input { grid-column: span 2; }
.snippet-form-grid .snippet-command-input,
.snippet-form-grid .hint,
.snippet-form-grid .snippet-actions { grid-column: span 2; }
.snippet-command-input { min-height: 360px; font-family: ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; line-height: 1.45; }
.snippet-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 4px; }
.snippet-btn { min-height: 38px; border-radius: 10px; font-size: 12px; font-weight: 600; border: 1px solid transparent; box-shadow: 0 1px 0 rgba(15, 23, 42, 0.06); transition: transform .12s ease, box-shadow .2s ease, filter .2s ease; }
.snippet-btn.primary { background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #fff; }
.snippet-btn.success { background: linear-gradient(135deg, #0ea5e9, #0284c7); color: #fff; }
.snippet-btn.danger { background: linear-gradient(135deg, #ef4444, #dc2626); color: #fff; }
.snippet-btn.ghost { background: #f8fafc; color: #334155; border-color: #cbd5e1; }
.snippet-btn:not(:disabled):hover { transform: translateY(-1px); box-shadow: 0 6px 14px rgba(15, 23, 42, 0.12); filter: saturate(1.05); }
.snippet-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.vault-panel { display:flex; flex-direction:column; gap:10px; min-height:0; }
.vault-header { display:flex; flex-direction:column; gap:8px; }
.vault-header h3 { margin:0; }
.vault-toolbar { display:grid; grid-template-columns: 1.2fr auto auto auto; gap:8px; }
.vault-status { margin:0; font-size:12px; color:#475569; }
.vault-layout { display:grid; grid-template-columns: minmax(0, 1fr) 360px; gap:12px; flex:1; min-height:0; }
.vault-list { background:#eef3f8; border:1px solid #d3dce6; border-radius:12px; padding:10px; display:flex; flex-direction:column; gap:10px; min-height:0; }
.vault-list-head { display:grid; grid-template-columns: minmax(0, 1fr) auto; gap:8px; }
.vault-card-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap:8px; overflow:auto; min-height:0; align-content:start; }
button.vault-mini-card { text-align:left; background:#f8fafc; color:#0f172a; border:1px solid #d4dce6; border-radius:10px; padding:8px 10px; display:flex; flex-direction:column; gap:6px; min-height:88px; }
button.vault-mini-card:hover { border-color:#93c5fd; background:#f3f7ff; }
button.vault-mini-card.active { border-color:#3b82f6; box-shadow: inset 0 0 0 1px #3b82f6; background:#eff6ff; }
.vault-mini-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.vault-mini-title { font-size:13px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:140px; }
.vault-mini-fp { font-size:11px; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.vault-mini-time { font-size:11px; color:#94a3b8; }
.vault-editor-column { width:360px; min-width:360px; }
.vault-editor-panel { background:#f8fafc; border:1px solid #d3dce6; border-radius:12px; padding:12px; height:100%; overflow:auto; }
.vault-form-grid { display:grid; gap:8px; }
.vault-form-grid .key-input { min-height:92px; }
.vault-actions { display:flex; justify-content:flex-end; gap:8px; }
.empty-tip { color: #6b7280; font-size: 13px; padding: 8px 0; }
.divider { height: 1px; background: #e5e7eb; margin: 12px 0; }
.update-progress { margin-top: 8px; display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; }
.update-progress-bar { height: 8px; background: #e5e7eb; border-radius: 999px; overflow: hidden; }
.update-progress-fill { height: 100%; background: linear-gradient(90deg, #3b82f6, #2563eb); transition: width .2s ease; }
.manual-update-card { margin-top: 10px; border: 1px solid #cbd5e1; border-radius: 12px; background: #f8fafc; padding: 12px; display: grid; gap: 10px; }
.manual-update-head { display: grid; gap: 4px; color: #334155; font-size: 13px; }
.manual-update-head strong { color: #0f172a; font-size: 14px; }
.manual-update-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.manual-update-link { color: #2563eb; font-size: 12px; word-break: break-all; text-decoration: none; }
.manual-update-link:hover { text-decoration: underline; }
.storage-path-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; }
.storage-path-actions { display: inline-flex; align-items: center; gap: 6px; flex-wrap: nowrap; white-space: nowrap; }
.storage-path-actions .tiny { min-width: 64px; padding: 6px 8px; }
.storage-backup-card { margin-top: 8px; border: 1px solid #cbd5e1; border-radius: 12px; background: #f8fafc; padding: 10px; display: grid; gap: 8px; }
.status-bar { height: 28px; border: 1px solid #d1d5db; border-radius: 8px; background: #f8fafc; display: flex; align-items: center; justify-content: space-between; padding: 0 10px; font-size: 12px; color: #374151; z-index: 50; }
.fixed-bottom { position: fixed; left: 232px; right: 12px; bottom: 8px; }
.layout.terminal-layout { grid-template-columns: 1fr; }
.layout.terminal-layout .sidebar { display: none; }
.layout.terminal-layout .main { padding: 10px 12px 42px; }
.layout.terminal-layout .fixed-bottom { left: 12px; }
.status-right { display: flex; align-items: center; gap: 6px; min-width: 320px; }
.mini-bar { width: 90px; height: 6px; background: #e5e7eb; border-radius: 999px; overflow: hidden; }
.mini-fill { height: 100%; background: #3b82f6; transition: width .2s ease; }
.mini-fill.down { background: #10b981; }
.context-menu {
  position: fixed;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
  z-index: 99;
  display: flex;
  flex-direction: column;
  min-width: 120px;
  padding: 6px;
}
.menu-item {
  text-align: left;
  background: #f3f4f6;
  color: #111827;
  margin: 2px 0;
}
.startup-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(15, 23, 42, 0.46); display: flex; align-items: center; justify-content: center; padding: 16px; }
.startup-card { width: min(560px, 94vw); background: #f8fbff; border: 1px solid #cbd5e1; border-radius: 14px; padding: 16px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 18px 50px rgba(15, 23, 42, 0.25); }
.startup-card h3 { margin: 0; color: #0f172a; font-size: 18px; }
.startup-card p { margin: 0; color: #334155; font-size: 13px; }
.startup-db-grid { grid-template-columns: minmax(0, 1fr) auto auto; }
.startup-auth-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
@media (max-width: 1500px) {
  .hosts-layout.new-layout { grid-template-columns: 176px minmax(0, 1fr) auto; }
  .hosts-editor-column.visible { width: 320px; min-width: 320px; }
}
@media (max-width: 1280px) {
  .hosts-layout.new-layout { grid-template-columns: 170px minmax(0, 1fr); }
  .hosts-editor-column { display: none; }
  .host-grid { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
  .snippets-layout { grid-template-columns: 160px minmax(0, 1fr); }
  .snippets-editor-column { display: none; }
  .vault-layout { grid-template-columns: 1fr; }
  .vault-editor-column { width:auto; min-width:0; }
  .split { grid-template-columns: 1fr; }
  .head-left { grid-template-columns: 1fr; }
  .serial-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .serial-baud-row { grid-template-columns: 1fr; }
  .serial-send-toolbar { grid-template-columns: 1fr; }
  .local-shell-grid { grid-template-columns: 1fr; }
  .local-quick-layout { grid-template-columns: 1fr; }
  .local-quick-editor-column,
  .local-quick-editor-column.visible { width: auto; min-width: 0; }
  .local-tool-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .logs-filter-grid { grid-template-columns: 1fr 1fr; }
  .serial-connect-shell { grid-template-columns: 1fr; }
  .logs-split { grid-template-columns: 260px minmax(0, 1fr); }
  .serial-live-shell { grid-template-columns: minmax(0, 1fr) 260px; }
}
@media (max-width: 1080px) {
  .hosts-quick-connect { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .hosts-quick-connect button { grid-column: span 2; }
}
@media (max-width: 860px) {
  .hosts-layout.new-layout { grid-template-columns: 1fr; }
  .hosts-left { display: none; }
  .snippets-layout { grid-template-columns: 1fr; }
  .snippets-left { display: none; }
  .hosts-quick-connect { grid-template-columns: 1fr; }
  .hosts-quick-connect button { grid-column: span 1; }
  .terminal-actions-row { flex-direction: column; align-items: stretch; }
  .terminal-tools-right { margin-left: 0; }
  .terminal-tools-right select { min-width: 0; width: 100%; max-width: none; }
  .terminal-tab { max-width: 180px; }
  .snippets-header { flex-direction: column; align-items: flex-start; }
  .snippets-run-settings input { width: 100%; }
  .vault-toolbar { grid-template-columns: 1fr 1fr; }
  .storage-path-row { grid-template-columns: 1fr; }
  .storage-path-actions { flex-wrap: wrap; }
  .startup-db-grid,
  .startup-auth-grid { grid-template-columns: 1fr; }
  .connect-inline { grid-template-columns: 1fr; }
  .connect-filters { grid-template-columns: 1fr; }
  .serial-grid,
  .send-box,
  .serial-send-toolbar,
  .serial-send-actions,
  .local-connect-grid,
  .logs-filter-grid,
  .local-tool-grid { grid-template-columns: 1fr; }
  .logs-split,
  .serial-live-shell { grid-template-columns: 1fr; }
  .serial-snippet-rail { display: none; }
}

.hint { color: #6b7280; font-size: 12px; }
</style>
