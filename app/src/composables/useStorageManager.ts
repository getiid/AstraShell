import { ref, type Ref } from 'vue'

type UseStorageManagerParams = {
  formatAppError: (error: unknown) => string
  nav: Ref<string>
  snippetsLoaded: Ref<boolean>
  restoreSnippets: () => Promise<void>
  vaultUnlocked: Ref<boolean>
  vaultKeysLoaded: Ref<boolean>
  refreshVaultKeys: () => Promise<void>
  refreshHosts: () => Promise<unknown>
}

export function useStorageManager(params: UseStorageManagerParams) {
  const {
    formatAppError,
    nav,
    snippetsLoaded,
    restoreSnippets,
    vaultUnlocked,
    vaultKeysLoaded,
    refreshVaultKeys,
    refreshHosts,
  } = params

  const storageDbPath = ref('')
  const storagePathInput = ref('')
  const storageMsg = ref('')
  const storageMetaText = ref('')
  const backupItems = ref<Array<{ name: string; path: string; size: number; mtimeMs: number }>>([])
  const selectedBackupPath = ref('')
  let storageDataRefreshTimer: number | null = null

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

  const refreshStorageInfo = async (onConfigured?: () => void, onError?: (message: string) => void) => {
    try {
      const [res, meta] = await Promise.all([
        window.lightterm.appGetStorage(),
        window.lightterm.appGetStorageMeta(),
      ])
      if (res.ok) {
        storageDbPath.value = res.dbPath || meta.dbPath || ''
        if (!storagePathInput.value && storageDbPath.value) storagePathInput.value = storageDbPath.value
        onConfigured?.()
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
        const sig = String(meta.signature || '').split(':').pop() || ''
        const sigShort = sig ? sig.slice(0, 8) : '-'
        storageMetaText.value = `当前读取：${meta.dbPath || '-'} ｜ 文件：${fileState} ｜ 大小：${kb.toFixed(1)} KB ｜ 修改时间：${modified} ｜ 数据：主机 ${meta.hosts || 0} / 片段 ${meta.snippets || 0} / 密钥 ${meta.vaultKeys || 0} / 日志 ${meta.logs || 0} ｜ fileId：${meta.fileId || '-'} ｜ rev：${meta.revision ?? 0} ｜ 指纹：${sigShort} ｜ 加密：${encrypted} ｜ 格式：v${meta.storageVersion || 1}`
      }
    } catch (error) {
      onError?.(`读取数据文件路径失败：${formatAppError(error)}`)
    }
  }

  const refreshStorageOverview = async (onConfigured?: () => void, onError?: (message: string) => void) => {
    await refreshStorageInfo(onConfigured, onError)
  }

  const refreshStorageDataNow = async (onConfigured?: () => void, onError?: (message: string) => void) => {
    const res = await window.lightterm.appRefreshStorageData()
    if (!res?.ok) {
      storageMsg.value = `刷新失败：${res?.error || '未知错误'}`
      return
    }
    await refreshStorageOverview(onConfigured, onError)
    await refreshHosts()
    if (snippetsLoaded.value || nav.value === 'snippets') await restoreSnippets()
    if (vaultUnlocked.value && (vaultKeysLoaded.value || nav.value === 'vault')) await refreshVaultKeys()
    storageMsg.value = res.changed ? '已强制刷新共享数据文件并同步界面' : '已刷新（文件无新变更）'
  }

  const scheduleStorageDataRefresh = (
    startupGateVisible: Ref<boolean>,
    onConfigured?: () => void,
    onError?: (message: string) => void,
  ) => {
    if (storageDataRefreshTimer) window.clearTimeout(storageDataRefreshTimer)
    storageDataRefreshTimer = window.setTimeout(async () => {
      storageDataRefreshTimer = null
      if (startupGateVisible.value) return
      await refreshStorageOverview(onConfigured, onError)
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

  const applyStoragePath = async (onConfigured?: () => void, onError?: (message: string) => void) => {
    if (!storagePathInput.value.trim()) return
    const res = await window.lightterm.appSetStorageFolder({ folder: storagePathInput.value.trim() })
    storageMsg.value = res.ok ? `已设置数据文件：${res.dbPath}（重启应用生效）` : `设置失败：${res.error}`
    await refreshStorageOverview(onConfigured, onError)
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
    storageMsg.value = res.ok ? `备份已创建：${res.backupPath}` : `备份失败：${res.error || '未知错误'}`
    if (res.ok) await refreshBackupList()
  }

  const openBackupsFolder = async () => {
    const res = await window.lightterm.appOpenBackupsFolder()
    storageMsg.value = res.ok ? `已打开备份目录：${res.path || ''}` : `打开备份目录失败：${res.error || '未知错误'}`
  }

  const restoreDataBackup = async (
    onConfigured?: () => void,
    onError?: (message: string) => void,
  ) => {
    if (!selectedBackupPath.value) {
      storageMsg.value = '请先选择备份文件'
      return
    }
    const ok = window.confirm('恢复备份会覆盖当前共享数据文件，确定继续吗？')
    if (!ok) return
    const res = await window.lightterm.appRestoreBackup({ backupPath: selectedBackupPath.value })
    storageMsg.value = res.ok ? '备份已恢复并重新加载数据' : `恢复失败：${res.error || '未知错误'}`
    if (res.ok) {
      await refreshStorageDataNow(onConfigured, onError)
      await refreshBackupList()
    }
  }

  const clearStorageDataRefreshTimer = () => {
    if (storageDataRefreshTimer) {
      window.clearTimeout(storageDataRefreshTimer)
      storageDataRefreshTimer = null
    }
  }

  return {
    storageDbPath,
    storagePathInput,
    storageMsg,
    storageMetaText,
    backupItems,
    selectedBackupPath,
    dbFolderFromPath,
    normalizeStoragePathForCompare,
    refreshStorageInfo,
    refreshStorageOverview,
    refreshStorageDataNow,
    scheduleStorageDataRefresh,
    pickStorageFile,
    pickStorageFolder,
    applyStoragePath,
    refreshBackupList,
    createDataBackup,
    openBackupsFolder,
    restoreDataBackup,
    clearStorageDataRefreshTimer,
  }
}
