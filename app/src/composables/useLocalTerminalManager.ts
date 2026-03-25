import { computed, ref, type Ref } from 'vue'

type TerminalMode = 'ssh' | 'serial' | 'local'

type LocalTabItem = {
  id: string
  sessionId: string
  name: string
  cwd: string
  connected: boolean
  status: string
}

type UseLocalTerminalManagerParams = {
  isWindowsClient: Readonly<Ref<boolean>>
  activeTerminalMode: Ref<TerminalMode>
  focusTerminal: Ref<boolean>
  saveSessionRestoreState: (payload: any) => void
  clearSessionRestoreState: () => void
  renderLocalSession: (sessionId: string, options?: { announce?: string }) => Promise<void>
}

export function useLocalTerminalManager(params: UseLocalTerminalManagerParams) {
  const {
    isWindowsClient,
    activeTerminalMode,
    focusTerminal,
    saveSessionRestoreState,
    clearSessionRestoreState,
    renderLocalSession,
  } = params

  const localTabs = ref<LocalTabItem[]>([])
  const activeLocalTabId = ref('')
  const localBufferBySession = ref<Record<string, string>>({})
  const localCwd = ref('')
  const localStatus = ref('未连接')
  const localShellType = ref<'auto' | 'cmd' | 'powershell'>('auto')
  const localElevated = ref(false)

  const activeLocalTab = computed(() => localTabs.value.find((tab) => tab.id === activeLocalTabId.value) || null)
  const activeLocalSessionId = computed(() => activeLocalTab.value?.sessionId || '')
  const localConnected = computed(() => !!activeLocalTab.value?.connected)

  const createLocalSessionId = () => `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const createLocalTabId = () => `ltab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

  const localSessionLabel = (cwd: string, idx: number) => {
    const normalized = String(cwd || '').trim()
    const tail = normalized.split(/[\\/]/).filter(Boolean).pop() || '~'
    return `${tail} · ${idx}`
  }

  const switchLocalTab = async (tabId: string) => {
    const tab = localTabs.value.find((item) => item.id === tabId)
    if (!tab) return
    activeLocalTabId.value = tab.id
    localStatus.value = tab.status || (tab.connected ? '已连接' : '未连接')
    localCwd.value = tab.cwd || localCwd.value
    activeTerminalMode.value = 'local'
    if (focusTerminal.value) {
      await renderLocalSession(tab.sessionId)
    }
  }

  const connectLocalTerminal = async () => {
    const sessionId = createLocalSessionId()
    const tabId = createLocalTabId()
    const tabIndex = localTabs.value.length + 1
    const res = await window.lightterm.localConnect({
      sessionId,
      cwd: localCwd.value.trim() || undefined,
      cols: 120,
      rows: 30,
      shellType: localShellType.value,
      elevated: !!(isWindowsClient.value && localElevated.value),
    })
    if (!res.ok) {
      localStatus.value = `连接失败：${res.error || '未知错误'}`
      return
    }

    const finalCwd = String(res.cwd || localCwd.value || '~')
    const warningText = String((res as any)?.warning || '').trim()
    const tab: LocalTabItem = {
      id: tabId,
      sessionId,
      name: localSessionLabel(finalCwd, tabIndex),
      cwd: finalCwd,
      connected: true,
      status: `${res.shell || 'shell'} @ ${finalCwd}`,
    }
    localTabs.value.push(tab)
    localBufferBySession.value[sessionId] = ''
    await switchLocalTab(tabId)

    activeTerminalMode.value = 'local'
    focusTerminal.value = true
    saveSessionRestoreState({ type: 'local', cwd: finalCwd })
    localStatus.value = warningText ? `${tab.status} ｜ ⚠ ${warningText}` : tab.status
    localCwd.value = finalCwd
    await renderLocalSession(sessionId, { announce: `[本地终端已连接] ${tab.status}` })
  }

  const closeLocalTab = async (tabId: string) => {
    const tab = localTabs.value.find((item) => item.id === tabId)
    if (!tab) return
    if (tab.connected && tab.sessionId) {
      await window.lightterm.localDisconnect({ sessionId: tab.sessionId })
    }
    localTabs.value = localTabs.value.filter((item) => item.id !== tabId)
    delete localBufferBySession.value[tab.sessionId]

    if (!localTabs.value.length) {
      activeLocalTabId.value = ''
      localStatus.value = '已断开'
      clearSessionRestoreState()
      if (activeTerminalMode.value === 'local') focusTerminal.value = false
      return
    }

    if (activeLocalTabId.value === tabId) {
      const fallback = localTabs.value[localTabs.value.length - 1]
      if (fallback) await switchLocalTab(fallback.id)
    }
  }

  const disconnectLocalTerminal = async () => {
    if (!activeLocalTabId.value) return
    await closeLocalTab(activeLocalTabId.value)
  }

  const runLocalQuickCommand = async (cmd: string) => {
    const text = String(cmd || '').trim()
    if (!localConnected.value || !activeLocalSessionId.value) {
      localStatus.value = '请先连接本地终端'
      return
    }
    if (!text) return
    const res = await window.lightterm.localWrite({ sessionId: activeLocalSessionId.value, data: `${text}\n` })
    if (!res.ok) {
      localStatus.value = `发送失败：${res.error || '未知错误'}`
      return
    }
    activeTerminalMode.value = 'local'
    focusTerminal.value = true
    await renderLocalSession(activeLocalSessionId.value)
  }

  const appendLocalData = (sessionId: string, text: string) => {
    localBufferBySession.value[sessionId] = `${localBufferBySession.value[sessionId] || ''}${text}`
  }

  const handleLocalClose = (sessionId: string, code: number) => {
    const tab = localTabs.value.find((item) => item.sessionId === sessionId)
    if (!tab) return
    tab.connected = false
    tab.status = `本地终端已断开（code=${code}）`
    if (sessionId === activeLocalSessionId.value) {
      localStatus.value = tab.status
    }
  }

  const handleLocalError = (sessionId: string, error: string) => {
    const tab = localTabs.value.find((item) => item.sessionId === sessionId)
    if (!tab) return
    tab.status = `本地终端错误：${error || '未知错误'}`
    if (sessionId === activeLocalSessionId.value) {
      localStatus.value = tab.status
    }
  }

  const disconnectAllLocalTabs = async () => {
    for (const tab of localTabs.value) {
      if (tab.connected && tab.sessionId) {
        await window.lightterm.localDisconnect({ sessionId: tab.sessionId })
      }
    }
  }

  return {
    localTabs,
    activeLocalTabId,
    localBufferBySession,
    localCwd,
    localStatus,
    localShellType,
    localElevated,
    activeLocalTab,
    activeLocalSessionId,
    localConnected,
    switchLocalTab,
    connectLocalTerminal,
    closeLocalTab,
    disconnectLocalTerminal,
    runLocalQuickCommand,
    appendLocalData,
    handleLocalClose,
    handleLocalError,
    disconnectAllLocalTabs,
  }
}
