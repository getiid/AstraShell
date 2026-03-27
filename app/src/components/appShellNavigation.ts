export function createAppShellNavigation(parts: Record<string, any>) {
  const {
    nav,
    focusTerminal,
    activeTerminalMode,
    sshStatus,
    localStatus,
    localTabs,
    termEl,
  } = parts

  const bindTermEl = (el: Element | null) => {
    termEl.value = el instanceof HTMLElement ? el : null
  }

  const exitTerminalView = () => {
    focusTerminal.value = false
  }

  const selectNav = (target: string) => {
    focusTerminal.value = false
    nav.value = target
  }

  const openSnippetsPanel = () => {
    nav.value = 'snippets'
    focusTerminal.value = false
  }

  const openSshConnectionChooser = () => {
    activeTerminalMode.value = 'ssh'
    nav.value = 'hosts'
    focusTerminal.value = false
    sshStatus.value = '请选择一个 SSH 主机，或在顶部输入快速连接'
  }

  const openLocalTerminalChooser = () => {
    activeTerminalMode.value = 'local'
    nav.value = 'local'
    focusTerminal.value = false
    localStatus.value = localTabs.value.length > 0
      ? '已返回本地终端面板，可继续进入已开的会话'
      : '请选择或新建一个本地终端'
  }

  return {
    bindTermEl,
    exitTerminalView,
    selectNav,
    openSnippetsPanel,
    openSshConnectionChooser,
    openLocalTerminalChooser,
  }
}
