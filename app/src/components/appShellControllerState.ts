import { ref } from 'vue'

export type NavKey = 'hosts' | 'sftp' | 'snippets' | 'serial' | 'local' | 'database' | 'vault' | 'settings' | 'logs'
export type TerminalMode = 'ssh' | 'serial' | 'local'
export type TerminalEncoding = 'utf-8' | 'gb18030'

export const DEFAULT_CATEGORY = '默认'
export const ALL_CATEGORY = '全部'
export const TERMINAL_ENCODING_STORAGE_KEY = 'astrashell.terminal.encoding'

export function createAppShellControllerState() {
  return {
    nav: ref<NavKey>('hosts'),
    termEl: ref<HTMLElement | null>(null),
    sshForm: ref({ host: '', port: 22, username: 'root', password: '' }),
    quickConnectInput: ref(''),
    authType: ref<'password' | 'key'>('password'),
    selectedKeyRef: ref(''),
    sshStatus: ref(''),
    sshSessionId: ref(''),
    sshConnected: ref(false),
    focusTerminal: ref(false),
    activeTerminalMode: ref<TerminalMode>('ssh'),
    hostName: ref(''),
    hostCategory: ref(DEFAULT_CATEGORY),
    hostItems: ref<any[]>([]),
    selectedHostId: ref(''),
    editingHost: ref<any | null>(null),
    editPasswordVisible: ref(false),
    hostEditorVisible: ref(false),
    extraCategories: ref<string[]>([]),
    localPath: ref(''),
    localRows: ref<any[]>([]),
    selectedLocalFile: ref(''),
    hostsLoaded: ref(false),
    localFsLoaded: ref(false),
    rightLocalFsLoaded: ref(false),
    sessionRestoreTried: ref(false),
  }
}
