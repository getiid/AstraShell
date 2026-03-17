import { ref } from 'vue'

type SshTab = { id: string; name: string; connected: boolean }

export function useTerminalTabs() {
  const sshTabs = ref<SshTab[]>([])
  const sshBufferBySession = new Map<string, string>()
  const SSH_BUFFER_MAX_CHARS = 240000

  const ensureSshBuffer = (sessionId: string) => {
    if (!sessionId) return
    if (sshBufferBySession.has(sessionId)) return
    sshBufferBySession.set(sessionId, '')
  }

  const getSshBuffer = (sessionId: string) => sshBufferBySession.get(sessionId) || ''

  const appendSshBuffer = (sessionId: string, text: string) => {
    if (!sessionId || !text) return
    const prev = sshBufferBySession.get(sessionId) || ''
    const merged = (prev + text).slice(-SSH_BUFFER_MAX_CHARS)
    sshBufferBySession.set(sessionId, merged)
  }

  const clearSshBuffer = (sessionId: string) => {
    if (!sessionId) return
    sshBufferBySession.delete(sessionId)
  }

  const clearAllSshBuffer = () => sshBufferBySession.clear()

  return {
    sshTabs,
    sshBufferBySession,
    SSH_BUFFER_MAX_CHARS,
    ensureSshBuffer,
    getSshBuffer,
    appendSshBuffer,
    clearSshBuffer,
    clearAllSshBuffer,
  }
}
