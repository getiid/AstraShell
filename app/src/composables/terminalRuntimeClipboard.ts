import type { Terminal } from '@xterm/xterm'
import type { Ref } from 'vue'
import type { TerminalMode } from './terminalRuntimeTypes'

export function createTerminalRuntimeClipboard(params: {
  focusTerminal: Ref<boolean>
  activeTerminalMode: Ref<TerminalMode>
  sshConnected: Ref<boolean>
  sshSessionId: Ref<string>
  serialConnected: Ref<boolean>
  serialCurrentPath: Ref<string>
  sshStatus: Ref<string>
  localConnected: Readonly<Ref<boolean>>
  activeLocalSessionId: Readonly<Ref<string>>
  getTerminal: () => Terminal | null
}) {
  const {
    focusTerminal,
    activeTerminalMode,
    sshConnected,
    sshSessionId,
    serialConnected,
    serialCurrentPath,
    sshStatus,
    localConnected,
    activeLocalSessionId,
    getTerminal,
  } = params

  const readClipboardText = async () => {
    const res = await window.lightterm.clipboardRead()
    if (res.ok) return res.text || ''
    return ''
  }

  const copyTerminalSelection = async () => {
    const text = getTerminal()?.getSelection() || ''
    if (!text) {
      sshStatus.value = '请先在终端中选择内容'
      return
    }
    const res = await window.lightterm.clipboardWrite({ text })
    sshStatus.value = res.ok ? '终端选中内容已复制' : `复制失败：${res.error || '未知错误'}`
  }

  const pasteToTerminal = async () => {
    const terminal = getTerminal()
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
    const terminal = getTerminal()
    terminal?.selectAll()
    terminal?.focus()
  }

  const handleTerminalHotkeys = (event: KeyboardEvent) => {
    const terminal = getTerminal()
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

  return {
    readClipboardText,
    copyTerminalSelection,
    pasteToTerminal,
    selectAllTerminal,
    handleTerminalHotkeys,
  }
}
