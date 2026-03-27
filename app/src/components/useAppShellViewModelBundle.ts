import { buildAppShellChromeVms } from './appShellChromeVms'
import { buildAppShellManagementVms } from './appShellManagementVms'
import { buildTerminalWorkspaceVm } from './appShellTerminalVm'
import { buildAppShellWorkspaceVms } from './appShellWorkspaceVms'

export function useAppShellViewModelBundle(parts: Record<string, any>) {
  const handleSshTabClose = (sessionId: string) => {
    parts.sshStatus.value = '正在关闭 SSH 标签...'
    void parts.closeSshTab(sessionId).then(() => {
      parts.sshStatus.value = parts.focusTerminal.value ? 'SSH 标签已关闭' : '已关闭最后一个 SSH 标签，返回主机列表'
    })
  }

  const workspaceVms = buildAppShellWorkspaceVms({
    allCategory: parts.allCategory,
    hostCategories: parts.hostWorkspace.hostCategories,
    ...parts.sftpPanels,
    ...parts.sftpViewState,
    ...parts.sftpWorkspace,
    ...parts.snippetManager,
    ...parts.auditManager,
    ...parts.databaseWorkspace,
    ...parts.serialManager,
    focusTerminal: parts.focusTerminal,
    isWindowsClient: parts.isWindowsClient,
    ...parts.localManager,
    openSnippetsPanel: parts.navigation.openSnippetsPanel,
    localPath: parts.localPath,
    selectedLocalFile: parts.selectedLocalFile,
    hostItems: parts.hostItems,
  })

  const managementVms = buildAppShellManagementVms({
    defaultCategory: parts.defaultCategory,
    allCategory: parts.allCategory,
    quickConnectInput: parts.quickConnectInput,
    connectSSHFromHosts: parts.connectSSHFromHosts,
    ...parts.hostWorkspace,
    hostItems: parts.hostItems,
    selectedHostId: parts.selectedHostId,
    editingHost: parts.editingHost,
    hostEditorVisible: parts.hostEditorVisible,
    editPasswordVisible: parts.editPasswordVisible,
    vaultItems: parts.vaultManager.vaultItems,
    ...parts.updateManager,
    ...parts.storageManager,
    ...parts.syncManager,
    ...parts.vaultManager,
  })

  const terminalWorkspaceVm = buildTerminalWorkspaceVm({
    focusTerminal: parts.focusTerminal,
    terminalModeLabel: parts.terminalModeLabel,
    terminalTargetLabel: parts.terminalTargetLabel,
    activeTerminalMode: parts.activeTerminalMode,
    sshTabs: parts.terminalTabs.sshTabs,
    sshSessionId: parts.sshSessionId,
    localTabs: parts.localManager.localTabs,
    activeLocalTabId: parts.localManager.activeLocalTabId,
    selectedLocalTabId: parts.localManager.selectedLocalTabId,
    terminalEncoding: parts.terminalEncoding,
    terminalSnippetId: parts.snippetManager.terminalSnippetId,
    terminalSnippetCategory: parts.snippetManager.terminalSnippetCategory,
    terminalSnippetCategories: parts.snippetManager.terminalSnippetCategories,
    terminalSnippetItems: parts.snippetManager.terminalSnippetItems,
    snippetRunning: parts.snippetManager.snippetRunning,
    snippetKeyword: parts.snippetManager.snippetKeyword,
    switchSshTab: parts.sshTabActions.switchSshTab,
    createSshTab: parts.sshTabActions.createSshTab,
    handleSshTabClose,
    selectLocalTab: parts.localManager.selectLocalTab,
    switchLocalTab: parts.localManager.switchLocalTab,
    closeLocalTab: parts.localManager.closeLocalTab,
    connectLocalTerminal: parts.localManager.connectLocalTerminal,
    selectAllTerminal: parts.selectAllTerminal,
    copyTerminalSelection: parts.copyTerminalSelection,
    pasteToTerminal: parts.pasteToTerminal,
    disconnectLocalTerminal: parts.localManager.disconnectLocalTerminal,
    runTerminalSnippet: parts.snippetManager.runTerminalSnippet,
    sendSnippetRawToTerminal: parts.snippetManager.sendSnippetRawToTerminal,
    closeSerial: parts.serialManager.closeSerial,
    openTerminalContextMenu: parts.textContextMenu.openTerminalContextMenu,
    snippetCommandLines: parts.snippetManager.snippetCommandLines,
    bindTermEl: parts.navigation.bindTermEl,
    exitTerminalView: parts.navigation.exitTerminalView,
    openSnippetsPanel: parts.navigation.openSnippetsPanel,
    openSshConnectionChooser: parts.navigation.openSshConnectionChooser,
    openLocalTerminalChooser: parts.navigation.openLocalTerminalChooser,
  })

  const chromeVms = buildAppShellChromeVms({
    nav: parts.nav,
    focusTerminal: parts.focusTerminal,
    activeTerminalMode: parts.activeTerminalMode,
    localStatus: parts.localManager.localStatus,
    sshStatus: parts.sshStatus,
    databaseStatus: parts.databaseWorkspace.databaseStatus,
    snippetStatus: parts.snippetManager.snippetStatus,
    sftpStatus: parts.sftpPanels.sftpStatus,
    auditStatus: parts.auditManager.auditStatus,
    syncRuntimeStatusText: parts.syncManager.syncRuntimeStatusText,
    vaultStatus: parts.vaultManager.vaultStatus,
    selectNav: parts.navigation.selectNav,
    textMenu: parts.textContextMenu.textMenu,
    cutFromTextMenu: parts.textContextMenu.cutFromTextMenu,
    copyFromTextMenu: parts.textContextMenu.copyFromTextMenu,
    pasteFromTextMenu: parts.textContextMenu.pasteFromTextMenu,
    selectAllFromTextMenu: parts.textContextMenu.selectAllFromTextMenu,
    statusBarMode: parts.sshMetrics.statusBarMode,
    sftpUploadProgress: parts.sftpPanels.sftpUploadProgress,
    sftpDownloadProgress: parts.sftpPanels.sftpDownloadProgress,
    sshServerMetrics: parts.sshMetrics.metrics,
    sshServerMetricsLoading: parts.sshMetrics.metricsLoading,
    sshServerMetricsError: parts.sshMetrics.metricsError,
    activeSshTabName: parts.sshMetrics.activeSshTabName,
    sshMetricChips: parts.sshMetrics.metricChips,
    storageDbPath: parts.storageManager.storageDbPath,
    vaultMaster: parts.vaultManager.vaultMaster,
    plainVaultMessage: parts.plainVaultMessage,
    startupGateVisible: parts.startupGate.startupGateVisible,
    startupGateMode: parts.startupGate.startupGateMode,
    startupGateBusy: parts.startupGate.startupGateBusy,
    startupGateError: parts.startupGate.startupGateError,
    startupDbPath: parts.startupGate.startupDbPath,
    startupMasterConfirm: parts.startupGate.startupMasterConfirm,
    beginStartupInit: parts.startupGate.beginStartupInit,
    pickStartupDbPath: parts.startupGate.pickStartupDbPath,
    pickStartupDbSavePath: parts.startupGate.pickStartupDbSavePath,
    pickStartupDbFolder: parts.startupGate.pickStartupDbFolder,
    useCurrentDbPath: parts.startupGate.useCurrentDbPath,
    runUseExistingStorage: parts.startupGate.runUseExistingStorage,
    runStartupInit: parts.startupGate.runStartupInit,
    runStartupUnlock: parts.startupGate.runStartupUnlock,
  })

  return {
    terminalWorkspaceVm,
    ...workspaceVms,
    ...managementVms,
    ...chromeVms,
  }
}
