import type { Ref } from 'vue'

type NavKey = 'hosts' | 'sftp' | 'snippets' | 'serial' | 'local' | 'database' | 'vault' | 'settings' | 'logs'
type StartupGateMode = 'loading' | 'init' | 'unlock'

type UseAppStartupLifecycleParams = {
  startupGateVisible: Ref<boolean>
  startupGateMode: Ref<StartupGateMode>
  startupGateError: Ref<string>
  startupGateVisibleRef: Ref<boolean>
  sessionRestoreTried: Ref<boolean>
  startupGateEnsureDbPath: () => void
  runPostUnlockStartupTasks: () => Promise<void>
  evaluateVaultGate: () => void
  checkVaultStatus: () => Promise<any>
  resetVaultBase: () => Promise<void>
  restoreSessionRestoreState: () => any
  localConnected: Readonly<Ref<boolean>>
  localCwd: Ref<string>
  connectLocalTerminal: () => Promise<void>
  sshForm: Ref<{ host: string; port: number; username: string; password: string }>
  hostName: Ref<string>
  authType: Ref<'password' | 'key'>
  selectedKeyRef: Ref<string>
  connectSSH: (options?: { keepNav?: boolean } | Event) => Promise<boolean>
  vaultUnlocked: Ref<boolean>
  vaultKeysLoaded: Ref<boolean>
  refreshVaultKeys: () => Promise<void>
  cancelHostProbe: () => void
  localFsLoaded: Ref<boolean>
  loadLocalFs: () => Promise<void>
  rightLocalFsLoaded: Ref<boolean>
  rightPanelMode: Ref<'local' | 'remote'>
  loadRightLocalFs: () => Promise<void>
  snippetsLoaded: Ref<boolean>
  restoreSnippets: () => Promise<void>
  serialPortsLoaded: Ref<boolean>
  loadSerialPorts: () => Promise<void>
  updateStateLoaded: Ref<boolean>
  refreshUpdateState: () => Promise<void>
  refreshAuditLogs: () => Promise<void>
  refreshStorageInfoRaw: (onConfigured?: () => void, onError?: (message: string) => void) => Promise<void>
  refreshStorageDataNowRaw: (onConfigured?: () => void, onError?: (message: string) => void) => Promise<void>
  scheduleStorageDataRefreshRaw: (
    startupGateVisible: Ref<boolean>,
    onConfigured?: () => void,
    onError?: (message: string) => void,
  ) => void
  applyStoragePathRaw: (onConfigured?: () => void, onError?: (message: string) => void) => Promise<void>
  restoreDataBackupRaw: (onConfigured?: () => void, onError?: (message: string) => void) => Promise<void>
  formatAppError: (error: unknown) => string
  clearSessionRestoreState: () => void
  clearSshTabs: () => void
  loadTerminalEncoding: () => void
  refreshBackupList: () => Promise<void>
  runStartupSyncPull: () => Promise<void>
}

export function useAppStartupLifecycle(params: UseAppStartupLifecycleParams) {
  const {
    startupGateVisible,
    startupGateMode,
    startupGateError,
    startupGateVisibleRef,
    sessionRestoreTried,
    startupGateEnsureDbPath,
    runPostUnlockStartupTasks,
    evaluateVaultGate,
    checkVaultStatus,
    resetVaultBase,
    restoreSessionRestoreState,
    localConnected,
    localCwd,
    connectLocalTerminal,
    sshForm,
    hostName,
    authType,
    selectedKeyRef,
    connectSSH,
    vaultUnlocked,
    vaultKeysLoaded,
    refreshVaultKeys,
    cancelHostProbe,
    localFsLoaded,
    loadLocalFs,
    rightLocalFsLoaded,
    rightPanelMode,
    loadRightLocalFs,
    snippetsLoaded,
    restoreSnippets,
    serialPortsLoaded,
    loadSerialPorts,
    updateStateLoaded,
    refreshUpdateState,
    refreshAuditLogs,
    refreshStorageInfoRaw,
    refreshStorageDataNowRaw,
    scheduleStorageDataRefreshRaw,
    applyStoragePathRaw,
    restoreDataBackupRaw,
    formatAppError,
    clearSessionRestoreState,
    clearSshTabs,
    loadTerminalEncoding,
    refreshBackupList,
    runStartupSyncPull,
  } = params

  const bindStartupError = (message: string) => {
    startupGateError.value = message
  }

  const refreshStorageInfo = () => refreshStorageInfoRaw(
    startupGateEnsureDbPath,
    bindStartupError,
  )

  const refreshStorageDataNow = () => refreshStorageDataNowRaw(
    startupGateEnsureDbPath,
    bindStartupError,
  )

  const scheduleStorageDataRefresh = () => scheduleStorageDataRefreshRaw(
    startupGateVisibleRef,
    startupGateEnsureDbPath,
    bindStartupError,
  )

  const applyStoragePath = () => applyStoragePathRaw(
    startupGateEnsureDbPath,
    bindStartupError,
  )

  const restoreDataBackup = () => restoreDataBackupRaw(
    startupGateEnsureDbPath,
    bindStartupError,
  )

  const syncVaultGateState = async () => {
    const res = await checkVaultStatus()
    if (!res) {
      startupGateVisible.value = false
      return null
    }
    if (!res.configured) {
      startupGateVisible.value = false
      return res
    }
    startupGateEnsureDbPath()
    if (res.error) {
      startupGateMode.value = 'loading'
      startupGateVisible.value = true
      startupGateError.value = `数据文件读取失败：${res.error}`
      return res
    }
    if (!res.exists) {
      startupGateVisible.value = false
      return res
    }
    evaluateVaultGate()
    return res
  }

  const resetVault = async () => {
    await resetVaultBase()
    await syncVaultGateState()
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
    if (state.type !== 'ssh') return
    if (!state.host || !state.username) return
    sshForm.value.host = String(state.host)
    sshForm.value.port = Number(state.port || 22)
    sshForm.value.username = String(state.username)
    hostName.value = String(state.hostName || `${state.username}@${state.host}`)
    authType.value = state.authType === 'key' ? 'key' : 'password'
    selectedKeyRef.value = String(state.keyRef || '')
    await connectSSH({ keepNav: true })
  }

  const handleNavChange = async (value: NavKey) => {
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
      if (!snippetsLoaded.value) await restoreSnippets()
      return
    }

    if (value === 'database') {
      if (!snippetsLoaded.value) await restoreSnippets()
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
  }

  const handleStartupGateVisibleChange = (visible: boolean) => {
    if (visible) return
    void runPostUnlockStartupTasks()
    void runStartupSyncPull()
    if (sessionRestoreTried.value) return
    sessionRestoreTried.value = true
    clearSessionRestoreState()
  }

  const bootstrapStartupState = async () => {
    startupGateVisible.value = true
    startupGateMode.value = 'loading'
    startupGateError.value = ''
    void refreshStorageInfo()
    try {
      await syncVaultGateState()
    } catch (error) {
      startupGateError.value = `启动检查失败：${formatAppError(error)}`
      if (startupGateMode.value === 'loading') startupGateMode.value = 'init'
    }

    clearSshTabs()
    loadTerminalEncoding()
    void refreshBackupList()
    if (startupGateVisible.value) return

    await runPostUnlockStartupTasks()
    void runStartupSyncPull()
    sessionRestoreTried.value = true
    clearSessionRestoreState()
  }

  return {
    refreshStorageInfo,
    refreshStorageDataNow,
    scheduleStorageDataRefresh,
    applyStoragePath,
    restoreDataBackup,
    syncVaultGateState,
    resetVault,
    restoreLastSessionIfNeeded,
    handleNavChange,
    handleStartupGateVisibleChange,
    bootstrapStartupState,
  }
}
