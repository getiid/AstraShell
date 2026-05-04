import { computed, ref } from 'vue'
import type { TerminalEncoding } from './appShellControllerState'

export function createAppShellTerminalRuntimeBridge() {
  const bridge = {
    terminalEncoding: ref<TerminalEncoding>('utf-8'),
    terminalModeLabel: computed(() => 'SSH 终端'),
    terminalTargetLabel: computed(() => '未连接'),
    loadTerminalEncoding: () => {},
    clearSessionDecoders: (_sessionId: string) => {},
    renderActiveSshBuffer: () => {},
    initTerminal: () => {},
    applyTerminalTheme: () => {},
    syncLocalTerminalSize: async () => {},
    readClipboardText: async () => '',
    copyTerminalSelection: async () => {},
    pasteToTerminal: async () => {},
    selectAllTerminal: () => {},
    handleTerminalHotkeys: (_event: KeyboardEvent) => {},
    focusNativeTerminal: () => {},
    resetTerminal: () => {},
    writeTerminal: (_text: string) => {},
    writeTerminalLine: (_text: string) => {},
    sendTerminalCommand: async (_command: string) => {},
    fitTerminal: () => {},
    getTerminalSize: () => ({ cols: 0, rows: 0 }),
  }

  const applyRuntime = (runtime: {
    terminalEncoding: typeof bridge.terminalEncoding
    terminalModeLabel: typeof bridge.terminalModeLabel
    terminalTargetLabel: typeof bridge.terminalTargetLabel
    loadTerminalEncoding: typeof bridge.loadTerminalEncoding
    clearSessionDecoders: typeof bridge.clearSessionDecoders
    renderActiveSshBuffer: typeof bridge.renderActiveSshBuffer
    initTerminal: typeof bridge.initTerminal
    applyTerminalTheme: typeof bridge.applyTerminalTheme
    syncLocalTerminalSize: typeof bridge.syncLocalTerminalSize
    readClipboardText: typeof bridge.readClipboardText
    copyTerminalSelection: typeof bridge.copyTerminalSelection
    pasteToTerminal: typeof bridge.pasteToTerminal
    selectAllTerminal: typeof bridge.selectAllTerminal
    handleTerminalHotkeys: typeof bridge.handleTerminalHotkeys
    focusNativeTerminal: typeof bridge.focusNativeTerminal
    resetTerminal: typeof bridge.resetTerminal
    writeTerminal: typeof bridge.writeTerminal
    writeTerminalLine: typeof bridge.writeTerminalLine
    sendTerminalCommand: typeof bridge.sendTerminalCommand
    fitTerminal: typeof bridge.fitTerminal
    getTerminalSize: typeof bridge.getTerminalSize
  }) => {
    bridge.terminalEncoding = runtime.terminalEncoding
    bridge.terminalModeLabel = runtime.terminalModeLabel
    bridge.terminalTargetLabel = runtime.terminalTargetLabel
    bridge.loadTerminalEncoding = runtime.loadTerminalEncoding
    bridge.clearSessionDecoders = runtime.clearSessionDecoders
    bridge.renderActiveSshBuffer = runtime.renderActiveSshBuffer
    bridge.initTerminal = runtime.initTerminal
    bridge.applyTerminalTheme = runtime.applyTerminalTheme
    bridge.syncLocalTerminalSize = runtime.syncLocalTerminalSize
    bridge.readClipboardText = runtime.readClipboardText
    bridge.copyTerminalSelection = runtime.copyTerminalSelection
    bridge.pasteToTerminal = runtime.pasteToTerminal
    bridge.selectAllTerminal = runtime.selectAllTerminal
    bridge.handleTerminalHotkeys = runtime.handleTerminalHotkeys
    bridge.focusNativeTerminal = runtime.focusNativeTerminal
    bridge.resetTerminal = runtime.resetTerminal
    bridge.writeTerminal = runtime.writeTerminal
    bridge.writeTerminalLine = runtime.writeTerminalLine
    bridge.sendTerminalCommand = runtime.sendTerminalCommand
    bridge.fitTerminal = runtime.fitTerminal
    bridge.getTerminalSize = runtime.getTerminalSize
  }

  return {
    bridge,
    applyRuntime,
  }
}
