import type { Ref } from 'vue'

export type TerminalMode = 'ssh' | 'serial' | 'local'
export type TerminalEncoding = 'utf-8' | 'gb18030'

export type UseTerminalRuntimeParams = {
  termEl: Ref<HTMLElement | null>
  focusTerminal: Ref<boolean>
  activeTerminalMode: Ref<TerminalMode>
  sshConnected: Ref<boolean>
  sshSessionId: Ref<string>
  sshTabs: Ref<Array<{ id: string; name: string; connected: boolean }>>
  getSshBuffer: (sessionId: string) => string
  appendSshBuffer: (sessionId: string, text: string) => void
  saveSshTabs: () => void
  clearSessionRestoreState: () => void
  serialConnected: Ref<boolean>
  serialCurrentPath: Ref<string>
  pushSerialDialog: (type: 'tx' | 'rx' | 'sys' | 'err', rawText: string) => void
  sshStatus: Ref<string>
  localConnected: Readonly<Ref<boolean>>
  activeLocalSessionId: Readonly<Ref<string>>
  localStatus: Ref<string>
  recordLocalInput: (sessionId: string, data: string) => void
  appendLocalData: (sessionId: string, text: string) => void
  handleLocalClose: (sessionId: string, code: number) => void
  handleLocalError: (sessionId: string, error: string) => void
  renderActiveLocalSession: () => Promise<void>
  snippetsLoaded: Ref<boolean>
  restoreSnippets: () => Promise<void>
  terminalEncodingStorageKey: string
  onSshInput?: (data: string) => void
  onTerminalCommandSent?: (command: string) => void
}
