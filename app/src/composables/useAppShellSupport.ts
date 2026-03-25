import { computed, type Ref } from 'vue'

export function useAppShellSupport(params: {
  sshStatus: Ref<string>
}) {
  const {
    sshStatus,
  } = params

  const notify = (ok: boolean, message: string) => {
    if (ok) {
      sshStatus.value = `✅ ${message}`
      window.alert(`✅ ${message}`)
      return
    }
    sshStatus.value = `❌ ${message}`
    window.alert(`❌ ${message}`)
  }

  const isWindowsClient = computed(() => {
    if (typeof navigator === 'undefined') return false
    return /win/i.test(navigator.platform || '')
  })

  const getLocalParentPath = (rawPath: string) => {
    const source = String(rawPath || '').trim()
    if (!source) return ''

    const normalized = source.replace(/\\/g, '/').replace(/\/+$/, '')
    const isWindowsDrivePath = /^[a-zA-Z]:/.test(normalized)

    if (isWindowsDrivePath) {
      if (/^[a-zA-Z]:$/.test(normalized)) return ''
      const lastSlash = normalized.lastIndexOf('/')
      if (lastSlash <= 2) return ''
      return normalized.slice(0, lastSlash)
    }

    if (normalized === '/') return '/'
    const lastSlash = normalized.lastIndexOf('/')
    if (lastSlash < 0) return ''
    if (lastSlash === 0) return '/'
    return normalized.slice(0, lastSlash)
  }

  const saveSessionRestoreState = (payload: any) => {
    try { localStorage.setItem('astrashell.session.restore.v1', JSON.stringify(payload || {})) } catch {}
  }

  const clearSessionRestoreState = () => {
    try { localStorage.removeItem('astrashell.session.restore.v1') } catch {}
  }

  const restoreSessionRestoreState = () => {
    try {
      const raw = localStorage.getItem('astrashell.session.restore.v1')
      if (!raw) return null
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  const formatAppError = (error: unknown) => {
    if (error instanceof Error) return error.message || String(error)
    return String(error || '未知错误')
  }

  const plainVaultMessage = (message: string) => String(message || '').replace(/^[✅❌]\s*/, '').trim()

  return {
    notify,
    isWindowsClient,
    getLocalParentPath,
    saveSessionRestoreState,
    clearSessionRestoreState,
    restoreSessionRestoreState,
    formatAppError,
    plainVaultMessage,
  }
}
