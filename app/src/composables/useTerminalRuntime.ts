import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { computed, nextTick, ref, watch, type Ref } from 'vue'

type TerminalMode = 'ssh' | 'serial' | 'local'
type TerminalEncoding = 'utf-8' | 'gb18030'

type UseTerminalRuntimeParams = {
  termEl: Ref<HTMLElement | null>
  focusTerminal: Ref<boolean>
  activeTerminalMode: Ref<TerminalMode>
  sshConnected: Ref<boolean>
  sshSessionId: Ref<string>
  sshTabs: Ref<Array<{ id: string; name: string; connected: boolean }>>
  getSshBuffer: (sessionId: string) => string
  appendSshBuffer: (sessionId: string, text: string) => void
  clearSessionDecoders: (sessionId: string) => void
  saveSshTabs: () => void
  clearSessionRestoreState: () => void
  serialConnected: Ref<boolean>
  serialCurrentPath: Ref<string>
  pushSerialDialog: (type: 'tx' | 'rx' | 'sys' | 'err', rawText: string) => void
  sshStatus: Ref<string>
  localConnected: Readonly<Ref<boolean>>
  activeLocalSessionId: Readonly<Ref<string>>
  localStatus: Ref<string>
  appendLocalData: (sessionId: string, text: string) => void
  handleLocalClose: (sessionId: string, code: number) => void
  handleLocalError: (sessionId: string, error: string) => void
  snippetsLoaded: Ref<boolean>
  restoreSnippets: () => Promise<void>
  terminalEncodingStorageKey: string
}

export function useTerminalRuntime(params: UseTerminalRuntimeParams) {
  const {
    termEl,
    focusTerminal,
    activeTerminalMode,
    sshConnected,
    sshSessionId,
    sshTabs,
    getSshBuffer,
    appendSshBuffer,
    clearSessionDecoders,
    saveSshTabs,
    clearSessionRestoreState,
    serialConnected,
    serialCurrentPath,
    pushSerialDialog,
    sshStatus,
    localConnected,
    activeLocalSessionId,
    localStatus,
    appendLocalData,
    handleLocalClose,
    handleLocalError,
    snippetsLoaded,
    restoreSnippets,
    terminalEncodingStorageKey,
  } = params

  const terminalFontStackTech = '"Maple Mono NF CN","Sarasa Mono SC","JetBrains Mono","Cascadia Mono","SF Mono","Menlo","PingFang SC","Microsoft YaHei UI",monospace'
  const terminalFontStackLight = '"Sarasa Mono SC","JetBrains Mono","Cascadia Mono","SF Mono","Menlo","PingFang SC","Microsoft YaHei UI",monospace'

  const terminalEncoding = ref<TerminalEncoding>('utf-8')
  const terminalDecoders = new Map<string, TextDecoder>()

  let terminal: Terminal | null = null
  let fitAddon: FitAddon | null = null

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

  const terminalModeLabel = computed(() => (
    activeTerminalMode.value === 'ssh'
      ? 'SSH 终端'
      : activeTerminalMode.value === 'serial'
        ? '串口会话'
        : '本地终端'
  ))

  const terminalTargetLabel = computed(() => {
    if (activeTerminalMode.value === 'ssh') {
      if (!sshSessionId.value) return '未连接'
      const tab = sshTabs.value.find((item) => item.id === sshSessionId.value)
      return tab?.name || sshSessionId.value
    }
    if (activeTerminalMode.value === 'serial') return serialCurrentPath.value || '未连接串口'
    return localStatus.value || '未连接'
  })

  const applyTerminalTheme = () => {
    if (!terminal) return
    const techMode = activeTerminalMode.value !== 'ssh'
    if (techMode) {
      terminal.options.theme = {
        background: '#07101d',
        foreground: '#d9e7ff',
        cursor: '#22d3ee',
        selectionBackground: '#0ea5e980',
        selectionInactiveBackground: '#1d4ed880',
      }
      terminal.options.fontFamily = terminalFontStackTech
      terminal.options.fontSize = 14
      terminal.options.fontWeight = 500
      terminal.options.lineHeight = 1.24
      return
    }
    terminal.options.theme = {
      background: '#f8fafc',
      foreground: '#111827',
      cursor: '#2563eb',
      selectionBackground: '#2563ebc0',
      selectionInactiveBackground: '#60a5fa88',
    }
    terminal.options.fontFamily = terminalFontStackLight
    terminal.options.fontSize = 13
    terminal.options.fontWeight = 500
    terminal.options.lineHeight = 1.2
  }

  const renderActiveSshBuffer = () => {
    if (!terminal) return
    const text = getSshBuffer(sshSessionId.value)
    terminal.reset()
    if (text) terminal.write(text)
    terminal.focus()
  }

  const writeActiveTerminalInput = async (data: string) => {
    if (!data) return
    if (activeTerminalMode.value === 'ssh') {
      if (!sshConnected.value) return
      await window.lightterm.sshWrite({ sessionId: sshSessionId.value, data })
      return
    }
    if (activeTerminalMode.value === 'serial') {
      if (!serialConnected.value || !serialCurrentPath.value) return
      await window.lightterm.sendSerial({ path: serialCurrentPath.value, data, isHex: false })
      return
    }
    if (!localConnected.value || !activeLocalSessionId.value) return
    const res = await window.lightterm.localWrite({ sessionId: activeLocalSessionId.value, data })
    if (!res.ok) {
      localStatus.value = `本地终端写入失败：${res.error || '未知错误'}`
      terminal?.writeln(`\r\n[本地终端写入失败] ${res.error || '未知错误'}`)
    }
  }

  const syncLocalTerminalSize = async () => {
    if (!terminal || !localConnected.value || !activeLocalSessionId.value) return
    await window.lightterm.localResize({
      sessionId: activeLocalSessionId.value,
      cols: terminal.cols,
      rows: terminal.rows,
    })
  }

  const initTerminal = () => {
    if (!termEl.value || terminal) return
    terminal = new Terminal({
      convertEol: true,
      fontSize: 13,
      fontFamily: terminalFontStackLight,
      fontWeight: 500,
      lineHeight: 1.2,
      rightClickSelectsWord: true,
      theme: {
        background: '#f8fafc',
        foreground: '#111827',
        cursor: '#2563eb',
        selectionBackground: '#2563ebc0',
        selectionInactiveBackground: '#60a5fa88',
      },
    })
    fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(termEl.value)
    fitAddon.fit()
    terminal.focus()
    applyTerminalTheme()
    termEl.value.addEventListener('click', () => terminal?.focus())

    terminal.onData((data) => {
      void writeActiveTerminalInput(data)
    })
    window.lightterm.onSshData((msg) => {
      const sessionId = String(msg?.sessionId || '')
      if (!sessionId) return
      const text = decodeSshPayload(msg)
      appendSshBuffer(sessionId, text)
      if (sessionId === sshSessionId.value && activeTerminalMode.value === 'ssh') terminal?.write(text)
    })
    window.lightterm.onSshClose((msg) => {
      const tab = sshTabs.value.find((item) => item.id === msg.sessionId)
      if (tab) tab.connected = false
      saveSshTabs()
      clearSessionDecoders(msg.sessionId)
      if (!sshTabs.value.some((item) => item.connected)) clearSessionRestoreState()
      if (msg.sessionId === sshSessionId.value) {
        sshConnected.value = false
        if (activeTerminalMode.value === 'ssh') terminal?.writeln('\r\n[SSH 已断开]')
      }
    })
    window.lightterm.onSshError((msg) => {
      if (msg.sessionId === sshSessionId.value && activeTerminalMode.value === 'ssh') {
        terminal?.writeln(`\r\n[SSH 错误] ${msg.error}`)
      }
    })
    window.lightterm.onSerialData((msg) => {
      if (msg.path !== serialCurrentPath.value) return
      pushSerialDialog('rx', String(msg.data || ''))
      if (activeTerminalMode.value === 'serial') terminal?.write(String(msg.data || ''))
    })
    window.lightterm.onSerialError((msg) => {
      if (msg.path !== serialCurrentPath.value) return
      sshStatus.value = `串口异常：${msg.error || '未知错误'}`
      pushSerialDialog('err', String(msg.error || '串口异常'))
      if (activeTerminalMode.value === 'serial') {
        terminal?.writeln(`\r\n[串口错误] ${msg.error || '未知错误'}`)
      }
    })
    window.lightterm.onLocalData((msg) => {
      const sessionId = String(msg?.sessionId || '')
      if (!sessionId) return
      const text = decodePlainPayload(msg)
      appendLocalData(sessionId, text)
      if (sessionId !== activeLocalSessionId.value) return
      if (activeTerminalMode.value !== 'local') return
      terminal?.write(text)
    })
    window.lightterm.onLocalClose((msg) => {
      const sessionId = String(msg?.sessionId || '')
      if (!sessionId) return
      handleLocalClose(sessionId, Number(msg?.code || 0))
      if (sessionId === activeLocalSessionId.value && activeTerminalMode.value === 'local') {
        terminal?.writeln(`\r\n[本地终端已断开] code=${Number(msg?.code || 0)}`)
      }
    })
    window.lightterm.onLocalError((msg) => {
      const sessionId = String(msg?.sessionId || '')
      if (!sessionId) return
      handleLocalError(sessionId, String(msg?.error || '未知错误'))
      if (sessionId === activeLocalSessionId.value && activeTerminalMode.value === 'local') {
        terminal?.writeln(`\r\n[本地终端错误] ${msg?.error || '未知错误'}`)
      }
    })
  }

  watch(focusTerminal, (value) => {
    if (value && !snippetsLoaded.value) void restoreSnippets()
    nextTick(() => {
      initTerminal()
      fitAddon?.fit()
      if (value) terminal?.focus()
    })
  })

  watch(activeTerminalMode, () => {
    nextTick(() => {
      initTerminal()
      applyTerminalTheme()
      fitAddon?.fit()
      if (focusTerminal.value) terminal?.focus()
    })
  })

  const readClipboardText = async () => {
    const res = await window.lightterm.clipboardRead()
    if (res.ok) return res.text || ''
    return ''
  }

  const copyTerminalSelection = async () => {
    const text = terminal?.getSelection() || ''
    if (!text) {
      sshStatus.value = '请先在终端中选择内容'
      return
    }
    const res = await window.lightterm.clipboardWrite({ text })
    sshStatus.value = res.ok ? '终端选中内容已复制' : `复制失败：${res.error || '未知错误'}`
  }

  const pasteToTerminal = async () => {
    const ready = activeTerminalMode.value === 'ssh'
      ? sshConnected.value
      : activeTerminalMode.value === 'serial'
        ? serialConnected.value
        : localConnected.value
    if (!ready) {
      sshStatus.value = activeTerminalMode.value === 'ssh'
        ? '请先连接 SSH 会话'
        : activeTerminalMode.value === 'serial'
          ? '请先连接串口'
          : '请先连接本地终端'
      return
    }
    const text = await readClipboardText()
    if (!text) {
      sshStatus.value = '剪贴板为空'
      return
    }
    const res = activeTerminalMode.value === 'ssh'
      ? await window.lightterm.sshWrite({ sessionId: sshSessionId.value, data: text })
      : activeTerminalMode.value === 'serial'
        ? await window.lightterm.sendSerial({ path: serialCurrentPath.value, data: text, isHex: false })
        : await window.lightterm.localWrite({ sessionId: activeLocalSessionId.value, data: text })
    sshStatus.value = res.ok ? '已粘贴到终端' : `粘贴失败：${res.error || '未知错误'}`
    terminal?.focus()
  }

  const selectAllTerminal = () => {
    terminal?.selectAll()
    terminal?.focus()
  }

  const handleTerminalHotkeys = (event: KeyboardEvent) => {
    if (!focusTerminal.value) return
    const target = event.target as HTMLElement | null
    const tagName = target?.tagName || ''
    const isXtermHelper = tagName === 'TEXTAREA' && !!target?.classList?.contains('xterm-helper-textarea')
    const isFormEditor = tagName === 'INPUT' || tagName === 'SELECT' || (tagName === 'TEXTAREA' && !isXtermHelper)
    if (isFormEditor) return

    const hasMeta = event.metaKey || event.ctrlKey
    if (!hasMeta) return
    const key = event.key.toLowerCase()

    if (key === 'c' && terminal?.hasSelection()) {
      event.preventDefault()
      event.stopPropagation()
      void copyTerminalSelection()
      return
    }
    if (key === 'v') {
      event.preventDefault()
      event.stopPropagation()
      void pasteToTerminal()
      return
    }
    if (key === 'a') {
      event.preventDefault()
      event.stopPropagation()
      selectAllTerminal()
    }
  }

  const focusNativeTerminal = () => terminal?.focus()
  const resetTerminal = () => terminal?.reset()
  const writeTerminal = (text: string) => terminal?.write(text)
  const writeTerminalLine = (text: string) => terminal?.writeln(text)
  const fitTerminal = () => fitAddon?.fit()
  const getTerminalSize = () => ({ cols: terminal?.cols || 0, rows: terminal?.rows || 0 })

  return {
    terminalEncoding,
    terminalModeLabel,
    terminalTargetLabel,
    loadTerminalEncoding,
    clearSessionDecoders,
    renderActiveSshBuffer,
    initTerminal,
    applyTerminalTheme,
    writeActiveTerminalInput,
    syncLocalTerminalSize,
    readClipboardText,
    copyTerminalSelection,
    pasteToTerminal,
    selectAllTerminal,
    handleTerminalHotkeys,
    focusNativeTerminal,
    resetTerminal,
    writeTerminal,
    writeTerminalLine,
    fitTerminal,
    getTerminalSize,
  }
}
