import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'

type TerminalMode = 'ssh' | 'serial' | 'local'
type NavKey = 'hosts' | 'sftp' | 'snippets' | 'serial' | 'local' | 'database' | 'vault' | 'settings' | 'logs'

type MetricsState = {
  supported: boolean
  cpuPercent: number | null
  memoryPercent: number | null
  diskPercent: number | null
  rxBytesPerSec: number
  txBytesPerSec: number
}

const EMPTY_METRICS: MetricsState = {
  supported: false,
  cpuPercent: null,
  memoryPercent: null,
  diskPercent: null,
  rxBytesPerSec: 0,
  txBytesPerSec: 0,
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

export function useSshServerMetrics(params: {
  nav: Ref<NavKey>
  focusTerminal: Ref<boolean>
  activeTerminalMode: Ref<TerminalMode>
  sshConnected: Ref<boolean>
  sshSessionId: Ref<string>
  sshTabs: Ref<Array<{ id: string; name: string; host?: string }>>
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
  let timer = 0
  let requestId = 0

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

  const metricChips = computed(() => ([
    { label: 'CPU', value: formatPercent(metrics.value.cpuPercent) },
    { label: '内存', value: formatPercent(metrics.value.memoryPercent) },
    { label: '硬盘', value: formatPercent(metrics.value.diskPercent) },
    { label: '下行', value: formatRate(metrics.value.rxBytesPerSec) },
    { label: '上行', value: formatRate(metrics.value.txBytesPerSec) },
  ]))

  const resetMetrics = () => {
    requestId += 1
    metrics.value = { ...EMPTY_METRICS }
    metricsLoading.value = false
    metricsError.value = ''
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
        cpuPercent: res.metrics.cpuPercent ?? null,
        memoryPercent: res.metrics.memoryPercent ?? null,
        diskPercent: res.metrics.diskPercent ?? null,
        rxBytesPerSec: Number(res.metrics.rxBytesPerSec || 0),
        txBytesPerSec: Number(res.metrics.txBytesPerSec || 0),
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

  watch([canShowSshMetrics, sshSessionId], ([enabled]) => {
    stopPolling()
    if (!enabled) {
      resetMetrics()
      return
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
    statusBarMode,
    activeSshTabName,
    metricChips,
  }
}
