import type { Ref } from 'vue'

type TerminalMode = 'ssh' | 'serial' | 'local'

type UseSshConnectionParams = {
  sshForm: Ref<{ host: string; port: number; username: string; password: string }>
  hostName: Ref<string>
  authType: Ref<'password' | 'key'>
  selectedKeyRef: Ref<string>
  sshStatus: Ref<string>
  sshConnected: Ref<boolean>
  sshTabs: Ref<Array<{ id: string; name: string; connected: boolean }>>
  activeTerminalMode: Ref<TerminalMode>
  focusTerminal: Ref<boolean>
  nav: Ref<any>
  ensureActiveSshSession: (name?: string) => string
  saveSshTabs: () => void
  saveSessionRestoreState: (payload: any) => void
  focusTerminalView: () => void
  writeTerminalLine: (text: string) => void
  syncQuickConnectForm: () => boolean
  createSshTab: (name?: string) => string
}

export function useSshConnection(params: UseSshConnectionParams) {
  const {
    sshForm,
    hostName,
    authType,
    selectedKeyRef,
    sshStatus,
    sshConnected,
    sshTabs,
    activeTerminalMode,
    focusTerminal,
    nav,
    ensureActiveSshSession,
    saveSshTabs,
    saveSessionRestoreState,
    focusTerminalView,
    writeTerminalLine,
    syncQuickConnectForm,
    createSshTab,
  } = params

  const connectSSH = async (optionsOrEvent?: { keepNav?: boolean } | Event) => {
    const keepNav = typeof optionsOrEvent === 'object' && optionsOrEvent !== null && 'keepNav' in optionsOrEvent
      ? !!optionsOrEvent.keepNav
      : false
    const sessionLabel = (hostName.value || sshForm.value.host || '新会话').trim() || '新会话'
    const sessionId = ensureActiveSshSession(sessionLabel)
    let privateKey = ''
    if (authType.value === 'key') {
      if (!selectedKeyRef.value) {
        sshStatus.value = '请先选择密钥'
        return false
      }
      const keyRes = await window.lightterm.vaultKeyGet({ id: selectedKeyRef.value })
      if (!keyRes.ok) {
        sshStatus.value = `读取密钥失败：${keyRes.error}`
        return false
      }
      privateKey = keyRes.item?.privateKey || ''
    }

    const res = await window.lightterm.sshConnect({
      ...sshForm.value,
      password: authType.value === 'password' ? sshForm.value.password : undefined,
      privateKey: authType.value === 'key' ? privateKey : undefined,
      displayName: sessionLabel,
      sessionId,
    })
    sshConnected.value = !!res.ok
    const tab = sshTabs.value.find((item) => item.id === sessionId)
    if (tab) {
      tab.connected = !!res.ok
      if (res.ok) {
        const label = (hostName.value || sshForm.value.host || tab.name || '会话').trim()
        tab.name = label
      }
    }
    saveSshTabs()
    sshStatus.value = res.ok ? 'SSH 交互会话已连接' : `SSH 连接失败：${res.error}`
    if (res.ok) {
      activeTerminalMode.value = 'ssh'
      writeTerminalLine('\r\n[SSH 已连接，可直接输入命令]')
      focusTerminal.value = true
      saveSessionRestoreState({
        type: 'ssh',
        host: sshForm.value.host,
        port: sshForm.value.port,
        username: sshForm.value.username,
        authType: authType.value,
        keyRef: selectedKeyRef.value || '',
        hostName: hostName.value || sessionLabel,
        targetTabId: sessionId,
      })
      focusTerminalView()
      if (!keepNav) nav.value = 'hosts'
    }
    return !!res.ok
  }

  const connectSSHFromHosts = async () => {
    if (!syncQuickConnectForm()) return
    if (sshConnected.value) {
      const label = (hostName.value || sshForm.value.host || '新会话').trim()
      createSshTab(label)
    }
    await connectSSH()
  }

  return {
    connectSSH,
    connectSSHFromHosts,
  }
}
