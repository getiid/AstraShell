import { computed, type Ref } from 'vue'
import type { Terminal } from '@xterm/xterm'
import type { TerminalMode } from './terminalRuntimeTypes'

const terminalFontStackTech = '"Maple Mono NF CN","Sarasa Mono SC","JetBrains Mono","Cascadia Mono","SF Mono","Menlo","PingFang SC","Microsoft YaHei UI",monospace'
const terminalFontStackLight = '"Sarasa Mono SC","JetBrains Mono","Cascadia Mono","SF Mono","Menlo","PingFang SC","Microsoft YaHei UI",monospace'

export function createTerminalRuntimePresentation(params: {
  termEl: Ref<HTMLElement | null>
  activeTerminalMode: Ref<TerminalMode>
  sshSessionId: Ref<string>
  sshTabs: Ref<Array<{ id: string; name: string; connected: boolean }>>
  serialCurrentPath: Ref<string>
  localStatus: Ref<string>
  getTerminal: () => Terminal | null
}) {
  const {
    termEl,
    activeTerminalMode,
    sshSessionId,
    sshTabs,
    serialCurrentPath,
    localStatus,
    getTerminal,
  } = params

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
    const terminal = getTerminal()
    if (!terminal) return
    const techMode = activeTerminalMode.value !== 'ssh'
    termEl.value?.style?.setProperty('--terminal-surface-bg', '#07101d')
    termEl.value?.style?.setProperty('--terminal-mask-bg', '#07101d')
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
      background: '#07101d',
      foreground: '#d9e7ff',
      cursor: '#60a5fa',
      selectionBackground: '#2563eb80',
      selectionInactiveBackground: '#1d4ed880',
    }
    terminal.options.fontFamily = terminalFontStackLight
    terminal.options.fontSize = 13
    terminal.options.fontWeight = 500
    terminal.options.lineHeight = 1.2
  }

  return {
    terminalModeLabel,
    terminalTargetLabel,
    applyTerminalTheme,
    terminalFontStackLight,
  }
}
