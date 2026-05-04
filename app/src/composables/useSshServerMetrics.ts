import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'

type TerminalMode = 'ssh' | 'serial' | 'local'
type NavKey = 'hosts' | 'sftp' | 'snippets' | 'serial' | 'local' | 'database' | 'vault' | 'settings' | 'logs'

type MetricsState = {
  supported: boolean
  host: string
  user: string
  cwd: string
  kernel: string
  os: string
  shell: string
  uptime: string
  loadAverage: string
  cpuPercent: number | null
  memoryPercent: number | null
  diskPercent: number | null
  memoryUsedKb: number
  memoryTotalKb: number
  diskUsedKb: number
  diskTotalKb: number
  rxBytesPerSec: number
  txBytesPerSec: number
}

type DirectorySnapshot = {
  cwd: string
  dirs: number
  files: number
  total: number
  size: string
  items: Array<{ kind: string; name: string }>
}

type NetworkRouteSnapshot = {
  localIp: string
  gateway: string
  dnsServers: string[]
  hostname: string
  platform: string
  targetHost: string
}

const EMPTY_METRICS: MetricsState = {
  supported: false,
  host: '',
  user: '',
  cwd: '',
  kernel: '',
  os: '',
  shell: '',
  uptime: '',
  loadAverage: '',
  cpuPercent: null,
  memoryPercent: null,
  diskPercent: null,
  memoryUsedKb: 0,
  memoryTotalKb: 0,
  diskUsedKb: 0,
  diskTotalKb: 0,
  rxBytesPerSec: 0,
  txBytesPerSec: 0,
}

const EMPTY_DIRECTORY: DirectorySnapshot = {
  cwd: '',
  dirs: 0,
  files: 0,
  total: 0,
  size: '--',
  items: [],
}

const EMPTY_ROUTE: NetworkRouteSnapshot = {
  localIp: '',
  gateway: '',
  dnsServers: [],
  hostname: '',
  platform: '',
  targetHost: '',
}

function formatPercent(value: number | null) {
  return value == null || !Number.isFinite(value) ? '--' : `${Math.round(value)}%`
}

function formatRate(bytesPerSec = 0) {
  const value = Math.max(0, Number(bytesPerSec || 0))
  if (value < 1024) return `${Math.round(value)} B/s`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value >= 100 * 1024 ? 0 : 1)} KB/s`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(value >= 100 * 1024 * 1024 ? 0 : 1)} MB/s`
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB/s`
}

function compactText(value: string, max = 26) {
  const raw = String(value || '').trim()
  if (!raw) return '--'
  if (raw.length <= max) return raw
  return `${raw.slice(0, Math.max(0, max - 1))}…`
}

function normalizeAbsolutePath(pathValue: string) {
  const input = String(pathValue || '').trim()
  if (!input) return '/'
  const parts = input.split('/').filter(Boolean)
  const next: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      next.pop()
      continue
    }
    next.push(part)
  }
  return `/${next.join('/')}`.replace(/\/{2,}/g, '/')
}

function resolveTrackedPath(currentPath: string, homePath: string, targetPath: string) {
  const raw = String(targetPath || '').trim()
  if (!raw || raw === '~') return normalizeAbsolutePath(homePath || currentPath || '/')
  if (raw === '-') return ''
  if (raw.startsWith('/')) return normalizeAbsolutePath(raw)
  if (raw.startsWith('~/')) return normalizeAbsolutePath(`${homePath || '/'}${raw.slice(1)}`)
  const base = normalizeAbsolutePath(currentPath || homePath || '/')
  return normalizeAbsolutePath(`${base.replace(/\/$/, '')}/${raw}`)
}

function stripQuotes(value: string) {
  const raw = String(value || '').trim()
  if (
    (raw.startsWith('"') && raw.endsWith('"'))
    || (raw.startsWith('\'') && raw.endsWith('\''))
  ) {
    return raw.slice(1, -1)
  }
  return raw
}

export function useSshServerMetrics(params: {
  nav: Ref<NavKey>
  focusTerminal: Ref<boolean>
  activeTerminalMode: Ref<TerminalMode>
  sshConnected: Ref<boolean>
  sshSessionId: Ref<string>
  sshTabs: Ref<Array<{ id: string; name: string; host?: string; port?: number; username?: string }>>
}) {
  const {
    nav,
    focusTerminal,
    activeTerminalMode,
    sshConnected,
    sshSessionId,
    sshTabs,
  } = params

  const metrics = ref<MetricsState>({ ...EMPTY_METRICS })
  const metricsLoading = ref(false)
  const metricsError = ref('')
  const directorySnapshot = ref<DirectorySnapshot>({ ...EMPTY_DIRECTORY })
  const directoryLoading = ref(false)
  const directoryError = ref('')
  const networkRoute = ref<NetworkRouteSnapshot>({ ...EMPTY_ROUTE })
  const networkRouteLoading = ref(false)
  const networkRouteVisible = ref(false)
  const networkRouteError = ref('')
  const trackedCwdBySession = ref<Record<string, string>>({})
  const homePathBySession = ref<Record<string, string>>({})
  const inputBufferBySession = new Map<string, string>()
  let timer = 0
  let requestId = 0
  let inspectRequestId = 0

  const canShowSshMetrics = computed(() =>
    focusTerminal.value
    && activeTerminalMode.value === 'ssh'
    && sshConnected.value
    && !!sshSessionId.value,
  )

  const statusBarMode = computed(() => {
    if (nav.value === 'sftp' && !focusTerminal.value) return 'sftp'
    if (canShowSshMetrics.value) return 'ssh-metrics'
    return 'plain'
  })

  const activeSshTabName = computed(() => {
    const current = sshTabs.value.find((item) => item.id === sshSessionId.value)
    return String(current?.name || current?.host || '').trim()
  })

  const activeSshTabMeta = computed(() =>
    sshTabs.value.find((item) => item.id === sshSessionId.value) || null,
  )

  const activeTrackedPath = computed(() =>
    String(trackedCwdBySession.value[sshSessionId.value] || metrics.value.cwd || '').trim(),
  )

  const metricChips = computed(() => ([
    { label: 'CPU', value: formatPercent(metrics.value.cpuPercent), action: 'cpu' },
    { label: '内存', value: formatPercent(metrics.value.memoryPercent), action: 'memory' },
    { label: '硬盘', value: formatPercent(metrics.value.diskPercent), action: 'disk' },
    { label: '下行', value: formatRate(metrics.value.rxBytesPerSec), action: 'network' },
    { label: '上行', value: formatRate(metrics.value.txBytesPerSec), action: 'network' },
  ]))

  const connectionFacts = computed(() => {
    const tab = activeSshTabMeta.value
    return [
      { icon: 'server', label: '主机', value: String(tab?.host || metrics.value.host || '--') },
      { icon: 'user', label: '用户', value: String(tab?.username || metrics.value.user || '--') },
      { icon: 'plug', label: '端口', value: tab?.port ? String(tab.port) : '--' },
      { icon: 'folder', label: '目录', value: compactText(activeTrackedPath.value || '--', 20) },
    ]
  })

  const systemFacts = computed(() => ([
    { icon: 'monitor', label: '系统', value: compactText(metrics.value.os || '--', 22) },
    { icon: 'cpu', label: '内核', value: compactText(metrics.value.kernel || '--', 18) },
    { icon: 'terminal', label: 'Shell', value: compactText(metrics.value.shell || '--', 14) },
    { icon: 'clock3', label: '运行', value: compactText(metrics.value.uptime || '--', 16) },
  ]))

  const directoryStats = computed(() => ([
    { label: '目录', value: String(directorySnapshot.value.dirs || 0) },
    { label: '文件', value: String(directorySnapshot.value.files || 0) },
    { label: '总数', value: String(directorySnapshot.value.total || 0) },
    { label: '大小', value: directorySnapshot.value.size || '--' },
  ]))

  const resetMetrics = () => {
    requestId += 1
    inspectRequestId += 1
    metrics.value = { ...EMPTY_METRICS }
    directorySnapshot.value = { ...EMPTY_DIRECTORY }
    metricsLoading.value = false
    directoryLoading.value = false
    networkRouteLoading.value = false
    networkRouteVisible.value = false
    metricsError.value = ''
    directoryError.value = ''
    networkRouteError.value = ''
    networkRoute.value = { ...EMPTY_ROUTE }
  }

  const loadNetworkRoute = async () => {
    if (typeof window.lightterm.appGetNetworkRoute !== 'function') {
      networkRouteError.value = '当前版本未包含本机链路探测'
      return
    }
    networkRouteLoading.value = true
    networkRouteError.value = ''
    try {
      const res = await window.lightterm.appGetNetworkRoute()
      if (!res.ok) {
        networkRouteError.value = res.error || '读取本机链路失败'
        return
      }
      networkRoute.value = {
        localIp: String(res.localIp || ''),
        gateway: String(res.gateway || ''),
        dnsServers: Array.isArray(res.dnsServers) ? res.dnsServers.map((item) => String(item || '')).filter(Boolean) : [],
        hostname: String(res.hostname || ''),
        platform: String(res.platform || ''),
        targetHost: String(activeSshTabMeta.value?.host || metrics.value.host || '').trim(),
      }
    } catch (error) {
      networkRouteError.value = error instanceof Error ? error.message : '读取本机链路失败'
    } finally {
      networkRouteLoading.value = false
    }
  }

  const inspectDirectory = async (pathValue?: string, options?: { quiet?: boolean }) => {
    if (!canShowSshMetrics.value) return
    if (typeof window.lightterm.sshInspectPath !== 'function') return
    const sessionId = sshSessionId.value
    const path = String(pathValue || activeTrackedPath.value || metrics.value.cwd || '').trim()
    if (!path) return
    const currentRequestId = ++inspectRequestId
    directoryLoading.value = true
    if (!options?.quiet) directoryError.value = ''
    try {
      const res = await window.lightterm.sshInspectPath({ sessionId, path })
      if (currentRequestId !== inspectRequestId) return
      if (!res.ok || !res.snapshot) {
        directoryError.value = res.error || '目录读取失败'
        return
      }
      trackedCwdBySession.value = {
        ...trackedCwdBySession.value,
        [sessionId]: String(res.snapshot.cwd || path),
      }
      directorySnapshot.value = {
        cwd: String(res.snapshot.cwd || path),
        dirs: Number(res.snapshot.dirs || 0),
        files: Number(res.snapshot.files || 0),
        total: Number(res.snapshot.total || 0),
        size: String(res.snapshot.size || '--'),
        items: Array.isArray(res.snapshot.items)
          ? res.snapshot.items.map((item) => ({
            kind: String(item.kind || '').trim(),
            name: String(item.name || '').trim(),
          })).filter((item) => item.name)
          : [],
      }
      directoryError.value = ''
    } catch (error) {
      if (currentRequestId !== inspectRequestId) return
      directoryError.value = error instanceof Error ? error.message : '目录读取失败'
    } finally {
      if (currentRequestId === inspectRequestId) directoryLoading.value = false
    }
  }

  const loadMetrics = async () => {
    if (!canShowSshMetrics.value || metricsLoading.value) return
    if (typeof window.lightterm.sshMetrics !== 'function') {
      metrics.value = { ...EMPTY_METRICS }
      metricsError.value = '当前版本未包含服务器状态采集'
      return
    }
    metricsLoading.value = true
    const currentRequestId = ++requestId
    try {
      const res = await window.lightterm.sshMetrics({ sessionId: sshSessionId.value })
      if (currentRequestId !== requestId) return
      if (!res.ok) {
        metricsError.value = res.error || '读取服务器状态失败'
        return
      }
      if (!res.supported || !res.metrics) {
        metrics.value = { ...EMPTY_METRICS }
        metricsError.value = '当前服务器暂不支持状态采集'
        return
      }
      metrics.value = {
        supported: true,
        host: res.metrics.host || '',
        user: res.metrics.user || '',
        cwd: res.metrics.cwd || '',
        kernel: res.metrics.kernel || '',
        os: res.metrics.os || '',
        shell: res.metrics.shell || '',
        uptime: res.metrics.uptime || '',
        loadAverage: res.metrics.loadAverage || '',
        cpuPercent: res.metrics.cpuPercent ?? null,
        memoryPercent: res.metrics.memoryPercent ?? null,
        diskPercent: res.metrics.diskPercent ?? null,
        memoryUsedKb: Number(res.metrics.memoryUsedKb || 0),
        memoryTotalKb: Number(res.metrics.memoryTotalKb || 0),
        diskUsedKb: Number(res.metrics.diskUsedKb || 0),
        diskTotalKb: Number(res.metrics.diskTotalKb || 0),
        rxBytesPerSec: Number(res.metrics.rxBytesPerSec || 0),
        txBytesPerSec: Number(res.metrics.txBytesPerSec || 0),
      }
      if (!homePathBySession.value[sshSessionId.value] && res.metrics.cwd) {
        homePathBySession.value = {
          ...homePathBySession.value,
          [sshSessionId.value]: String(res.metrics.cwd || ''),
        }
      }
      if (!trackedCwdBySession.value[sshSessionId.value] && res.metrics.cwd) {
        trackedCwdBySession.value = {
          ...trackedCwdBySession.value,
          [sshSessionId.value]: String(res.metrics.cwd || ''),
        }
        void inspectDirectory(String(res.metrics.cwd || ''), { quiet: true })
      }
      metricsError.value = ''
    } catch (error) {
      if (currentRequestId !== requestId) return
      metricsError.value = error instanceof Error ? error.message : '读取服务器状态失败'
    } finally {
      if (currentRequestId === requestId) metricsLoading.value = false
    }
  }

  const stopPolling = () => {
    if (timer) {
      window.clearInterval(timer)
      timer = 0
    }
  }

  const startPolling = () => {
    stopPolling()
    void loadMetrics()
    timer = window.setInterval(() => {
      void loadMetrics()
    }, 4000)
  }

  const trackTerminalInput = (data: string) => {
    if (!canShowSshMetrics.value || !sshSessionId.value) return
    const sessionId = sshSessionId.value
    let buffer = String(inputBufferBySession.get(sessionId) || '')
    for (const char of Array.from(String(data || ''))) {
      if (char === '\r' || char === '\n') {
        const rawCommand = buffer.trim()
        buffer = ''
        if (!rawCommand) continue
        const firstSegment = rawCommand.split(/&&|;/)[0]?.trim() || ''
        const match = firstSegment.match(/^cd(?:\s+(.+))?$/)
        if (!match) continue
        const nextTarget = stripQuotes(String(match[1] || '').trim())
        const nextPath = resolveTrackedPath(
          trackedCwdBySession.value[sessionId] || metrics.value.cwd || '/',
          homePathBySession.value[sessionId] || metrics.value.cwd || '/',
          nextTarget,
        )
        if (!nextPath) continue
        trackedCwdBySession.value = {
          ...trackedCwdBySession.value,
          [sessionId]: nextPath,
        }
        void inspectDirectory(nextPath)
        continue
      }
      if (char === '\u007f' || char === '\b') {
        buffer = buffer.slice(0, -1)
        continue
      }
      if (char >= ' ' && char !== '\u001b') buffer += char
    }
    inputBufferBySession.set(sessionId, buffer)
  }

  const trackTerminalCommand = (command: string) => {
    const raw = String(command || '').trim()
    if (!raw) return
    const match = raw.match(/^cd(?:\s+(.+))?$/)
    if (!match) return
    const sessionId = sshSessionId.value
    const nextTarget = stripQuotes(String(match[1] || '').trim())
    const nextPath = resolveTrackedPath(
      trackedCwdBySession.value[sessionId] || metrics.value.cwd || '/',
      homePathBySession.value[sessionId] || metrics.value.cwd || '/',
      nextTarget,
    )
    if (!nextPath) return
    trackedCwdBySession.value = {
      ...trackedCwdBySession.value,
      [sessionId]: nextPath,
    }
    void inspectDirectory(nextPath)
  }

  const runMetricAction = async (action: string) => {
    const mode = String(action || '').trim()
    if (mode === 'cpu') return { type: 'command', command: 'top' }
    if (mode === 'memory') return { type: 'command', command: 'free -h || vm_stat' }
    if (mode === 'disk') return { type: 'command', command: 'df -h' }
    if (mode === 'network') {
      networkRouteVisible.value = !networkRouteVisible.value
      if (networkRouteVisible.value) await loadNetworkRoute()
      return { type: 'panel' }
    }
    return { type: 'none' }
  }

  const networkRouteSteps = computed(() => {
    const route = networkRoute.value
    return [
      { label: '本机', value: route.localIp || route.hostname || '--' },
      { label: '路由', value: route.gateway || '--' },
      { label: 'DNS', value: route.dnsServers[0] || '--' },
      { label: '目标', value: route.targetHost || String(activeSshTabMeta.value?.host || '--') },
    ]
  })

  watch([canShowSshMetrics, sshSessionId], ([enabled, sessionId]) => {
    stopPolling()
    if (!enabled) {
      resetMetrics()
      return
    }
    directorySnapshot.value = { ...EMPTY_DIRECTORY }
    directoryError.value = ''
    directoryLoading.value = false
    if (trackedCwdBySession.value[sessionId]) {
      void inspectDirectory(trackedCwdBySession.value[sessionId], { quiet: true })
    }
    startPolling()
  }, { immediate: true })

  onBeforeUnmount(() => {
    stopPolling()
  })

  return {
    metrics,
    metricsLoading,
    metricsError,
    directorySnapshot,
    directoryLoading,
    directoryError,
    networkRoute,
    networkRouteLoading,
    networkRouteVisible,
    networkRouteError,
    networkRouteSteps,
    statusBarMode,
    activeSshTabName,
    metricChips,
    connectionFacts,
    systemFacts,
    directoryStats,
    trackTerminalInput,
    trackTerminalCommand,
    runMetricAction,
  }
}
