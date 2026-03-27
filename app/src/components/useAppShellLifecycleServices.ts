import { watch } from 'vue'
import { useAppStartupLifecycle } from '../composables/useAppStartupLifecycle'
import { useStartupGate } from '../composables/useStartupGate'
import { useStorageManager } from '../composables/useStorageManager'
import { useSyncManager } from '../composables/useSyncManager'
import { useWindowBridgeEvents } from '../composables/useWindowBridgeEvents'

export function useAppShellLifecycleServices(parts: Record<string, any>) {
  let reevaluateVaultGate = () => {}

  const storageManager = useStorageManager({
    formatAppError: parts.formatAppError,
    nav: parts.nav,
    snippetsLoaded: parts.snippetsLoaded,
    restoreSnippets: parts.restoreSnippets,
    vaultUnlocked: parts.vaultUnlocked,
    vaultKeysLoaded: parts.vaultKeysLoaded,
    refreshVaultKeys: parts.refreshVaultKeys,
    checkVaultStatus: parts.checkVaultStatus,
    evaluateVaultGate: () => reevaluateVaultGate(),
    refreshHosts: async () => parts.refreshHosts(),
  })

  const syncManager = useSyncManager({
    refreshStorageDataNow: async () => storageManager.refreshStorageDataNow(),
  })
  void syncManager.refreshSyncStatus()
  void syncManager.refreshSyncQueue()

  const startupGate = useStartupGate({
    storageDbPath: storageManager.storageDbPath,
    dbFolderFromPath: storageManager.dbFolderFromPath,
    vaultMaster: parts.vaultMaster,
    vaultStatus: parts.vaultStatus,
    vaultInitialized: parts.vaultInitialized,
    vaultUnlocked: parts.vaultUnlocked,
    vaultRequiresPassword: parts.vaultRequiresPassword,
    refreshVaultKeys: parts.refreshVaultKeys,
    initVault: parts.initVault,
    unlockVault: parts.unlockVault,
    refreshHosts: async () => parts.refreshHosts(),
    refreshStorageOverview: async () => storageManager.refreshStorageOverview(
      startupGate.ensureStartupDbPath,
      (message) => { startupGate.startupGateError.value = message },
    ),
    refreshUpdateState: parts.refreshUpdateState,
    snippetStatus: parts.snippetStatus,
    formatAppError: parts.formatAppError,
  })
  reevaluateVaultGate = () => startupGate.evaluateVaultGate()

  const appStartupLifecycle = useAppStartupLifecycle({
    startupGateVisible: startupGate.startupGateVisible,
    startupGateMode: startupGate.startupGateMode,
    startupGateError: startupGate.startupGateError,
    startupGateVisibleRef: startupGate.startupGateVisible,
    sessionRestoreTried: parts.sessionRestoreTried,
    startupGateEnsureDbPath: startupGate.ensureStartupDbPath,
    runPostUnlockStartupTasks: startupGate.runPostUnlockStartupTasks,
    evaluateVaultGate: startupGate.evaluateVaultGate,
    checkVaultStatus: parts.checkVaultStatus,
    resetVaultBase: parts.resetVaultBase,
    restoreSessionRestoreState: parts.restoreSessionRestoreState,
    localConnected: parts.localConnected,
    localCwd: parts.localCwd,
    connectLocalTerminal: parts.connectLocalTerminal,
    sshForm: parts.sshForm,
    hostName: parts.hostName,
    authType: parts.authType,
    selectedKeyRef: parts.selectedKeyRef,
    connectSSH: parts.connectSSH,
    vaultUnlocked: parts.vaultUnlocked,
    vaultKeysLoaded: parts.vaultKeysLoaded,
    refreshVaultKeys: parts.refreshVaultKeys,
    cancelHostProbe: parts.cancelHostProbe,
    localFsLoaded: parts.localFsLoaded,
    loadLocalFs: parts.loadLocalFs,
    rightLocalFsLoaded: parts.rightLocalFsLoaded,
    rightPanelMode: parts.rightPanelMode,
    loadRightLocalFs: parts.loadRightLocalFs,
    snippetsLoaded: parts.snippetsLoaded,
    restoreSnippets: parts.restoreSnippets,
    serialPortsLoaded: parts.serialPortsLoaded,
    loadSerialPorts: parts.loadSerialPorts,
    updateStateLoaded: parts.updateStateLoaded,
    refreshUpdateState: parts.refreshUpdateState,
    refreshAuditLogs: parts.refreshAuditLogs,
    refreshStorageInfoRaw: storageManager.refreshStorageInfo,
    refreshStorageDataNowRaw: storageManager.refreshStorageDataNow,
    scheduleStorageDataRefreshRaw: storageManager.scheduleStorageDataRefresh,
    applyStoragePathRaw: storageManager.applyStoragePath,
    restoreDataBackupRaw: storageManager.restoreDataBackup,
    formatAppError: parts.formatAppError,
    clearSessionRestoreState: parts.clearSessionRestoreState,
    clearSshTabs: parts.clearSshTabs,
    loadTerminalEncoding: parts.loadTerminalEncoding,
    refreshBackupList: storageManager.refreshBackupList,
    runStartupSyncPull: syncManager.runStartupSyncPull,
  })

  watch(parts.nav, (value) => { void appStartupLifecycle.handleNavChange(value) })
  watch(startupGate.startupGateVisible, (visible) => {
    appStartupLifecycle.handleStartupGateVisibleChange(visible)
  })

  useWindowBridgeEvents({
    bootstrapStartupState: appStartupLifecycle.bootstrapStartupState,
    fitTerminal: parts.fitTerminal,
    getTerminalSize: parts.getTerminalSize,
    activeTerminalMode: parts.activeTerminalMode,
    sshConnected: parts.sshConnected,
    sshSessionId: parts.sshSessionId,
    syncLocalTerminalSize: parts.syncLocalTerminalSize,
    sftpUploadProgress: parts.sftpUploadProgress,
    sftpDownloadProgress: parts.sftpDownloadProgress,
    mergeUpdateState: parts.mergeUpdateState,
    mergeSyncStatus: syncManager.mergeSyncStatus,
    scheduleStorageDataRefresh: appStartupLifecycle.scheduleStorageDataRefresh,
    appendAuditLog: parts.appendAuditLog,
    hideAllMenus: parts.hideAllMenus,
    handleTerminalHotkeys: parts.handleTerminalHotkeys,
    cancelHostProbe: parts.cancelHostProbe,
    clearStorageDataRefreshTimer: storageManager.clearStorageDataRefreshTimer,
    disposeSerial: parts.disposeSerial,
    disconnectAllLocalTabs: parts.disconnectAllLocalTabs,
  })

  return {
    storageManager,
    syncManager,
    startupGate,
  }
}
