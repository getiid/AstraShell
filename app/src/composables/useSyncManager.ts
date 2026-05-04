import { computed, ref } from 'vue'

type UseSyncManagerParams = {
  refreshStorageDataNow: () => Promise<void>
}

export function useSyncManager(params: UseSyncManagerParams) {
  const { refreshStorageDataNow } = params

  const syncEnabled = ref(false)
  const syncProvider = ref<'folder' | 'http'>('folder')
  const syncTargetPath = ref('')
  const syncBaseUrl = ref('')
  const syncToken = ref('')
  const syncPassword = ref('')
  const syncAutoPullOnStartup = ref(true)
  const syncAutoPushOnChange = ref(true)
  const syncDebounceMs = ref(1500)
  const syncBusy = ref(false)
  const syncMsg = ref('')
  const syncUnsupported = ref(false)
  const syncQueueItems = ref<any[]>([])
  const syncStatusPayload = ref<any | null>(null)

  const syncQueueCount = computed(() => syncQueueItems.value.length)
  const syncState = computed(() => syncStatusPayload.value?.state || {})
  const syncRemoteMeta = computed(() => syncStatusPayload.value?.remote || null)
  const syncLocalMeta = computed(() => syncStatusPayload.value?.local || null)

  const syncRuntimeStatusText = computed(() => {
    if (syncBusy.value || syncState.value?.running) return '同步进行中...'
    if (syncState.value?.lastError) return `同步失败：${syncState.value.lastError}`
    return ''
  })

  const syncStatusText = computed(() => {
    if (syncUnsupported.value) return 'Tauri 版本暂未实现同步，请改用上方“本地数据文件”切换现有数据库'
    if (!syncEnabled.value) return '同步已关闭，本地数据库独立运行'
    if (!syncTargetPath.value) return '请先选择同步数据库文件'
    if (syncState.value?.running) return '同步进行中...'
    if (syncState.value?.lastError) return `最近一次同步失败：${syncState.value.lastError}`
    if (syncState.value?.lastSuccessMessage) return syncState.value.lastSuccessMessage
    return '同步已启用，等待第一次推送或拉取'
  })

  const formatSyncTime = (value: number | string | null | undefined) => {
    const raw = Number(value || 0)
    if (!raw) return '-'
    const date = new Date(raw)
    if (Number.isNaN(date.getTime())) return '-'
    return date.toLocaleString()
  }

  const mergeSyncStatus = (payload: any) => {
    if (!payload?.ok) return
    syncStatusPayload.value = payload
    const config = payload.config || {}
    syncUnsupported.value = !!payload.state?.unsupported
    syncEnabled.value = !!config.enabled
    syncProvider.value = 'folder'
    syncTargetPath.value = String(config.targetPath || '')
    syncBaseUrl.value = String(config.baseUrl || '')
    syncToken.value = String(config.token || '')
    syncPassword.value = String(config.password || '')
    syncAutoPullOnStartup.value = config.autoPullOnStartup !== false
    syncAutoPushOnChange.value = config.autoPushOnChange !== false
    syncDebounceMs.value = Number(config.debounceMs || 1500)
    if (Array.isArray(payload.state?.queue)) syncQueueItems.value = payload.state.queue
    if (payload.state?.lastError) {
      syncMsg.value = `同步失败：${payload.state.lastError}`
      return
    }
    if (payload.state?.lastSuccessMessage) syncMsg.value = payload.state.lastSuccessMessage
  }

  const refreshSyncStatus = async () => {
    const res = await window.lightterm.syncStatus()
    if (res?.ok) mergeSyncStatus(res)
    else syncMsg.value = `读取同步状态失败：${res?.error || '未知错误'}`
  }

  const refreshSyncQueue = async () => {
    const res = await window.lightterm.syncQueue()
    if (res?.ok) syncQueueItems.value = Array.isArray(res.items) ? res.items : []
    else syncMsg.value = '读取同步队列失败'
  }

  const saveSyncConfig = async () => {
    if (syncUnsupported.value) {
      syncMsg.value = 'Tauri 版本暂未实现同步，请改用本地数据文件切换'
      return
    }
    syncBusy.value = true
    try {
      const res = await window.lightterm.syncSetConfig({
        enabled: syncEnabled.value,
        provider: 'folder',
        targetPath: syncTargetPath.value.trim(),
        baseUrl: '',
        token: '',
        password: syncPassword.value,
        autoPullOnStartup: syncAutoPullOnStartup.value,
        autoPushOnChange: syncAutoPushOnChange.value,
        debounceMs: syncDebounceMs.value,
      })
      syncMsg.value = res.ok ? '同步配置已保存' : `保存同步配置失败：${res.error || '未知错误'}`
      if (res.ok) await refreshSyncStatus()
    } finally {
      syncBusy.value = false
    }
  }

  const pickSyncFile = async () => {
    const res = await window.lightterm.appPickStorageFile()
    if (res.ok && res.filePath) syncTargetPath.value = res.filePath
  }

  const pickSyncSaveFile = async () => {
    const res = await window.lightterm.appPickStorageSaveFile()
    if (res.ok && res.filePath) syncTargetPath.value = res.filePath
  }

  const pickSyncFolder = async () => {
    const res = await window.lightterm.appPickStorageFolder()
    if (res.ok && res.folder) syncTargetPath.value = res.folder
  }

  const testSyncConnection = async () => {
    if (syncUnsupported.value) {
      syncMsg.value = 'Tauri 版本暂未实现同步，请改用本地数据文件切换'
      return
    }
    syncBusy.value = true
    try {
      const res = await window.lightterm.syncTestConnection()
      syncMsg.value = res.ok
        ? `同步目标可用：${res.targetPath || syncBaseUrl.value || syncTargetPath.value}`
        : `测试失败：${res.error || '未知错误'}`
      await refreshSyncStatus()
    } finally {
      syncBusy.value = false
    }
  }

  const syncPullNow = async () => {
    if (syncUnsupported.value) {
      syncMsg.value = 'Tauri 版本暂未实现同步，请改用本地数据文件切换'
      return
    }
    syncBusy.value = true
    try {
      const res = await window.lightterm.syncPullNow()
      syncMsg.value = res.ok ? (res.message || (res.changed ? '已下载远端数据' : '远端暂无新数据')) : `下载失败：${res.error || '未知错误'}`
      if (res.ok) await refreshStorageDataNow()
      await refreshSyncStatus()
      await refreshSyncQueue()
    } finally {
      syncBusy.value = false
    }
  }

  const syncPushNow = async () => {
    if (syncUnsupported.value) {
      syncMsg.value = 'Tauri 版本暂未实现同步，请改用本地数据文件切换'
      return
    }
    syncBusy.value = true
    try {
      const res = await window.lightterm.syncPushNow()
      syncMsg.value = res.ok ? (res.message || '已上传本地数据') : `上传失败：${res.error || '未知错误'}`
      await refreshSyncStatus()
      await refreshSyncQueue()
    } finally {
      syncBusy.value = false
    }
  }

  const syncRetryFailed = async () => {
    if (syncUnsupported.value) {
      syncMsg.value = 'Tauri 版本暂未实现同步，请改用本地数据文件切换'
      return
    }
    syncBusy.value = true
    try {
      const res = await window.lightterm.syncRetryFailed()
      syncMsg.value = res.ok ? (res.message || '已完成重试') : `重试失败：${res.error || '未知错误'}`
      await refreshSyncStatus()
      await refreshSyncQueue()
    } finally {
      syncBusy.value = false
    }
  }

  const clearSyncQueue = async () => {
    if (syncUnsupported.value) {
      syncMsg.value = 'Tauri 版本暂未实现同步，请改用本地数据文件切换'
      return
    }
    syncBusy.value = true
    try {
      const res = await window.lightterm.syncClearQueue()
      syncMsg.value = res.ok ? '已清空同步队列' : '清空失败'
      await refreshSyncStatus()
      await refreshSyncQueue()
    } finally {
      syncBusy.value = false
    }
  }

  const shouldSkipStartupAutoPull = () => {
    const localItemCount = Number(syncLocalMeta.value?.itemCount || 0)
    const remoteItemCount = Number(syncRemoteMeta.value?.itemCount || 0)
    const localSize = Number(syncLocalMeta.value?.size || 0)
    const remoteSize = Number(syncRemoteMeta.value?.size || 0)
    if (localItemCount <= 0) return false
    if (remoteItemCount < localItemCount) return true
    if (remoteItemCount === localItemCount && remoteSize > 0 && remoteSize < localSize) return true
    return false
  }

  const runStartupSyncPull = async () => {
    if (!syncStatusPayload.value) await refreshSyncStatus()
    if (!syncEnabled.value || !syncAutoPullOnStartup.value) return
    if (syncProvider.value === 'folder' && !syncTargetPath.value) return
    if (syncProvider.value === 'http' && !syncBaseUrl.value) return
    if (shouldSkipStartupAutoPull()) {
      syncMsg.value = '已跳过自动下载：本地数据量大于远端，请手动确认后再下载'
      await refreshSyncStatus()
      await refreshSyncQueue()
      return
    }
    const res = await window.lightterm.syncPullNow()
    if (res.ok && res.changed) await refreshStorageDataNow()
    await refreshSyncStatus()
    await refreshSyncQueue()
  }

  return {
    syncEnabled,
    syncProvider,
    syncTargetPath,
    syncBaseUrl,
    syncToken,
    syncPassword,
    syncAutoPullOnStartup,
    syncAutoPushOnChange,
    syncDebounceMs,
    syncBusy,
    syncMsg,
    syncUnsupported,
    syncQueueItems,
    syncStatusPayload,
    syncState,
    syncRemoteMeta,
    syncLocalMeta,
    syncQueueCount,
    syncRuntimeStatusText,
    syncStatusText,
    formatSyncTime,
    mergeSyncStatus,
    refreshSyncStatus,
    refreshSyncQueue,
    saveSyncConfig,
    pickSyncFile,
    pickSyncSaveFile,
    pickSyncFolder,
    testSyncConnection,
    syncPullNow,
    syncPushNow,
    syncRetryFailed,
    clearSyncQueue,
    runStartupSyncPull,
  }
}
