import { ref, type Ref } from 'vue'

type HostProbeState = 'unknown' | 'checking' | 'online' | 'offline'

type LocalSSHConfig = { host: string; port?: number; username: string; password?: string; privateKey?: string }

export function useHostProbe(params: {
  hostItems: Ref<any[]>
  filteredHosts: Ref<any[]>
}) {
  const { hostItems, filteredHosts } = params

  const hostProbeById = ref<Record<string, { state: HostProbeState; detail?: string }>>({})
  const hostProbeRunning = ref(false)
  let hostProbeBatchId = 0

  const cancelHostProbe = () => {
    hostProbeBatchId += 1
    hostProbeRunning.value = false
  }

  const setHostProbeState = (hostId: string, state: HostProbeState, detail = '') => {
    const prev = hostProbeById.value[hostId]
    const nextDetail = detail || ''
    if (prev?.state === state && (prev?.detail || '') === nextDetail) return
    hostProbeById.value[hostId] = { state, detail: nextDetail }
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
    const probeMap = hostProbeById.value
    const activeHostIds = new Set<string>()

    hostItems.value.forEach((h) => {
      const id = String(h?.id || '')
      if (!id) return
      activeHostIds.add(id)
      if (!probeMap[id]) probeMap[id] = { state: 'unknown' }
    })

    Object.keys(probeMap).forEach((id) => {
      if (!activeHostIds.has(id)) delete probeMap[id]
    })
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
    if (batchId !== hostProbeBatchId) return
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

  const runHostProbeBatch = async (targets: any[]) => {
    if (hostProbeRunning.value) return
    if (!targets.length) return
    syncHostProbeMap()
    const batchId = ++hostProbeBatchId
    hostProbeRunning.value = true
    const queue = [...targets]
    const workerCount = Math.min(3, queue.length)
    try {
      await Promise.all(Array.from({ length: workerCount }, async () => {
        while (queue.length > 0) {
          if (batchId !== hostProbeBatchId) return
          const host = queue.shift()
          if (!host) break
          await testHostReachability(host, batchId)
        }
      }))
    } finally {
      hostProbeRunning.value = false
    }
  }

  const probeAllHosts = async () => runHostProbeBatch(hostItems.value)
  const probeFilteredHosts = async () => runHostProbeBatch(filteredHosts.value)

  return {
    hostProbeById,
    hostProbeRunning,
    cancelHostProbe,
    hostProbeClass,
    hostProbeTitle,
    syncHostProbeMap,
    testHostReachability,
    probeAllHosts,
    probeFilteredHosts,
  }
}
