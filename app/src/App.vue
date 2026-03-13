<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Server, FolderTree, Cable, KeyRound, Settings, Pencil } from 'lucide-vue-next'
import '@xterm/xterm/css/xterm.css'

type NavKey = 'hosts' | 'sftp' | 'snippets' | 'serial' | 'vault' | 'settings'
const nav = ref<NavKey>('hosts')
const termEl = ref<HTMLElement | null>(null)

const DEFAULT_CATEGORY = '默认'
const ALL_CATEGORY = '全部'
const LEGACY_SNIPPET_STORAGE_KEY = 'astrashell.snippets.v1'
const SNIPPET_DEFAULT_CATEGORY = '部署'
const SNIPPET_ALL_CATEGORY = '全部'

const sshForm = ref({ host: '', port: 22, username: 'root', password: '' })
const authType = ref<'password' | 'key'>('password')
const selectedKeyRef = ref('')
const sshStatus = ref('')
const sshSessionId = ref('default')
const sshConnected = ref(false)
const focusTerminal = ref(false)

type LocalSSHConfig = { host: string; port?: number; username: string; password?: string; privateKey?: string }
const sshTabs = ref<Array<{ id: string; name: string; connected: boolean }>>([{ id: 'default', name: '会话-1', connected: false }])
const sshBuffers = ref<Record<string, string>>({ default: '' })

const hostName = ref('')
const hostCategory = ref(DEFAULT_CATEGORY)
const hostItems = ref<any[]>([])
const selectedHostId = ref('')
const editingHost = ref<any | null>(null)
const hostEditorVisible = ref(false)
const selectedCategory = ref(ALL_CATEGORY)
const hostKeyword = ref('')
const newCategoryName = ref('')
const newCategoryInputVisible = ref(false)

const extraCategories = ref<string[]>([])
type HostProbeState = 'unknown' | 'checking' | 'online' | 'offline'
const hostProbeById = ref<Record<string, { state: HostProbeState; detail?: string }>>({})
let hostProbeBatchId = 0

const notify = (ok: boolean, message: string) => {
  if (ok) {
    sshStatus.value = `✅ ${message}`
    window.alert(`✅ ${message}`)
  } else {
    sshStatus.value = `❌ ${message}`
    window.alert(`❌ ${message}`)
  }
}

const hostCategories = computed(() => {
  const set = new Set<string>([DEFAULT_CATEGORY])
  hostItems.value.forEach((h) => set.add(h.category || DEFAULT_CATEGORY))
  extraCategories.value.forEach((c) => set.add(c))
  return Array.from(set)
})

const displayCategories = computed(() => [ALL_CATEGORY, ...hostCategories.value])

const addCategory = () => {
  const name = newCategoryName.value.trim()
  if (!name) {
    newCategoryInputVisible.value = false
    return
  }
  if (!extraCategories.value.includes(name) && !hostCategories.value.includes(name)) {
    extraCategories.value.push(name)
  }
  selectedCategory.value = name
  newCategoryName.value = ''
  newCategoryInputVisible.value = false
  notify(true, `分类已新建：${name}`)
}

const beginAddCategory = () => {
  newCategoryInputVisible.value = true
  newCategoryName.value = ''
}

const renameCategoryInline = async (from: string) => {
  if (from === DEFAULT_CATEGORY || from === ALL_CATEGORY) return
  const to = window.prompt('重命名分类', from)?.trim()
  if (!to || to === from) return

  extraCategories.value = extraCategories.value.map((c) => (c === from ? to : c))

  const targets = hostItems.value.filter((h) => (h.category || DEFAULT_CATEGORY) === from)
  for (const h of targets) {
    await window.lightterm.hostsSave({
      id: h.id,
      name: h.name,
      host: h.host,
      port: h.port,
      username: h.username,
      password: h.password || '',
      category: to,
      authType: h.auth_type || 'password',
      privateKeyRef: h.private_key_ref || null,
    })
  }
  selectedCategory.value = to
  await refreshHosts()
  notify(true, `分类已重命名：${from} → ${to}`)
}

const filteredHosts = computed(() => {
  const keyword = hostKeyword.value.trim().toLowerCase()
  return hostItems.value.filter((h) => {
    const categoryName = h.category || DEFAULT_CATEGORY
    const inCategory = selectedCategory.value === ALL_CATEGORY || categoryName === selectedCategory.value
    if (!inCategory) return false
    if (!keyword) return true
    return [h.name, h.host, h.username, h.category].some((v) => String(v || '').toLowerCase().includes(keyword))
  })
})

const sftpPath = ref('.')
const sftpRows = ref<any[]>([])
const sftpStatus = ref('')
const sftpHostId = ref('')
const sftpConnected = ref(false)
const rightConnectPanelOpen = ref(false)
const rightConnectTarget = ref<string>('')
const sftpDragLocalPath = ref('')
const sftpDragRemoteFile = ref('')
const sftpUploadProgress = ref(0)
const sftpDownloadProgress = ref(0)
const selectedRemoteFile = ref('')
const sftpNewDirName = ref('')
const sftpRenameTo = ref('')
const remoteMenu = ref({ visible: false, x: 0, y: 0, filename: '' })
const textMenu = ref({ visible: false, x: 0, y: 0, mode: 'terminal' as 'terminal' | 'editor' })
const editorMenuTarget = ref<HTMLInputElement | HTMLTextAreaElement | null>(null)
const localPath = ref('')
const localRows = ref<any[]>([])
const selectedLocalFile = ref('')
const leftPanelMode = ref<'local' | 'remote'>('local')
const leftConnectPanelOpen = ref(false)
const leftConnectTarget = ref<string>('local')
const leftSftpHostId = ref('')
const leftSftpPath = ref('.')
const leftSftpRows = ref<any[]>([])
const rightPanelMode = ref<'remote' | 'local'>('remote')
const rightLocalPath = ref('')
const rightLocalRows = ref<any[]>([])
const localSortBy = ref<'name' | 'createdAt' | 'modifiedAt'>('name')
const remoteSortBy = ref<'name' | 'createdAt' | 'modifiedAt'>('name')

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

const syncStatusText = ref('本地版：不走云端账号，同步依赖共享文件夹数据库。')
const syncQueueCount = ref(0)

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
  const sourceLabel = u.source === 'qiniu'
    ? '七牛'
    : (u.source === 'gitee' ? 'Gitee' : 'GitHub')
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

const storageDbPath = ref('')
const storageFolderInput = ref('')
const storageMsg = ref('')
const startupGateVisible = ref(true)
const startupGateMode = ref<'loading' | 'init' | 'unlock'>('loading')
const startupGateBusy = ref(false)
const startupGateError = ref('')
const startupDbFolder = ref('')
const startupMasterConfirm = ref('')

const serialPorts = ref<any[]>([])
const serialForm = ref<{ path: string; baudRate: number; dataBits: number; stopBits: number; parity: 'none' | 'even' | 'odd' }>({
  path: '', baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none',
})
const serialSendText = ref('')
const serialHexMode = ref(false)
const serialTimerMs = ref(0)
let serialTimer: number | null = null

let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null

watch(focusTerminal, (value) => {
  nextTick(() => {
    initTerminal()
    fitAddon?.fit()
    if (value) terminal?.focus()
  })
})

watch(snippetItems, (items) => {
  if (!items.some((item) => item.id === terminalSnippetId.value)) {
    terminalSnippetId.value = items[0]?.id || ''
  }
}, { immediate: true })

const initTerminal = () => {
  if (!termEl.value || terminal) return
  terminal = new Terminal({
    convertEol: true,
    fontSize: 13,
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
  termEl.value.addEventListener('click', () => terminal?.focus())
  // 启动提示改到状态栏，不占终端可视面积

  terminal.onData((data) => sshConnected.value && window.lightterm.sshWrite({ sessionId: sshSessionId.value, data }))
  window.lightterm.onSshData((msg) => {
    sshBuffers.value[msg.sessionId] = (sshBuffers.value[msg.sessionId] || '') + msg.data
    if (msg.sessionId === sshSessionId.value) terminal?.write(msg.data)
  })
  window.lightterm.onSshClose((msg) => {
    const tab = sshTabs.value.find((t) => t.id === msg.sessionId)
    if (tab) tab.connected = false
    if (msg.sessionId === sshSessionId.value) {
      sshConnected.value = false
      terminal?.writeln('\r\n[SSH 已断开]')
    }
  })
  window.lightterm.onSshError((msg) => msg.sessionId === sshSessionId.value && terminal?.writeln(`\r\n[SSH 错误] ${msg.error}`))
  window.lightterm.onSerialData((msg) => terminal?.writeln(`\r\n[串口 ${msg.path}] ${msg.data}`))
}

const restoreSshTabs = () => {
  try {
    const raw = localStorage.getItem('lightterm.sshTabs')
    if (!raw) return
    const parsed = JSON.parse(raw) as Array<{ id: string; name: string }>
    if (!Array.isArray(parsed) || parsed.length === 0) return
    sshTabs.value = parsed.map((p) => ({ ...p, connected: false }))
    const first = sshTabs.value[0]
    if (first) sshSessionId.value = first.id
    const buffers: Record<string, string> = {}
    sshTabs.value.forEach((t) => (buffers[t.id] = ''))
    sshBuffers.value = buffers
  } catch {}
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

const applySnippetState = (items: SnippetItem[], extraCategories: string[]) => {
  snippetItems.value = [...items].sort((a, b) => b.updatedAt - a.updatedAt)
  snippetExtraCategories.value = [...new Set(extraCategories.filter(Boolean))]
}

const saveSnippetState = async (items = snippetItems.value, extraCategories = snippetExtraCategories.value) => {
  const res = await window.lightterm.snippetsSetState({ items, extraCategories })
  if (!res.ok) {
    snippetStatus.value = `代码片段保存失败：${res.error || '未知错误'}`
    return false
  }
  applySnippetState((res.items || []) as SnippetItem[], res.extraCategories || [])
  return true
}

const restoreSnippets = async () => {
  const res = await window.lightterm.snippetsGetState()
  if (!res.ok) {
    applySnippetState([buildDefaultDockerSnippet()], [])
    await saveSnippetState()
    return
  }

  const remoteItems = Array.isArray(res.items) ? (res.items as SnippetItem[]) : []
  const remoteCategories = Array.isArray(res.extraCategories) ? res.extraCategories : []
  if (remoteItems.length > 0 || remoteCategories.length > 0) {
    applySnippetState(remoteItems, remoteCategories)
    return
  }

  const legacy = readLegacySnippets()
  if (legacy && (legacy.items.length > 0 || legacy.extraCategories.length > 0)) {
    applySnippetState(legacy.items, legacy.extraCategories)
    await saveSnippetState()
    try { localStorage.removeItem(LEGACY_SNIPPET_STORAGE_KEY) } catch {}
    snippetStatus.value = '已迁移本机旧版代码片段到共享数据库'
    return
  }

  applySnippetState([buildDefaultDockerSnippet()], [])
  await saveSnippetState()
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
  await runSnippet(target)
  terminal?.focus()
}

const sendSnippetRawToTerminal = async () => {
  const target = getTerminalSnippet()
  if (!target) {
    snippetStatus.value = '没有可发送的代码片段'
    return
  }
  const ready = await ensureSnippetSession(target)
  if (!ready) return
  const payload = target.commands || ''
  if (!payload.trim()) {
    snippetStatus.value = '片段内容为空'
    return
  }
  const res = await window.lightterm.sshWrite({ sessionId: sshSessionId.value, data: payload })
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
  if (!sshConnected.value) {
    sshStatus.value = '请先连接 SSH 会话'
    return
  }
  const text = await readClipboardText()
  if (!text) {
    sshStatus.value = '剪贴板为空'
    return
  }
  const res = await window.lightterm.sshWrite({ sessionId: sshSessionId.value, data: text })
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
  let privateKey = ''
  if (authType.value === 'key') {
    if (!selectedKeyRef.value) {
      sshStatus.value = '请先选择密钥'
      return
    }
    const keyRes = await window.lightterm.vaultKeyGet({ id: selectedKeyRef.value })
    if (!keyRes.ok) {
      sshStatus.value = `读取密钥失败：${keyRes.error}`
      return
    }
    privateKey = keyRes.item?.privateKey || ''
  }

  const res = await window.lightterm.sshConnect({
    ...sshForm.value,
    password: authType.value === 'password' ? sshForm.value.password : undefined,
    privateKey: authType.value === 'key' ? privateKey : undefined,
    sessionId: sshSessionId.value,
  })
  sshConnected.value = !!res.ok
  const tab = sshTabs.value.find((t) => t.id === sshSessionId.value)
  if (tab) tab.connected = !!res.ok
  sshStatus.value = res.ok ? 'SSH 交互会话已连接' : `SSH 连接失败：${res.error}`
  if (res.ok) {
    terminal?.writeln('\r\n[SSH 已连接，可直接输入命令]')
    focusTerminal.value = true
    if (!keepNav) nav.value = 'hosts'
  }
}

const setHostProbeState = (hostId: string, state: HostProbeState, detail = '') => {
  hostProbeById.value = {
    ...hostProbeById.value,
    [hostId]: { state, detail },
  }
}

const hostProbeClass = (hostId: string) => hostProbeById.value[hostId]?.state || 'unknown'

const hostProbeTitle = (h: any) => {
  const probe = hostProbeById.value[h.id]
  const statusText = probe?.state === 'online'
    ? 'SSH 可连接'
    : probe?.state === 'offline'
      ? 'SSH 不可连接'
      : probe?.state === 'checking'
        ? 'SSH 检测中...'
        : '等待检测'
  return probe?.detail ? `${statusText}：${probe.detail}` : statusText
}

const syncHostProbeMap = () => {
  const next: Record<string, { state: HostProbeState; detail?: string }> = {}
  hostItems.value.forEach((h) => {
    next[h.id] = hostProbeById.value[h.id] || { state: 'unknown' }
  })
  hostProbeById.value = next
}

const buildHostProbeConfig = async (h: any): Promise<{ ok: boolean; cfg?: LocalSSHConfig; error?: string }> => {
  if ((h.auth_type || 'password') !== 'key') {
    return {
      ok: true,
      cfg: {
        host: h.host,
        port: Number(h.port || 22),
        username: h.username,
        password: h.password || undefined,
      },
    }
  }

  if (!h.private_key_ref) {
    return { ok: false, error: '未配置密钥引用' }
  }
  const keyRes = await window.lightterm.vaultKeyGet({ id: h.private_key_ref })
  if (!keyRes.ok) {
    return { ok: false, error: keyRes.error || '读取密钥失败' }
  }
  const privateKey = keyRes.item?.privateKey || ''
  if (!privateKey) {
    return { ok: false, error: '密钥内容为空' }
  }
  return {
    ok: true,
    cfg: {
      host: h.host,
      port: Number(h.port || 22),
      username: h.username,
      privateKey,
    },
  }
}

const testHostReachability = async (h: any, batchId = hostProbeBatchId) => {
  if (!h?.id || batchId !== hostProbeBatchId) return
  setHostProbeState(h.id, 'checking')
  const built = await buildHostProbeConfig(h)
  if (!built.ok || !built.cfg) {
    setHostProbeState(h.id, 'offline', built.error || '配置不完整')
    return
  }
  const res = await window.lightterm.sshTest(built.cfg)
  if (batchId !== hostProbeBatchId) return
  if (res.ok) {
    setHostProbeState(h.id, 'online')
  } else {
    setHostProbeState(h.id, 'offline', res.error || '连接失败')
  }
}

const probeAllHosts = async () => {
  syncHostProbeMap()
  const batchId = ++hostProbeBatchId
  const queue = [...hostItems.value]
  const workerCount = Math.min(4, queue.length)
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (queue.length > 0) {
      const host = queue.shift()
      if (!host) break
      await testHostReachability(host, batchId)
    }
  }))
}

const refreshHosts = async () => {
  const res = await window.lightterm.hostsList()
  if (res.ok) {
    hostItems.value = res.items || []
    if (!hostCategories.value.includes(selectedCategory.value) && selectedCategory.value !== ALL_CATEGORY) {
      selectedCategory.value = ALL_CATEGORY
    }
    void probeAllHosts()
  }
}
const saveCurrentHost = async () => {
  const res = await window.lightterm.hostsSave({
    name: hostName.value || sshForm.value.host,
    category: hostCategory.value || DEFAULT_CATEGORY,
    ...sshForm.value,
    authType: authType.value,
    privateKeyRef: selectedKeyRef.value || null,
  })
  if (res.ok) {
    await refreshHosts()
    notify(true, '主机已保存')
  } else {
    notify(false, `主机保存失败：${res.error || '未知错误'}`)
  }
}
const useHost = (h: any) => {
  selectedHostId.value = h.id
  sshForm.value.host = h.host
  sshForm.value.port = h.port
  sshForm.value.username = h.username
  sshForm.value.password = h.password || ''
  hostName.value = h.name
  hostCategory.value = h.category || DEFAULT_CATEGORY
  authType.value = h.auth_type === 'key' ? 'key' : 'password'
  selectedKeyRef.value = h.private_key_ref || ''
}
const openHostEditor = (h: any) => {
  useHost(h)
  editingHost.value = {
    id: h.id,
    name: h.name,
    host: h.host,
    port: h.port,
    username: h.username,
    password: h.password || '',
    category: h.category || DEFAULT_CATEGORY,
    authType: h.auth_type || 'password',
    privateKeyRef: h.private_key_ref || '',
    purchaseDate: h.purchaseDate || '',
    expiryDate: h.expiryDate || '',
  }
  hostEditorVisible.value = true
}

const openHostTerminal = async (h: any) => {
  useHost(h)
  await connectSSH()
}
const saveEditedHost = async () => {
  if (!editingHost.value) return
  const h = editingHost.value
  const res = await window.lightterm.hostsSave({
    id: h.id || undefined,
    name: h.name,
    host: h.host,
    port: Number(h.port || 22),
    username: h.username,
    password: h.password || '',
    category: h.category || DEFAULT_CATEGORY,
    authType: h.authType || 'password',
    privateKeyRef: h.privateKeyRef || null,
    purchaseDate: h.purchaseDate || '',
    expiryDate: h.expiryDate || '',
  })
  if (res.ok) {
    await refreshHosts()
    notify(true, '主机参数已更新')
  } else {
    notify(false, `更新失败：${res.error || '未知错误'}`)
  }
}
const deleteCurrentHost = async () => {
  if (!selectedHostId.value) return
  await window.lightterm.hostsDelete({ id: selectedHostId.value })
  selectedHostId.value = ''
  editingHost.value = null
  hostEditorVisible.value = false
  await refreshHosts()
  sshStatus.value = '主机已删除'
}

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

const loadSftp = async () => {
  if (rightPanelMode.value === 'local') {
    await loadRightLocalFs()
    return
  }
  const { config, error } = await getSftpConfig()
  if (!config) {
    sftpStatus.value = error || '请先选择并连接 SSH 服务器'
    return
  }
  sftpStatus.value = '读取中...'
  const res = await window.lightterm.sftpList({ ...config, remotePath: sftpPath.value })
  if (!res.ok) return (sftpStatus.value = `读取失败：${res.error}`)
  sftpRows.value = res.items || []
  sftpStatus.value = `已读取 ${sftpRows.value.length} 项`
}
const uploadSftp = async () => {
  const { config, error } = await getSftpConfig()
  if (!config) {
    sftpStatus.value = error || '请先选择并连接 SSH 服务器'
    return
  }
  sftpUploadProgress.value = 0
  const res = await window.lightterm.sftpUpload({ ...config, remoteDir: sftpPath.value, localFile: selectedLocalFile.value || undefined })
  sftpStatus.value = res.ok ? `上传成功：${res.remoteFile}` : `上传失败：${res.error}`
  if (res.ok) await loadSftp()
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
  const res = await window.lightterm.sftpDownloadToLocal({ ...config, remoteFile, localDir: localPath.value || '', filename: sftpDragRemoteFile.value })
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
const downloadSftp = async () => {
  const { config, error } = await getSftpConfig()
  if (!config) {
    sftpStatus.value = error || '请先选择并连接 SSH 服务器'
    return
  }
  if (!selectedRemoteFile.value) {
    sftpStatus.value = '请先在列表中选择远程文件'
    return
  }
  sftpDownloadProgress.value = 0
  const remoteFile = `${sftpPath.value.replace(/\/$/, '')}/${selectedRemoteFile.value}`
  const res = await window.lightterm.sftpDownload({ ...config, remoteFile })
  sftpStatus.value = res.ok ? `下载成功：${res.filePath}` : `下载失败：${res.error}`
}
const mkdirSftp = async () => {
  const { config, error } = await getSftpConfig()
  if (!config) {
    sftpStatus.value = error || '请先选择并连接 SSH 服务器'
    return
  }
  if (!sftpNewDirName.value) return
  const remoteDir = `${sftpPath.value.replace(/\/$/, '')}/${sftpNewDirName.value}`
  const res = await window.lightterm.sftpMkdir({ ...config, remoteDir })
  sftpStatus.value = res.ok ? `目录已创建：${remoteDir}` : `创建失败：${res.error}`
  if (res.ok) {
    sftpNewDirName.value = ''
    await loadSftp()
  }
}
const renameSftp = async () => {
  const { config, error } = await getSftpConfig()
  if (!config) {
    sftpStatus.value = error || '请先选择并连接 SSH 服务器'
    return
  }
  if (!selectedRemoteFile.value || !sftpRenameTo.value) return
  const oldPath = `${sftpPath.value.replace(/\/$/, '')}/${selectedRemoteFile.value}`
  const newPath = `${sftpPath.value.replace(/\/$/, '')}/${sftpRenameTo.value}`
  const res = await window.lightterm.sftpRename({ ...config, oldPath, newPath })
  sftpStatus.value = res.ok ? `已重命名为：${sftpRenameTo.value}` : `重命名失败：${res.error}`
  if (res.ok) {
    selectedRemoteFile.value = sftpRenameTo.value
    sftpRenameTo.value = ''
    await loadSftp()
  }
}
const deleteSftp = async () => {
  const { config, error } = await getSftpConfig()
  if (!config) {
    sftpStatus.value = error || '请先选择并连接 SSH 服务器'
    return
  }
  if (!selectedRemoteFile.value) return
  const remoteFile = `${sftpPath.value.replace(/\/$/, '')}/${selectedRemoteFile.value}`
  const res = await window.lightterm.sftpDelete({ ...config, remoteFile })
  sftpStatus.value = res.ok ? `已删除：${selectedRemoteFile.value}` : `删除失败：${res.error}`
  if (res.ok) {
    selectedRemoteFile.value = ''
    await loadSftp()
  }
}

const plainVaultMessage = (msg: string) => String(msg || '').replace(/^[✅❌]\s*/, '').trim()
const dbFolderFromPath = (dbPath: string) => String(dbPath || '').replace(/[\\/]lightterm\.db$/i, '')

const ensureStartupDbFolder = () => {
  if (startupDbFolder.value) return
  const currentFolder = dbFolderFromPath(storageDbPath.value)
  if (currentFolder) startupDbFolder.value = currentFolder
}

const evaluateVaultGate = () => {
  if (!vaultInitialized.value) {
    startupGateMode.value = 'init'
    startupGateVisible.value = true
    ensureStartupDbFolder()
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

const pickStartupDbFolder = async () => {
  const res = await window.lightterm.appPickStorageFolder()
  if (res.ok && res.folder) {
    startupDbFolder.value = res.folder
    startupGateError.value = ''
  }
}

const useCurrentDbFolder = () => {
  startupDbFolder.value = dbFolderFromPath(storageDbPath.value)
  startupGateError.value = ''
}

const runStartupInit = async () => {
  if (startupGateBusy.value) return
  if (!startupDbFolder.value.trim()) {
    startupGateError.value = '请先选择数据库目录'
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
    const targetFolder = startupDbFolder.value.trim()
    const currentFolder = dbFolderFromPath(storageDbPath.value)
    if (targetFolder && targetFolder !== currentFolder) {
      const setRes = await window.lightterm.appSetStorageFolder({ folder: targetFolder })
      if (!setRes.ok) {
        startupGateError.value = `数据库目录设置失败：${setRes.error || '未知错误'}`
        return
      }
      startupGateError.value = '数据库目录已设置，应用正在重启...'
      await window.lightterm.appRestart()
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

const checkVault = async () => {
  if (!window.lightterm?.vaultStatus) {
    bridgeReady.value = false
    vaultStatus.value = '❌ 桌面桥接未加载（请完全退出 AstraShell 后重新打开桌面版 App）'
    return
  }
  bridgeReady.value = true
  const res = await window.lightterm.vaultStatus()
  vaultInitialized.value = res.initialized
  vaultUnlocked.value = res.unlocked
  evaluateVaultGate()
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
    if (selectedVaultKeyId.value && !vaultItems.value.some((k) => k.id === selectedVaultKeyId.value)) {
      clearVaultEditor()
    }
  }
}

const refreshSyncStatus = async () => {
  const res = await window.lightterm.syncStatus()
  if (!res.ok) return
  syncQueueCount.value = res.queueCount || 0
}
const clearSyncQueue = async () => {
  await window.lightterm.syncClearQueue()
  await refreshSyncStatus()
  syncStatusText.value = '本地队列标记已清空'
}
const pushSyncNow = async () => {
  const res = await window.lightterm.syncPushNow()
  await refreshSyncStatus()
  syncStatusText.value = res.ok ? `本地队列处理完成：${res.pushed || 0} 条` : '处理失败'
}
const copyDbPath = async () => {
  if (!storageDbPath.value) return
  try {
    await navigator.clipboard.writeText(storageDbPath.value)
    syncStatusText.value = '数据库路径已复制'
  } catch {
    syncStatusText.value = '复制失败：请检查系统剪贴板权限'
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
  const res = await window.lightterm.appGetStorage()
  if (res.ok) {
    storageDbPath.value = res.dbPath || ''
    ensureStartupDbFolder()
  }
}

const refreshLocalSyncOverview = async () => {
  await Promise.all([refreshStorageInfo(), refreshSyncStatus()])
}

const pickStorageFolder = async () => {
  const res = await window.lightterm.appPickStorageFolder()
  if (res.ok && res.folder) storageFolderInput.value = res.folder
}
const applyStorageFolder = async () => {
  if (!storageFolderInput.value) return
  const res = await window.lightterm.appSetStorageFolder({ folder: storageFolderInput.value })
  storageMsg.value = res.ok
    ? `已设置数据库路径：${res.dbPath}（重启应用生效）`
    : `设置失败：${res.error}`
  await refreshLocalSyncOverview()
}

const loadSerialPorts = async () => {
  serialPorts.value = await window.lightterm.listSerialPorts()
  if (!serialForm.value.path && serialPorts.value.length > 0) serialForm.value.path = serialPorts.value[0].path
}
const openSerial = async () => {
  if (!serialForm.value.path) return
  const res = await window.lightterm.openSerial(serialForm.value)
  terminal?.writeln(res.ok ? `\r\n串口已打开：${serialForm.value.path}` : `\r\n串口打开失败：${res.error}`)
}
const sendSerial = async () => {
  if (!serialForm.value.path || !serialSendText.value) return
  const res = await window.lightterm.sendSerial({ path: serialForm.value.path, data: serialSendText.value, isHex: serialHexMode.value })
  terminal?.writeln(res.ok ? `\r\n已发送：${serialSendText.value}` : `\r\n发送失败：${res.error}`)
}
const toggleTimerSend = () => {
  if (serialTimer) {
    clearInterval(serialTimer)
    serialTimer = null
    return
  }
  if (!serialTimerMs.value || serialTimerMs.value < 50) return
  serialTimer = window.setInterval(() => sendSerial(), serialTimerMs.value)
}

onMounted(async () => {
  startupGateVisible.value = true
  startupGateMode.value = 'loading'
  startupGateError.value = ''
  restoreSshTabs()
  await restoreSnippets()
  initTerminal()
  await loadSerialPorts()
  await refreshHosts()
  await checkVault()
  await refreshVaultKeys()
  await refreshLocalSyncOverview()
  await refreshUpdateState()
  await loadLocalFs()
  window.addEventListener('resize', () => {
    fitAddon?.fit()
    if (sshConnected.value && terminal) window.lightterm.sshResize({ sessionId: sshSessionId.value, cols: terminal.cols, rows: terminal.rows })
  })
  window.lightterm.onSftpProgress((p) => {
    if (p.type === 'upload') sftpUploadProgress.value = p.percent
    if (p.type === 'download') sftpDownloadProgress.value = p.percent
  })
  window.lightterm.onUpdateStatus((payload) => mergeUpdateState(payload))
  window.addEventListener('click', hideAllMenus)
  window.addEventListener('keydown', handleTerminalHotkeys, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleTerminalHotkeys, true)
  window.removeEventListener('click', hideAllMenus)
})
</script>

<template>
  <div class="layout" :class="{ 'terminal-layout': focusTerminal }">
    <aside class="sidebar">
      <div class="brand"><img src="/logo-astrashell.png?v=2" alt="AstraShell" class="brand-logo" /> AstraShell</div>
      <ul class="sidebar-nav">
        <li :class="{ active: nav === 'hosts' }" @click="focusTerminal = false; nav = 'hosts'"><Server :size="16" /> 主机管理</li>
        <li :class="{ active: nav === 'sftp' }" @click="focusTerminal = false; nav = 'sftp'"><FolderTree :size="16" /> 文件传输</li>
        <li :class="{ active: nav === 'snippets' }" @click="focusTerminal = false; nav = 'snippets'"><Pencil :size="16" /> 代码片段</li>
        <li :class="{ active: nav === 'serial' }" @click="focusTerminal = false; nav = 'serial'"><Cable :size="16" /> 串口工具</li>
        <li :class="{ active: nav === 'vault' }" @click="focusTerminal = false; nav = 'vault'"><KeyRound :size="16" /> 密钥管理</li>
        <li :class="{ active: nav === 'settings' }" @click="focusTerminal = false; nav = 'settings'"><Settings :size="16" /> 应用设置</li>
      </ul>
      <div class="sidebar-footer">
        <img src="/logo-astrashell.png?v=2" alt="AstraShell Logo" class="sidebar-footer-logo" />
        <div class="sidebar-footer-text">
          <div class="sidebar-footer-title">AstraShell</div>
          <div class="sidebar-footer-sub">制作人：GetIDC</div>
        </div>
      </div>
    </aside>

    <main class="main">
      <div class="top-actions terminal-top-actions" v-if="focusTerminal">
        <div class="terminal-tools-left">
          <button class="ghost" @click="focusTerminal = false">返回模块视图</button>
          <button class="ghost" @click="selectAllTerminal">全选</button>
          <button class="ghost" @click="copyTerminalSelection">复制选中</button>
          <button class="ghost" @click="pasteToTerminal">粘贴</button>
        </div>
        <div class="terminal-tools-right">
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

      <section v-if="!focusTerminal && nav === 'hosts'" class="panel hosts-panel">
        <div class="hosts-header">
          <div>
            <h3>主机管理</h3>
            <p class="hosts-header-sub">快速筛选主机并在右侧编辑详情</p>
          </div>
          <div class="hosts-quick-connect">
            <input v-model="hostName" placeholder="连接名称" />
            <input v-model="sshForm.host" placeholder="主机/IP" />
            <input v-model.number="sshForm.port" type="number" placeholder="端口" />
            <input v-model="sshForm.username" placeholder="用户名" />
            <input v-model="sshForm.password" type="password" placeholder="密码（可选）" />
            <button class="ghost small" @click="saveCurrentHost">保存</button>
            <button class="muted small" @click="connectSSH">连接</button>
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
                    <input v-if="editingHost.authType === 'password'" v-model="editingHost.password" type="password" placeholder="密码" />
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
                      <button class="muted" @click="useHost(editingHost); connectSSH()">连接终端</button>
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
        <p>{{ sftpStatus }} ｜ {{ sftpConnected ? '已连接' : '未连接' }} ｜ 传输模式：二进制</p>
        <div class="split-head">
          <div class="head-left">
            <span class="path-chip">
              <b>左侧连接</b>
              <span>{{ leftLinkLabel }}</span>
              <small>{{ leftPanelMode === 'local' ? leftLocalPathDisplay : leftSftpPath }}</small>
            </span>
            <span class="path-chip">
              <b>右侧连接</b>
              <span>{{ rightLinkLabel }}</span>
              <small>{{ rightPanelMode === 'local' ? rightLocalPathDisplay : sftpPath }}</small>
            </span>
          </div>
        </div>

        <div class="split">
          <div @dragover.prevent @drop="onLeftDrop" class="file-panel local-panel">
            <div class="file-panel-head">
              <h4>{{ leftPanelMode === 'local' ? '左侧：本地（可接收远程拖拽下载）' : '左侧：远程浏览' }}</h4>
              <div class="file-head-actions">
                <button class="ghost small" @click="localGoUp">上一级</button>
                <button class="ghost small" @click="leftPanelMode === 'local' ? loadLocalFs() : loadLeftSftp()">刷新</button>
                <button class="ghost small" @click="leftConnectPanelOpen = !leftConnectPanelOpen">链接</button>
                <select v-model="localSortBy" class="file-sort">
                  <option value="name">A-Z 排序</option>
                  <option value="createdAt">创建时间</option>
                  <option value="modifiedAt">修改时间</option>
                </select>
              </div>
            </div>
            <div v-if="leftConnectPanelOpen" class="connect-inline">
              <select v-model="leftConnectTarget">
                <option value="local">本地目录</option>
                <option v-for="h in hostItems" :key="h.id" :value="h.id">{{ h.name }} ({{ h.host }})</option>
              </select>
              <button @click="connectLeftPanel">切换左侧</button>
            </div>
            <div class="file-stack">
              <div
                v-for="l in (leftPanelMode === 'local' ? sortedLocalRows : sortedLeftSftpRows)"
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
              <div v-if="(leftPanelMode === 'local' ? sortedLocalRows.length : sortedLeftSftpRows.length) === 0" class="file-row empty">目录空</div>
            </div>
          </div>
          <div @dragover.prevent @drop="onRightDrop" class="file-panel remote-panel">
            <div class="file-panel-head">
              <h4>{{ rightPanelMode === 'remote' ? '右侧：远程（可接收本地拖拽上传）' : '右侧：本地目录' }}</h4>
              <div class="file-head-actions">
                <button class="ghost small" @click="remoteGoUp">上一级</button>
                <button class="ghost small" @click="loadSftp">刷新</button>
                <button v-if="rightPanelMode === 'remote'" class="ghost small" @click="promptMkdirSftp">新建目录</button>
                <button class="ghost small" @click="rightConnectTarget = rightPanelMode === 'local' ? 'local' : sftpHostId; rightConnectPanelOpen = !rightConnectPanelOpen">链接</button>
                <select v-model="remoteSortBy" class="file-sort">
                  <option value="name">A-Z 排序</option>
                  <option value="createdAt">创建时间</option>
                  <option value="modifiedAt">修改时间</option>
                </select>
              </div>
            </div>
            <div v-if="rightConnectPanelOpen" class="connect-inline">
              <select v-model="rightConnectTarget">
                <option value="local">本地目录</option>
                <option v-for="h in hostItems" :key="h.id" :value="h.id">{{ h.name }} ({{ h.host }})</option>
              </select>
              <button @click="connectSftp">切换右侧</button>
            </div>
            <div class="file-stack">
              <div
                v-for="r in (rightPanelMode === 'remote' ? sortedSftpRows : sortedRightLocalRows)"
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
              <div v-if="(rightPanelMode === 'remote' ? sortedSftpRows.length : sortedRightLocalRows.length) === 0" class="file-row empty">目录空</div>
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

      <section v-else-if="!focusTerminal && nav === 'serial'" class="panel">
        <h3>串口工具</h3>
        <div class="grid">
          <select v-model="serialForm.path"><option value="">选择串口</option><option v-for="p in serialPorts" :key="p.path" :value="p.path">{{ p.path }}</option></select>
          <input v-model.number="serialForm.baudRate" type="number" placeholder="波特率" />
          <button @click="loadSerialPorts">刷新串口</button>
          <button @click="openSerial">打开串口</button>
        </div>
        <div class="send-box">
          <input v-model="serialSendText" :placeholder="serialHexMode ? 'HEX 示例：41 54 0D 0A' : '发送内容（ASCII）'" />
          <label><input v-model="serialHexMode" type="checkbox" /> HEX</label>
          <input v-model.number="serialTimerMs" type="number" placeholder="定时发送ms（>=50）" />
          <button @click="sendSerial">发送</button>
          <button class="muted" @click="toggleTimerSend">切换定时</button>
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
        <p class="hint">统一管理应用更新、本地数据库目录和共享文件夹同步状态。</p>
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
        <p class="hint">发布新版本到 GitHub Release 后，应用启动会自动检查；也可手动检查并一键更新。</p>
        <div class="divider"></div>
        <h3>本地存储</h3>
        <p>当前数据库：{{ storageDbPath }}</p>
        <div class="grid">
          <input v-model="storageFolderInput" placeholder="选择 iCloud/共享文件夹目录" />
          <button class="muted" @click="pickStorageFolder">选择目录</button>
          <button @click="applyStorageFolder">应用目录</button>
          <button class="muted" @click="refreshLocalSyncOverview">刷新</button>
        </div>
        <p>{{ storageMsg }}</p>
        <p class="hint">建议：跨设备同步时，只让一台设备在同一时刻写入数据库，避免冲突。</p>
        <div class="divider"></div>
        <h3>共享同步</h3>
        <p>{{ syncStatusText }}</p>
        <p>当前数据库：{{ storageDbPath }}</p>
        <div class="grid">
          <button class="muted" @click="refreshLocalSyncOverview">刷新数据库路径</button>
          <button class="muted" @click="copyDbPath">复制数据库路径</button>
          <button @click="pushSyncNow">处理本地队列</button>
          <button class="muted" @click="clearSyncQueue">清空本地队列</button>
        </div>
        <p>待处理变更：{{ syncQueueCount }}</p>
        <p class="hint">建议：把数据库目录放到 iCloud/OneDrive/共享盘；同一时刻只在一台设备写入。</p>
      </section>

      <section v-else-if="!focusTerminal" class="panel"><h3>模块建设中</h3><p>当前页面：{{ nav }}</p></section>

      <section v-show="focusTerminal" class="terminal-wrap" :class="{ focus: focusTerminal }">
        <div ref="termEl" class="terminal" @contextmenu.prevent="openTerminalContextMenu"></div>
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
      <div class="status-left">状态：{{ snippetStatus || sftpStatus || sshStatus || '就绪' }}</div>
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
        <template v-else-if="startupGateMode === 'init'">
          <h3>首次启动：初始化数据库与密钥仓库</h3>
          <p>请先确定数据库目录，然后设置主密码完成初始化。</p>
          <div class="grid startup-db-grid">
            <input v-model="startupDbFolder" placeholder="数据库目录（将创建 lightterm.db）" />
            <button class="muted" :disabled="startupGateBusy" @click="pickStartupDbFolder">选择目录</button>
            <button class="ghost" :disabled="startupGateBusy" @click="useCurrentDbFolder">使用当前目录</button>
          </div>
          <p class="hint">当前数据库：{{ storageDbPath || '读取中...' }}</p>
          <div class="grid startup-auth-grid">
            <input v-model="vaultMaster" type="password" placeholder="设置主密码" />
            <input v-model="startupMasterConfirm" type="password" placeholder="确认主密码" />
          </div>
          <button :disabled="startupGateBusy" @click="runStartupInit">创建并初始化</button>
        </template>
        <template v-else>
          <h3>解锁密钥仓库</h3>
          <p>进入软件前请先输入主密码。</p>
          <p class="hint">当前数据库：{{ storageDbPath || '读取中...' }}</p>
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
.brand { font-weight: 800; margin-bottom: 6px; font-size: 20px; display: flex; align-items: center; gap: 10px; }
.brand-logo { width: 52px; height: 52px; border-radius: 0; object-fit: contain; }
.sidebar ul { list-style: none; padding: 0; margin: 0; }
.sidebar-nav { flex: 1; min-height: 0; overflow: auto; }
.sidebar li { padding: 10px 10px; border-radius: 10px; color: var(--text-main); cursor: pointer; margin-bottom: 6px; display: flex; align-items: center; gap: 8px; }
.sidebar li:hover { background: #dfe5ee; }
.sidebar li.active { background: #dbeafe; color: #1d4ed8; font-weight: 600; }
.sidebar-footer { border: 1px solid #d4dde8; border-radius: 12px; background: #f7fafd; padding: 10px; display: flex; align-items: center; gap: 10px; }
.sidebar-footer-logo { width: 34px; height: 34px; border-radius: 0; object-fit: contain; flex-shrink: 0; }
.sidebar-footer-title { font-size: 13px; font-weight: 700; color: #0f172a; }
.sidebar-footer-sub { font-size: 11px; color: #64748b; }
.main { padding: 12px; padding-bottom: 42px; display: flex; flex-direction: column; gap: 10px; height: 100vh; overflow: hidden; }
.top-actions { flex-shrink: 0; }
.terminal-top-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; background: #f5f8fc; border: 1px solid #dbe3ee; border-radius: 12px; padding: 8px 10px; }
.terminal-tools-left,
.terminal-tools-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.terminal-tools-right { margin-left: auto; }
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
.terminal-wrap { flex: 1; min-height: 220px; overflow: hidden; }
.terminal-wrap.focus { flex: 1; min-height: 0; }
.terminal { height: 100%; }
.terminal-wrap.focus .terminal { height: 100%; }
:deep(.xterm .xterm-selection div) { background-color: rgba(96, 165, 250, 0.55) !important; }
:deep(.xterm .xterm-rows) { cursor: text; }
textarea::selection,
input::selection { background: #bfdbfe; color: #0f172a; }
.split-head { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin:8px 0 10px; }
.head-left { display:flex; gap:8px; flex:1; }
.head-right { position:relative; }
.path-chip { display:flex; flex-direction:column; gap:2px; padding:6px 10px; border:1px solid #d0d8e2; border-radius:10px; background:#eef3f8; color:#334155; font-size:12px; max-width:48%; min-width:0; }
.path-chip b { font-size:11px; color:#475569; font-weight:700; }
.path-chip span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-weight:600; }
.path-chip small { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#64748b; font-size:11px; }
.connect-panel { position:absolute; right:0; top:38px; background:#fff; border:1px solid var(--border); border-radius:10px; padding:10px; display:grid; gap:8px; min-width:280px; z-index:20; }
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; min-height: 0; flex: 1; overflow: hidden; }
.split > div { border: 1px solid #dbe2ea; background: #f8fafc; border-radius: 10px; padding: 8px; display: flex; flex-direction: column; min-height: 0; }
.split > div:nth-child(2) { background: #f1f5f9; border-color: #cbd5e1; }
.file-panel { background: rgba(255, 255, 255, 0.85); border: 1px solid rgba(15,23,42,0.08); border-radius: 16px; padding: 14px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.6); min-height: 0; }
.file-panel-head { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.file-head-actions { display:flex; align-items:center; gap:6px; flex-wrap:wrap; justify-content:flex-end; }
.connect-inline { margin-top: 8px; padding: 8px; border: 1px solid #d3dce6; border-radius: 10px; background: #f8fbff; display: grid; grid-template-columns: 1fr auto; gap: 8px; }
.file-sort { min-width: 120px; padding: 6px 8px; font-size: 12px; }
.file-stack { display:flex; flex-direction:column; gap: 8px; flex: 1; min-height: 0; overflow:auto; margin-top: 8px; }
.file-row { display:flex; align-items:center; justify-content:space-between; gap: 12px; padding: 8px 10px; border-radius: 10px; border: 1px solid transparent; background: rgba(248, 250, 252, 0.8); transition: background 0.2s ease, border 0.2s ease; }
.file-row.is-dir { background: rgba(59, 130, 246, 0.1); }
.file-row.active { border-color: var(--primary); background: rgba(37, 99, 235, 0.15); }
.file-row:not(.empty):hover { background: rgba(59, 130, 246, 0.1); }
.file-row.empty { justify-content:center; color: #94a3b8; background: transparent; border: 1px dashed rgba(15,23,42,0.2); }
.file-info { display:flex; align-items:center; gap: 8px; font-weight: 600; font-size: 12px; }
.file-icon { font-size: 14px; }
.file-name { color: #0f172a; font-size: 12px; }
.file-meta { display:flex; align-items:center; gap: 14px; font-size: 11px; color: #475569; }
.file-meta span { opacity: 0.8; display:inline-flex; gap: 6px; }
.list { margin: 6px 0 0; padding-left: 18px; flex: 1; min-height: 0; overflow: auto; }
.list li { display: flex; justify-content: space-between; padding-right: 8px; cursor: pointer; }
h4 { margin: 4px 0; font-size: 12px; font-weight: 600; }
.hosts-header { display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; }
.hosts-header h3 { margin: 0; font-size: 19px; color: #111827; }
.hosts-header-sub { color: #475569; font-size: 12px; margin: 0; }
.hosts-quick-connect { display: grid; grid-template-columns: 1.1fr 1fr 88px 120px 1fr auto auto; gap: 8px; padding: 8px; border: 1px solid #cbd5e1; border-radius: 12px; background: #eef3f7; }
.hosts-quick-connect input { width: 100%; min-width: 0; background: #fff; }
.hosts-quick-connect button { white-space: nowrap; margin-left: 0; }
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
}
@media (max-width: 1080px) {
  .hosts-quick-connect { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .hosts-quick-connect button { grid-column: span 2; }
}
@media (max-width: 860px) {
  .hosts-layout.new-layout { grid-template-columns: 1fr; }
  .hosts-left { display: none; }
  .snippets-layout { grid-template-columns: 1fr; }
  .snippets-left { display: none; }
  .hosts-quick-connect { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .hosts-quick-connect button { grid-column: span 1; }
  .terminal-top-actions { flex-direction: column; align-items: stretch; }
  .terminal-tools-right { margin-left: 0; }
  .terminal-tools-right select { min-width: 0; width: 100%; max-width: none; }
  .snippets-header { flex-direction: column; align-items: flex-start; }
  .snippets-run-settings input { width: 100%; }
  .vault-toolbar { grid-template-columns: 1fr 1fr; }
  .startup-db-grid,
  .startup-auth-grid { grid-template-columns: 1fr; }
}

.hint { color: #6b7280; font-size: 12px; }
</style>
