import type { Ref } from 'vue'

export function useSshTabActions(params: {
  sshTabs: Ref<any[]>
  sshSessionId: Ref<string>
  sshConnected: Ref<boolean>
  activeTerminalMode: Ref<'ssh' | 'serial' | 'local'>
  focusTerminal: Ref<boolean>
  nav: Ref<any>
  sshBufferBySession: Map<string, string>
  ensureSshBuffer: (sessionId: string) => void
  renderActiveSshBuffer: () => void
  clearSessionDecoders: (sessionId: string) => void
}) {
  const {
    sshTabs,
    sshSessionId,
    sshConnected,
    activeTerminalMode,
    focusTerminal,
    nav,
    sshBufferBySession,
    ensureSshBuffer,
    renderActiveSshBuffer,
    clearSessionDecoders,
  } = params

  const saveSshTabs = () => {
    try {
      const snapshot = sshTabs.value.map((tab) => ({ id: tab.id, name: tab.name }))
      localStorage.setItem('lightterm.sshTabs', JSON.stringify(snapshot))
    } catch {}
  }

  const buildSessionId = () => `ssh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

  const switchSshTab = (sessionId: string) => {
    const tab = sshTabs.value.find((item) => item.id === sessionId)
    if (!tab) return
    activeTerminalMode.value = 'ssh'
    sshSessionId.value = tab.id
    sshConnected.value = !!tab.connected
    ensureSshBuffer(tab.id)
    renderActiveSshBuffer()
  }

  const createSshTab = (name = '新会话') => {
    const id = buildSessionId()
    sshTabs.value = [...sshTabs.value, { id, name, connected: false }]
    ensureSshBuffer(id)
    sshSessionId.value = id
    sshConnected.value = false
    saveSshTabs()
    renderActiveSshBuffer()
    return id
  }

  const ensureActiveSshSession = (name = '新会话') => {
    if (sshSessionId.value && sshTabs.value.some((tab) => tab.id === sshSessionId.value)) return sshSessionId.value
    return createSshTab(name)
  }

  const closeSshTab = async (sessionId: string) => {
    const tabs = sshTabs.value
    const targetIndex = tabs.findIndex((item) => item.id === sessionId)
    if (targetIndex === -1) return

    await window.lightterm.sshDisconnect({ sessionId })
    clearSessionDecoders(sessionId)

    const nextTabs = tabs.filter((item) => item.id !== sessionId)
    sshBufferBySession.delete(sessionId)

    if (nextTabs.length === 0) {
      sshTabs.value = []
      sshBufferBySession.clear()
      sshSessionId.value = ''
      sshConnected.value = false
      focusTerminal.value = false
      nav.value = 'hosts'
      saveSshTabs()
      return
    }

    sshTabs.value = nextTabs
    const fallbackIndex = Math.max(0, targetIndex - 1)
    const nextActive = nextTabs[fallbackIndex] || nextTabs[0]
    if (!nextActive) return
    sshSessionId.value = nextActive.id
    sshConnected.value = !!nextActive.connected
    saveSshTabs()
    renderActiveSshBuffer()
  }

  const restoreSshTabs = () => {
    try {
      const raw = localStorage.getItem('lightterm.sshTabs')
      if (!raw) {
        sshTabs.value = []
        sshSessionId.value = ''
        sshConnected.value = false
        sshBufferBySession.clear()
        return
      }
      const parsed = JSON.parse(raw) as Array<{ id: string; name: string }>
      if (!Array.isArray(parsed) || parsed.length === 0) {
        sshTabs.value = []
        sshSessionId.value = ''
        sshConnected.value = false
        sshBufferBySession.clear()
        return
      }
      sshTabs.value = parsed.map((p) => ({ ...p, connected: false }))
      const first = sshTabs.value[0]
      sshSessionId.value = first?.id || ''
      sshConnected.value = false
      sshBufferBySession.clear()
      sshTabs.value.forEach((t) => sshBufferBySession.set(t.id, ''))
      ensureSshBuffer(sshSessionId.value)
    } catch {}
  }

  return {
    saveSshTabs,
    switchSshTab,
    createSshTab,
    ensureActiveSshSession,
    closeSshTab,
    restoreSshTabs,
  }
}
