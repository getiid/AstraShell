import { nextTick } from 'vue'
import { useAuditManager } from '../composables/useAuditManager'
import { useDatabaseWorkspace } from '../composables/useDatabaseWorkspace'
import { useAppShellSupport } from '../composables/useAppShellSupport'
import { useHostWorkspace } from '../composables/useHostWorkspace'
import { useLocalTerminalManager } from '../composables/useLocalTerminalManager'
import { useSerialBaudSync } from '../composables/useSerialBaudSync'
import { useSerialManager } from '../composables/useSerialManager'
import { useSftpPanels } from '../composables/useSftpPanels'
import { useSftpViewState } from '../composables/useSftpViewState'
import { useSftpWorkspace } from '../composables/useSftpWorkspace'
import { useSshServerMetrics } from '../composables/useSshServerMetrics'
import { useSnippetManager } from '../composables/useSnippetManager'
import { useSshConnection } from '../composables/useSshConnection'
import { useTextContextMenu } from '../composables/useTextContextMenu'
import { useSshTabActions } from '../composables/useSshTabActions'
import { useTerminalRuntime } from '../composables/useTerminalRuntime'
import { useTerminalTabs } from '../composables/useTerminalTabs'
import { useUpdateManager } from '../composables/useUpdateManager'
import { useVaultManager } from '../composables/useVaultManager'
import { createAppShellNavigation } from './appShellNavigation'
import {
  ALL_CATEGORY,
  createAppShellControllerState,
  DEFAULT_CATEGORY,
  TERMINAL_ENCODING_STORAGE_KEY,
} from './appShellControllerState'
import { createAppShellTerminalRuntimeBridge } from './appShellTerminalRuntimeBridge'
import { useAppShellLifecycleServices } from './useAppShellLifecycleServices'
import { useAppShellViewModelBundle } from './useAppShellViewModelBundle'

export function useAppShellController() {
  const {
    nav,
    termEl,
    sshForm,
    quickConnectInput,
    authType,
    selectedKeyRef,
    sshStatus,
    sshSessionId,
    sshConnected,
    focusTerminal,
    activeTerminalMode,
    hostName,
    hostCategory,
    hostItems,
    selectedHostId,
    editingHost,
    editPasswordVisible,
    hostEditorVisible,
    extraCategories,
    localPath,
    localRows,
    selectedLocalFile,
    hostsLoaded,
    localFsLoaded,
    rightLocalFsLoaded,
    sessionRestoreTried,
  } = createAppShellControllerState()

  const terminalTabs = useTerminalTabs()
  const sftpPanels = useSftpPanels()
  const support = useAppShellSupport({ sshStatus })
  const updateManager = useUpdateManager()
  const auditManager = useAuditManager()
  const { bridge: terminalBridge, applyRuntime } = createAppShellTerminalRuntimeBridge()

  let connectSSH: (optionsOrEvent?: { keepNav?: boolean } | Event) => Promise<boolean> = async () => false
  let connectSSHFromHosts = async () => {}

  const localManager = useLocalTerminalManager({
    isWindowsClient: support.isWindowsClient,
    activeTerminalMode,
    focusTerminal,
    saveSessionRestoreState: support.saveSessionRestoreState,
    clearSessionRestoreState: support.clearSessionRestoreState,
    renderLocalSession: async (sessionId: string, options?: { announce?: string }) => {
      await nextTick()
      terminalBridge.initTerminal()
      terminalBridge.applyTerminalTheme()
      terminalBridge.resetTerminal()
      terminalBridge.writeTerminal(localManager.localBufferBySession.value[sessionId] || '')
      if (options?.announce) terminalBridge.writeTerminalLine(options.announce)
      terminalBridge.focusNativeTerminal()
      await terminalBridge.syncLocalTerminalSize()
    },
  })

  const serialManager = useSerialManager({
    sshStatus,
    activeTerminalMode,
    focusTerminal,
    prepareTerminal: async () => {
      await nextTick()
      terminalBridge.initTerminal()
      terminalBridge.applyTerminalTheme()
    },
    writeTerminalLine: terminalBridge.writeTerminalLine,
  })

  useSerialBaudSync({
    serialForm: serialManager.serialForm,
    serialBaudPreset: serialManager.serialBaudPreset,
    serialBaudRates: serialManager.serialBaudRates,
  })

  const sshTabActions = useSshTabActions({
    sshTabs: terminalTabs.sshTabs,
    sshSessionId,
    sshConnected,
    activeTerminalMode,
    focusTerminal,
    nav,
    sshBufferBySession: terminalTabs.sshBufferBySession,
    ensureSshBuffer: terminalTabs.ensureSshBuffer,
    renderActiveSshBuffer: () => terminalBridge.renderActiveSshBuffer(),
    clearSessionDecoders: (sessionId: string) => terminalBridge.clearSessionDecoders(sessionId),
    clearSessionRestoreState: support.clearSessionRestoreState,
  })

  const hostWorkspace = useHostWorkspace({
    hostItems,
    extraCategories,
    selectedHostId,
    sshForm,
    quickConnectInput,
    hostName,
    hostCategory,
    authType,
    selectedKeyRef,
    sshStatus,
    editingHost,
    editPasswordVisible,
    hostEditorVisible,
    hostsLoaded,
    defaultCategory: DEFAULT_CATEGORY,
    allCategory: ALL_CATEGORY,
    notify: support.notify,
    sshTabs: terminalTabs.sshTabs,
    switchSshTab: sshTabActions.switchSshTab,
    focusTerminal,
    createSshTab: sshTabActions.createSshTab,
    closeSshTab: sshTabActions.closeSshTab,
    connectSSH: (optionsOrEvent?: { keepNav?: boolean } | Event) => connectSSH(optionsOrEvent),
  })

  const sshConnection = useSshConnection({
    sshForm,
    selectedHostId,
    hostName,
    authType,
    selectedKeyRef,
    sshStatus,
    sshConnected,
    sshTabs: terminalTabs.sshTabs,
    activeTerminalMode,
    focusTerminal,
    nav,
    ensureActiveSshSession: sshTabActions.ensureActiveSshSession,
    saveSshTabs: sshTabActions.saveSshTabs,
    saveSessionRestoreState: support.saveSessionRestoreState,
    focusTerminalView: () => terminalBridge.focusNativeTerminal(),
    writeTerminalLine: (text: string) => terminalBridge.writeTerminalLine(text),
    syncQuickConnectForm: () => hostWorkspace.syncQuickConnectForm(),
    createSshTab: sshTabActions.createSshTab,
  })
  connectSSH = sshConnection.connectSSH
  connectSSHFromHosts = sshConnection.connectSSHFromHosts

  const snippetManager = useSnippetManager({
    hostItems,
    sshForm,
    sshConnected,
    sshSessionId,
    activeTerminalMode,
    serialConnected: serialManager.serialConnected,
    serialCurrentPath: serialManager.serialCurrentPath,
    localConnected: localManager.localConnected,
    activeLocalSessionId: localManager.activeLocalSessionId,
    recordLocalInput: localManager.recordLocalInput,
    useHost: hostWorkspace.useHost,
    connectSSH,
    focusTerminal: () => terminalBridge.focusNativeTerminal(),
  })

  const terminalRuntime = useTerminalRuntime({
    termEl,
    focusTerminal,
    activeTerminalMode,
    sshConnected,
    sshSessionId,
    sshTabs: terminalTabs.sshTabs,
    getSshBuffer: terminalTabs.getSshBuffer,
    appendSshBuffer: terminalTabs.appendSshBuffer,
    saveSshTabs: sshTabActions.saveSshTabs,
    clearSessionRestoreState: support.clearSessionRestoreState,
    serialConnected: serialManager.serialConnected,
    serialCurrentPath: serialManager.serialCurrentPath,
    pushSerialDialog: serialManager.pushSerialDialog,
    sshStatus,
    localConnected: localManager.localConnected,
    activeLocalSessionId: localManager.activeLocalSessionId,
    localStatus: localManager.localStatus,
    recordLocalInput: localManager.recordLocalInput,
    appendLocalData: localManager.appendLocalData,
    handleLocalClose: localManager.handleLocalClose,
    handleLocalError: localManager.handleLocalError,
    renderActiveLocalSession: async () => {
      if (!localManager.activeLocalSessionId.value) return
      await nextTick()
      terminalBridge.initTerminal()
      terminalBridge.applyTerminalTheme()
      terminalBridge.resetTerminal()
      terminalBridge.writeTerminal(localManager.localBufferBySession.value[localManager.activeLocalSessionId.value] || '')
    },
    snippetsLoaded: snippetManager.snippetsLoaded,
    restoreSnippets: snippetManager.restoreSnippets,
    terminalEncodingStorageKey: TERMINAL_ENCODING_STORAGE_KEY,
  })
  applyRuntime(terminalRuntime)

  const sftpViewState = useSftpViewState({
    hostItems,
    defaultCategory: DEFAULT_CATEGORY,
    allCategory: ALL_CATEGORY,
    leftPanelMode: sftpPanels.leftPanelMode,
    rightPanelMode: sftpPanels.rightPanelMode,
    localPath,
    localRows,
    leftSftpHostId: sftpPanels.leftSftpHostId,
    leftSftpRows: sftpPanels.leftSftpRows,
    rightLocalPath: sftpPanels.rightLocalPath,
    rightLocalRows: sftpPanels.rightLocalRows,
    sftpHostId: sftpPanels.sftpHostId,
    sftpRows: sftpPanels.sftpRows,
    leftFileKeyword: sftpPanels.leftFileKeyword,
    rightFileKeyword: sftpPanels.rightFileKeyword,
    leftConnectCategory: sftpPanels.leftConnectCategory,
    leftConnectKeyword: sftpPanels.leftConnectKeyword,
    rightConnectCategory: sftpPanels.rightConnectCategory,
    rightConnectKeyword: sftpPanels.rightConnectKeyword,
    localSortBy: sftpPanels.localSortBy,
    localSortDirection: sftpPanels.localSortDirection,
    remoteSortBy: sftpPanels.remoteSortBy,
    remoteSortDirection: sftpPanels.remoteSortDirection,
    isWindowsClient: support.isWindowsClient,
  })

  const sftpWorkspace = useSftpWorkspace({
    hostItems,
    isWindowsClient: support.isWindowsClient,
    localPath,
    localRows,
    localFsLoaded,
    rightLocalPath: sftpPanels.rightLocalPath,
    rightLocalRows: sftpPanels.rightLocalRows,
    rightLocalFsLoaded,
    selectedLocalFile,
    selectedLocalFiles: sftpPanels.selectedLocalFiles,
    selectedRemoteFiles: sftpPanels.selectedRemoteFiles,
    leftSelectedKeys: sftpPanels.leftSelectedKeys,
    rightSelectedKeys: sftpPanels.rightSelectedKeys,
    selectedRemoteFile: sftpPanels.selectedRemoteFile,
    sftpPath: sftpPanels.sftpPath,
    sftpRows: sftpPanels.sftpRows,
    sftpStatus: sftpPanels.sftpStatus,
    sftpHostId: sftpPanels.sftpHostId,
    sftpConnected: sftpPanels.sftpConnected,
    rightConnectPanelOpen: sftpPanels.rightConnectPanelOpen,
    rightConnectTarget: sftpPanels.rightConnectTarget,
    sftpDragLocalPath: sftpPanels.sftpDragLocalPath,
    sftpDragRemoteFile: sftpPanels.sftpDragRemoteFile,
    sftpUploadProgress: sftpPanels.sftpUploadProgress,
    sftpDownloadProgress: sftpPanels.sftpDownloadProgress,
    sftpNewDirName: sftpPanels.sftpNewDirName,
    sftpRenameTo: sftpPanels.sftpRenameTo,
    remoteMenu: sftpPanels.remoteMenu,
    leftPanelMode: sftpPanels.leftPanelMode,
    leftConnectPanelOpen: sftpPanels.leftConnectPanelOpen,
    leftConnectTarget: sftpPanels.leftConnectTarget,
    leftConnectCategory: sftpPanels.leftConnectCategory,
    leftConnectKeyword: sftpPanels.leftConnectKeyword,
    leftSftpHostId: sftpPanels.leftSftpHostId,
    leftSftpPath: sftpPanels.leftSftpPath,
    leftSftpRows: sftpPanels.leftSftpRows,
    rightPanelMode: sftpPanels.rightPanelMode,
    rightConnectCategory: sftpPanels.rightConnectCategory,
    rightConnectKeyword: sftpPanels.rightConnectKeyword,
    getLocalParentPath: support.getLocalParentPath,
    allCategory: ALL_CATEGORY,
  })

  const textContextMenu = useTextContextMenu({
    sshStatus,
    hideRemoteMenu: sftpWorkspace.hideRemoteMenu,
    readClipboardText: terminalBridge.readClipboardText,
    copyTerminalSelection: terminalBridge.copyTerminalSelection,
    pasteToTerminal: terminalBridge.pasteToTerminal,
    selectAllTerminal: terminalBridge.selectAllTerminal,
  })

  const navigation = createAppShellNavigation({
    nav,
    focusTerminal,
    activeTerminalMode,
    sshStatus,
    localStatus: localManager.localStatus,
    localTabs: localManager.localTabs,
    termEl,
  })

  const databaseWorkspace = useDatabaseWorkspace({
    openSnippetsPanel: navigation.openSnippetsPanel,
    snippetItems: snippetManager.snippetItems,
  })
  const vaultManager = useVaultManager({ formatAppError: support.formatAppError })

  const { storageManager, syncManager, startupGate } = useAppShellLifecycleServices({
    formatAppError: support.formatAppError,
    nav,
    snippetsLoaded: snippetManager.snippetsLoaded,
    restoreSnippets: snippetManager.restoreSnippets,
    vaultUnlocked: vaultManager.vaultUnlocked,
    vaultKeysLoaded: vaultManager.vaultKeysLoaded,
    refreshVaultKeys: vaultManager.refreshVaultKeys,
    checkVaultStatus: vaultManager.checkVault,
    refreshHosts: async () => hostWorkspace.refreshHosts(),
    vaultMaster: vaultManager.vaultMaster,
    vaultStatus: vaultManager.vaultStatus,
    vaultInitialized: vaultManager.vaultInitialized,
    vaultRequiresPassword: vaultManager.vaultRequiresPassword,
    initVault: vaultManager.initVault,
    unlockVault: vaultManager.unlockVault,
    refreshUpdateState: updateManager.refreshUpdateState,
    snippetStatus: snippetManager.snippetStatus,
    sessionRestoreTried,
    resetVaultBase: vaultManager.resetVault,
    restoreSessionRestoreState: support.restoreSessionRestoreState,
    localConnected: localManager.localConnected,
    localCwd: localManager.localCwd,
    connectLocalTerminal: localManager.connectLocalTerminal,
    sshForm,
    hostName,
    authType,
    selectedKeyRef,
    connectSSH,
    cancelHostProbe: hostWorkspace.cancelHostProbe,
    localFsLoaded,
    loadLocalFs: sftpWorkspace.loadLocalFs,
    rightLocalFsLoaded,
    rightPanelMode: sftpPanels.rightPanelMode,
    loadRightLocalFs: sftpWorkspace.loadRightLocalFs,
    serialPortsLoaded: serialManager.serialPortsLoaded,
    loadSerialPorts: serialManager.loadSerialPorts,
    updateStateLoaded: updateManager.updateStateLoaded,
    refreshAuditLogs: auditManager.refreshAuditLogs,
    clearSessionRestoreState: support.clearSessionRestoreState,
    clearSshTabs: sshTabActions.clearSshTabs,
    loadTerminalEncoding: terminalBridge.loadTerminalEncoding,
    activeTerminalMode,
    sshConnected,
    sshSessionId,
    fitTerminal: terminalBridge.fitTerminal,
    getTerminalSize: terminalBridge.getTerminalSize,
    syncLocalTerminalSize: terminalBridge.syncLocalTerminalSize,
    sftpUploadProgress: sftpPanels.sftpUploadProgress,
    sftpDownloadProgress: sftpPanels.sftpDownloadProgress,
    mergeUpdateState: updateManager.mergeUpdateState,
    appendAuditLog: auditManager.appendAuditLog,
    hideAllMenus: textContextMenu.hideAllMenus,
    handleTerminalHotkeys: terminalBridge.handleTerminalHotkeys,
    disposeSerial: serialManager.disposeSerial,
    disconnectAllLocalTabs: localManager.disconnectAllLocalTabs,
  })

  const sshMetrics = useSshServerMetrics({
    nav,
    focusTerminal,
    activeTerminalMode,
    sshConnected,
    sshSessionId,
    sshTabs: terminalTabs.sshTabs,
  })
  const viewModels = useAppShellViewModelBundle({
    nav,
    sshStatus,
    focusTerminal,
    allCategory: ALL_CATEGORY,
    defaultCategory: DEFAULT_CATEGORY,
    quickConnectInput,
    connectSSHFromHosts,
    terminalModeLabel: terminalBridge.terminalModeLabel,
    terminalTargetLabel: terminalBridge.terminalTargetLabel,
    activeTerminalMode,
    terminalTabs,
    sshTabActions,
    sshSessionId,
    terminalEncoding: terminalBridge.terminalEncoding,
    selectedHostId,
    editingHost,
    hostEditorVisible,
    editPasswordVisible,
    hostItems,
    hostWorkspace,
    sftpPanels,
    sftpViewState,
    sftpWorkspace,
    snippetManager,
    auditManager,
    databaseWorkspace,
    serialManager,
    localManager,
    navigation,
    updateManager,
    storageManager,
    syncManager,
    vaultManager,
    textContextMenu,
    sshMetrics,
    isWindowsClient: support.isWindowsClient,
    localPath,
    selectedLocalFile,
    selectAllTerminal: terminalBridge.selectAllTerminal,
    copyTerminalSelection: terminalBridge.copyTerminalSelection,
    pasteToTerminal: terminalBridge.pasteToTerminal,
    plainVaultMessage: support.plainVaultMessage,
    startupGate,
    closeSshTab: sshTabActions.closeSshTab,
  })

  return {
    nav,
    focusTerminal,
    ...viewModels,
  }
}
