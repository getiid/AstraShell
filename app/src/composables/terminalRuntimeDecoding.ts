import { ref, watch } from 'vue'
import type { TerminalEncoding } from './terminalRuntimeTypes'

export function createTerminalRuntimeDecoding(terminalEncodingStorageKey: string) {
  const terminalEncoding = ref<TerminalEncoding>('utf-8')
  const terminalDecoders = new Map<string, TextDecoder>()

  const normalizeTerminalEncoding = (value: unknown): TerminalEncoding => (
    value === 'gb18030' ? 'gb18030' : 'utf-8'
  )

  const loadTerminalEncoding = () => {
    try {
      terminalEncoding.value = normalizeTerminalEncoding(localStorage.getItem(terminalEncodingStorageKey))
    } catch {
      terminalEncoding.value = 'utf-8'
    }
  }

  watch(terminalEncoding, (value) => {
    terminalDecoders.clear()
    try { localStorage.setItem(terminalEncodingStorageKey, value) } catch {}
  })

  const decoderCacheKey = (sessionId: string) => `${sessionId}::${terminalEncoding.value}`

  const getTerminalDecoder = (sessionId: string) => {
    const key = decoderCacheKey(sessionId)
    const existing = terminalDecoders.get(key)
    if (existing) return existing
    const decoder = new TextDecoder(terminalEncoding.value)
    terminalDecoders.set(key, decoder)
    return decoder
  }

  const clearSessionDecoders = (sessionId: string) => {
    if (!sessionId) return
    const prefixes = [`${sessionId}::`]
    Array.from(terminalDecoders.keys()).forEach((key) => {
      if (prefixes.some((prefix) => key.startsWith(prefix))) terminalDecoders.delete(key)
    })
  }

  const decodeBase64Bytes = (base64: string) => {
    try {
      const raw = atob(base64)
      const bytes = new Uint8Array(raw.length)
      for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
      return bytes
    } catch {
      return null
    }
  }

  const decodeSshPayload = (msg: { sessionId?: string; data?: string; dataBase64?: string }) => {
    const sessionId = String(msg?.sessionId || '')
    const rawText = String(msg?.data || '')
    const base64 = String(msg?.dataBase64 || '')
    if (!sessionId || !base64) return rawText
    const bytes = decodeBase64Bytes(base64)
    if (!bytes) return rawText
    try {
      return getTerminalDecoder(sessionId).decode(bytes, { stream: true })
    } catch {
      return rawText
    }
  }

  const decodePlainPayload = (msg: { data?: string; dataBase64?: string }) => {
    const rawText = String(msg?.data || '')
    const base64 = String(msg?.dataBase64 || '')
    if (!base64) return rawText
    const bytes = decodeBase64Bytes(base64)
    if (!bytes) return rawText
    try {
      return new TextDecoder('utf-8').decode(bytes)
    } catch {
      return rawText
    }
  }

  return {
    terminalEncoding,
    loadTerminalEncoding,
    clearSessionDecoders,
    decodeSshPayload,
    decodePlainPayload,
  }
}
