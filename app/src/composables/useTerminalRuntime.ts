import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { nextTick, watch } from 'vue'
import { createTerminalRuntimeClipboard } from './terminalRuntimeClipboard'
import { createTerminalRuntimeDecoding } from './terminalRuntimeDecoding'
import { createTerminalRuntimePresentation } from './terminalRuntimePresentation'
import type { UseTerminalRuntimeParams } from './terminalRuntimeTypes'

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
    saveSshTabs,
    clearSessionRestoreState,
    serialConnected,
    serialCurrentPath,
    pushSerialDialog,
    sshStatus,
    snippetsLoaded,
    restoreSnippets,
    terminalEncodingStorageKey,
  } = params

  let terminal: Terminal | null = null
  let fitAddon: FitAddon | null = null
  const getTerminal = () => terminal

  const {
    terminalEncoding,
    loadTerminalEncoding,
    clearSessionDecoders,
    decodeSshPayload,
  } = createTerminalRuntimeDecoding(terminalEncodingStorageKey)

  const presentation = createTerminalRuntimePresentation({
    termEl,
    activeTerminalMode,
    sshSessionId,
    sshTabs,
    serialCurrentPath,
    getTerminal,
  })
  const applyTerminalTheme = presentation.applyTerminalTheme

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
  }

  const syncLocalTerminalSize = async () => {
    // 本地终端已移除
  }

  const initTerminal = () => {
    if (!termEl.value || terminal) return
    terminal = new Terminal({
      convertEol: true,
      fontSize: 13,
      fontFamily: presentation.terminalFontStackLight,
      fontWeight: 500,
      lineHeight: 1.2,
      rightClickSelectsWord: true,
      theme: {
        background: '#07101d',
        foreground: '#d9e7ff',
        cursor: '#60a5fa',
        selectionBackground: '#2563eb80',
        selectionInactiveBackground: '#1d4ed880',
      },
    })
    fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(termEl.value)
    fitAddon.fit()
    terminal.focus()
    applyTerminalTheme()
    if (focusTerminal.value) {
      if (activeTerminalMode.value === 'ssh') {
        renderActiveSshBuffer()
      }
    }
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
  }

  watch(focusTerminal, (value) => {
    if (value && !snippetsLoaded.value) void restoreSnippets()
    nextTick(() => {
      initTerminal()
      fitAddon?.fit()
      if (!value) return
      if (activeTerminalMode.value === 'ssh') {
        renderActiveSshBuffer()
      }
      terminal?.focus()
    })
  })

  watch(activeTerminalMode, () => {
    nextTick(() => {
      initTerminal()
      applyTerminalTheme()
      fitAddon?.fit()
      if (!focusTerminal.value) return
      if (activeTerminalMode.value === 'ssh') {
        renderActiveSshBuffer()
      }
      terminal?.focus()
    })
  })
  const clipboard = createTerminalRuntimeClipboard({
    focusTerminal,
    activeTerminalMode,
    sshConnected,
    sshSessionId,
    serialConnected,
    serialCurrentPath,
    sshStatus,
    getTerminal,
  })

  const focusNativeTerminal = () => terminal?.focus()
  const resetTerminal = () => terminal?.reset()
  const writeTerminal = (text: string) => terminal?.write(text)
  const writeTerminalLine = (text: string) => terminal?.writeln(text)
  const fitTerminal = () => fitAddon?.fit()
  const getTerminalSize = () => ({ cols: terminal?.cols || 0, rows: terminal?.rows || 0 })

  return {
    terminalEncoding,
    terminalModeLabel: presentation.terminalModeLabel,
    terminalTargetLabel: presentation.terminalTargetLabel,
    loadTerminalEncoding,
    clearSessionDecoders,
    renderActiveSshBuffer,
    initTerminal,
    applyTerminalTheme,
    writeActiveTerminalInput,
    syncLocalTerminalSize,
    readClipboardText: clipboard.readClipboardText,
    copyTerminalSelection: clipboard.copyTerminalSelection,
    pasteToTerminal: clipboard.pasteToTerminal,
    selectAllTerminal: clipboard.selectAllTerminal,
    handleTerminalHotkeys: clipboard.handleTerminalHotkeys,
    focusNativeTerminal,
    resetTerminal,
    writeTerminal,
    writeTerminalLine,
    fitTerminal,
    getTerminalSize,
  }
}
