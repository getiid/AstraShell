import { onBeforeUnmount, onMounted, type Ref } from 'vue'

type TerminalMode = 'ssh' | 'serial' | 'local'

export function useWindowBridgeEvents(params: {
  bootstrapStartupState: () => Promise<void>
  fitTerminal: () => void
  getTerminalSize: () => { cols: number; rows: number }
  activeTerminalMode: Ref<TerminalMode>
  sshConnected: Ref<boolean>
  sshSessionId: Ref<string>
  syncLocalTerminalSize: () => Promise<void>
  sftpUploadProgress: Ref<number>
  sftpDownloadProgress: Ref<number>
  mergeUpdateState: (payload: any) => void
  scheduleStorageDataRefresh: () => void
  appendAuditLog: (item: any) => void
  hideAllMenus: () => void
  handleTerminalHotkeys: (event: KeyboardEvent) => void
  cancelHostProbe: () => void
  clearStorageDataRefreshTimer: () => void
  disposeSerial: () => Promise<void>
  disconnectAllLocalTabs: () => Promise<void>
}) {
  const {
    bootstrapStartupState,
    fitTerminal,
    getTerminalSize,
    activeTerminalMode,
    sshConnected,
    sshSessionId,
    syncLocalTerminalSize,
    sftpUploadProgress,
    sftpDownloadProgress,
    mergeUpdateState,
    scheduleStorageDataRefresh,
    appendAuditLog,
    hideAllMenus,
    handleTerminalHotkeys,
    cancelHostProbe,
    clearStorageDataRefreshTimer,
    disposeSerial,
    disconnectAllLocalTabs,
  } = params

  const handleResize = () => {
    fitTerminal()
    const { cols, rows } = getTerminalSize()
    if (activeTerminalMode.value === 'ssh' && sshConnected.value && cols > 0 && rows > 0) {
      window.lightterm.sshResize({ sessionId: sshSessionId.value, cols, rows })
      return
    }
    if (activeTerminalMode.value === 'local') {
      void syncLocalTerminalSize()
    }
  }

  onMounted(async () => {
    await bootstrapStartupState()

    window.addEventListener('resize', handleResize)
    window.lightterm.onSftpProgress((payload) => {
      if (payload.type === 'upload') sftpUploadProgress.value = payload.percent
      if (payload.type === 'download') sftpDownloadProgress.value = payload.percent
    })
    window.lightterm.onUpdateStatus((payload) => mergeUpdateState(payload))
    window.lightterm.onStorageDataChanged(() => scheduleStorageDataRefresh())
    window.lightterm.onAuditAppended((item) => appendAuditLog(item))
    window.addEventListener('click', hideAllMenus)
    window.addEventListener('keydown', handleTerminalHotkeys, true)
  })

  onBeforeUnmount(() => {
    cancelHostProbe()
    clearStorageDataRefreshTimer()
    void disposeSerial()
    void disconnectAllLocalTabs()
    window.removeEventListener('resize', handleResize)
    window.removeEventListener('keydown', handleTerminalHotkeys, true)
    window.removeEventListener('click', hideAllMenus)
  })
}
