import { computed } from 'vue'

export function buildAppShellChromeVms(parts: Record<string, any>) {
  const statusText = computed(() => {
    if (parts.focusTerminal.value) {
      if (parts.activeTerminalMode.value === 'local') return parts.localStatus.value || '本地终端就绪'
      if (parts.activeTerminalMode.value === 'serial') return parts.sshStatus.value || '串口终端就绪'
      return parts.sshStatus.value || 'SSH 终端就绪'
    }
    if (parts.nav.value === 'database') return parts.databaseStatus.value || '数据库工作台已就绪'
    if (parts.nav.value === 'snippets') return parts.snippetStatus.value || '代码片段已就绪'
    if (parts.nav.value === 'sftp') return parts.sftpStatus.value || 'SFTP 工作台已就绪'
    if (parts.nav.value === 'local') return parts.localStatus.value || '本地终端已就绪'
    if (parts.nav.value === 'logs') return parts.auditStatus.value || '操作日志已就绪'
    if (parts.nav.value === 'settings') return parts.syncRuntimeStatusText.value || '设置中心已就绪'
    if (parts.nav.value === 'vault') return parts.vaultStatus.value || '密钥库已就绪'
    return parts.sshStatus.value || '就绪'
  })

  const navCounts = computed(() => ({
    hosts: parts.hostItems?.value?.length ?? 0,
    sftp: parts.sshTabs?.value?.filter((item: any) => item.connected).length ?? 0,
    local: parts.localTabs?.value?.length ?? 0,
    database: parts.databaseMetrics?.value?.total ?? 0,
    serial: parts.serialConnected?.value ? 1 : 0,
    snippets: parts.snippetItems?.value?.length ?? 0,
    vault: parts.vaultItems?.value?.length ?? 0,
    settings: null,
    logs: parts.auditTargetGroups?.value?.length ?? 0,
  }))

  const versionLabel = computed(() => {
    const current = String(parts.updateInfo?.value?.currentVersion || '').trim()
    return current ? `v${current}` : 'v0.3.20'
  })

  return {
    sidebarVm: {
      nav: parts.nav,
      selectNav: parts.selectNav,
      navCounts,
      footerStatus: '所有服务运行正常',
      versionLabel,
    },
    textContextMenuVm: {
      textMenu: parts.textMenu,
      cutFromTextMenu: parts.cutFromTextMenu,
      copyFromTextMenu: parts.copyFromTextMenu,
      pasteFromTextMenu: parts.pasteFromTextMenu,
      selectAllFromTextMenu: parts.selectAllFromTextMenu,
    },
    statusBarVm: {
      statusText,
      statusBarMode: parts.statusBarMode,
      sftpUploadProgress: parts.sftpUploadProgress,
      sftpDownloadProgress: parts.sftpDownloadProgress,
      sshServerMetrics: parts.sshServerMetrics,
      sshServerMetricsLoading: parts.sshServerMetricsLoading,
      sshServerMetricsError: parts.sshServerMetricsError,
      activeSshTabName: parts.activeSshTabName,
      sshMetricChips: parts.sshMetricChips,
    },
    startupGateVm: {
      storageDbPath: parts.storageDbPath,
      vaultMaster: parts.vaultMaster,
      vaultStatus: parts.vaultStatus,
      plainVaultMessage: parts.plainVaultMessage,
      startupGateVisible: parts.startupGateVisible,
      startupGateMode: parts.startupGateMode,
      startupGateBusy: parts.startupGateBusy,
      startupGateError: parts.startupGateError,
      startupDbPath: parts.startupDbPath,
      startupMasterConfirm: parts.startupMasterConfirm,
      beginStartupInit: parts.beginStartupInit,
      pickStartupDbPath: parts.pickStartupDbPath,
      pickStartupDbSavePath: parts.pickStartupDbSavePath,
      pickStartupDbFolder: parts.pickStartupDbFolder,
      useCurrentDbPath: parts.useCurrentDbPath,
      runUseExistingStorage: parts.runUseExistingStorage,
      runStartupInit: parts.runStartupInit,
      runStartupUnlock: parts.runStartupUnlock,
    },
  }
}
