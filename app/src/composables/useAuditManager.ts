import { computed, ref, watch } from 'vue'

export type AuditLogItem = {
  id: string
  ts: number
  source: string
  action: string
  target: string
  content: string
  level?: string
}

export function useAuditManager() {
  const auditLogs = ref<AuditLogItem[]>([])
  const auditLoaded = ref(false)
  const auditStatus = ref('')
  const auditKeyword = ref('')
  const auditSource = ref('all')
  const selectedAuditTarget = ref('')

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

  const appendAuditLog = (item: AuditLogItem) => {
    auditLogs.value = [item, ...auditLogs.value]
    if (auditLogs.value.length > 1200) auditLogs.value = auditLogs.value.slice(0, 1200)
    auditStatus.value = `共 ${auditLogs.value.length} 条日志`
    if (!auditLoaded.value) auditLoaded.value = true
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

  watch(auditTargetGroups, (groups) => {
    if (groups.length === 0) {
      selectedAuditTarget.value = ''
      return
    }
    if (!groups.some((item) => item.target === selectedAuditTarget.value)) {
      selectedAuditTarget.value = groups[0]?.target || ''
    }
  }, { immediate: true })

  return {
    auditLogs,
    auditLoaded,
    auditStatus,
    auditKeyword,
    auditSource,
    selectedAuditTarget,
    auditTargetGroups,
    currentAuditLogs,
    resolveAuditTarget,
    refreshAuditLogs,
    clearAuditLogs,
    appendAuditLog,
    formatAuditTime,
    formatAuditSource,
    formatAuditAction,
  }
}
