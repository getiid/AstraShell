import { ref, type Ref } from 'vue'

type TextMenuMode = 'terminal' | 'editor'

type UseTextContextMenuParams = {
  sshStatus: Ref<string>
  hideRemoteMenu: () => void
  readClipboardText: () => Promise<string>
  copyTerminalSelection: () => Promise<void>
  pasteToTerminal: () => Promise<void>
  selectAllTerminal: () => void
}

export function useTextContextMenu(params: UseTextContextMenuParams) {
  const {
    sshStatus,
    hideRemoteMenu,
    readClipboardText,
    copyTerminalSelection,
    pasteToTerminal,
    selectAllTerminal,
  } = params

  const textMenu = ref({
    visible: false,
    x: 0,
    y: 0,
    mode: 'terminal' as TextMenuMode,
  })
  const editorMenuTarget = ref<HTMLInputElement | HTMLTextAreaElement | null>(null)

  const openTerminalContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    hideRemoteMenu()
    textMenu.value = { visible: true, x: event.clientX, y: event.clientY, mode: 'terminal' }
  }

  const openEditorContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    hideRemoteMenu()
    const target = event.target as HTMLInputElement | HTMLTextAreaElement | null
    if (!target || typeof target.value !== 'string') return
    editorMenuTarget.value = target
    target.focus()
    textMenu.value = { visible: true, x: event.clientX, y: event.clientY, mode: 'editor' }
  }

  const hideTextMenu = () => {
    textMenu.value.visible = false
  }

  const hideAllMenus = () => {
    hideRemoteMenu()
    hideTextMenu()
  }

  const getEditorTarget = () => editorMenuTarget.value

  const getEditorSelection = () => {
    const el = getEditorTarget()
    if (!el) return ''
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? start
    return el.value.slice(start, end)
  }

  const replaceEditorSelection = (text: string) => {
    const el = getEditorTarget()
    if (!el) return
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? start
    el.value = `${el.value.slice(0, start)}${text}${el.value.slice(end)}`
    const pos = start + text.length
    el.setSelectionRange(pos, pos)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.focus()
  }

  const copyFromTextMenu = async () => {
    if (textMenu.value.mode === 'terminal') {
      await copyTerminalSelection()
      hideTextMenu()
      return
    }
    const text = getEditorSelection()
    if (!text) {
      sshStatus.value = '请先选中文本'
      hideTextMenu()
      return
    }
    const res = await window.lightterm.clipboardWrite({ text })
    sshStatus.value = res.ok ? '已复制选中文本' : `复制失败：${res.error || '未知错误'}`
    hideTextMenu()
  }

  const cutFromTextMenu = async () => {
    if (textMenu.value.mode !== 'editor') return
    const text = getEditorSelection()
    if (!text) {
      sshStatus.value = '请先选中文本'
      hideTextMenu()
      return
    }
    const res = await window.lightterm.clipboardWrite({ text })
    if (!res.ok) {
      sshStatus.value = `剪切失败：${res.error || '未知错误'}`
      hideTextMenu()
      return
    }
    replaceEditorSelection('')
    sshStatus.value = '已剪切选中文本'
    hideTextMenu()
  }

  const pasteFromTextMenu = async () => {
    if (textMenu.value.mode === 'terminal') {
      await pasteToTerminal()
      hideTextMenu()
      return
    }
    const text = await readClipboardText()
    if (!text) {
      sshStatus.value = '剪贴板为空'
      hideTextMenu()
      return
    }
    replaceEditorSelection(text)
    sshStatus.value = '已粘贴文本'
    hideTextMenu()
  }

  const selectAllFromTextMenu = () => {
    if (textMenu.value.mode === 'terminal') {
      selectAllTerminal()
      hideTextMenu()
      return
    }
    const el = getEditorTarget()
    if (!el) {
      hideTextMenu()
      return
    }
    el.focus()
    el.setSelectionRange(0, el.value.length)
    hideTextMenu()
  }

  return {
    textMenu,
    openTerminalContextMenu,
    openEditorContextMenu,
    hideTextMenu,
    hideAllMenus,
    copyFromTextMenu,
    cutFromTextMenu,
    pasteFromTextMenu,
    selectAllFromTextMenu,
  }
}
