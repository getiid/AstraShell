<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useAuditManager } from '../composables/useAuditManager'
import { useAppStartupLifecycle } from '../composables/useAppStartupLifecycle'
import { useAppShellSupport } from '../composables/useAppShellSupport'
import { useHostWorkspace } from '../composables/useHostWorkspace'
import { useLocalQuickTools } from '../composables/useLocalQuickTools'
import { useLocalTerminalManager } from '../composables/useLocalTerminalManager'
import { useSerialBaudSync } from '../composables/useSerialBaudSync'
import { useSerialManager } from '../composables/useSerialManager'
import { useSftpPanels } from '../composables/useSftpPanels'
import { useSftpViewState } from '../composables/useSftpViewState'
import { useSftpWorkspace } from '../composables/useSftpWorkspace'
import { useSnippetManager } from '../composables/useSnippetManager'
import { useSshConnection } from '../composables/useSshConnection'
import { useTextContextMenu } from '../composables/useTextContextMenu'
import { useStartupGate } from '../composables/useStartupGate'
import { useSshTabActions } from '../composables/useSshTabActions'
import { useSyncManager } from '../composables/useSyncManager'
import { useStorageManager } from '../composables/useStorageManager'
import { useTerminalRuntime } from '../composables/useTerminalRuntime'
import { useTerminalTabs } from '../composables/useTerminalTabs'
import { useUpdateManager } from '../composables/useUpdateManager'
import { useVaultManager } from '../composables/useVaultManager'
import { useWindowBridgeEvents } from '../composables/useWindowBridgeEvents'
import AppSidebar from './AppSidebar.vue'
import AppStatusBar from './AppStatusBar.vue'
import HostsPanel from './panels/HostsPanel.vue'
import LocalPanel from './panels/LocalPanel.vue'
import LogsPanel from './panels/LogsPanel.vue'
import SerialPanel from './panels/SerialPanel.vue'
import SettingsPanel from './panels/SettingsPanel.vue'
import SftpPanel from './panels/SftpPanel.vue'
import SnippetsPanel from './panels/SnippetsPanel.vue'
import StartupGateOverlay from './StartupGateOverlay.vue'
import TerminalWorkspace from './TerminalWorkspace.vue'
import TextContextMenu from './TextContextMenu.vue'
import VaultPanel from './panels/VaultPanel.vue'
import '@xterm/xterm/css/xterm.css'

type NavKey = 'hosts' | 'sftp' | 'snippets' | 'serial' | 'local' | 'vault' | 'settings' | 'logs'
const nav = ref<NavKey>('hosts')
const termEl = ref<HTMLElement | null>(null)

const DEFAULT_CATEGORY = '默认'
const ALL_CATEGORY = '全部'
const TERMINAL_ENCODING_STORAGE_KEY = 'astrashell.terminal.encoding'

const sshForm = ref({ host: '', port: 22, username: 'root', password: '' })
const quickConnectInput = ref('')
const authType = ref<'password' | 'key'>('password')
const selectedKeyRef = ref('')
const sshStatus = ref('')
const sshSessionId = ref('')
const sshConnected = ref(false)
const focusTerminal = ref(false)
type TerminalMode = 'ssh' | 'serial' | 'local'
const activeTerminalMode = ref<TerminalMode>('ssh')
const {
  sshTabs,
  sshBufferBySession,
  ensureSshBuffer,
  getSshBuffer,
  appendSshBuffer,
} = useTerminalTabs()

const hostName = ref('')
const hostCategory = ref(DEFAULT_CATEGORY)
const hostItems = ref<any[]>([])
const selectedHostId = ref('')
const editingHost = ref<any | null>(null)
const editPasswordVisible = ref(false)
const hostEditorVisible = ref(false)

const extraCategories = ref<string[]>([])



const {
  sftpPath,
  sftpRows,
  sftpStatus,
  sftpHostId,
  sftpConnected,
  rightConnectPanelOpen,
  rightConnectTarget,
  sftpDragLocalPath,
  sftpDragRemoteFile,
  sftpUploadProgress,
  sftpDownloadProgress,
  selectedRemoteFile,
  sftpNewDirName,
  sftpRenameTo,
  remoteMenu,
  leftPanelMode,
  leftConnectPanelOpen,
  leftConnectTarget,
  leftConnectCategory,
  leftConnectKeyword,
  leftSftpHostId,
  leftSftpPath,
  leftSftpRows,
  rightPanelMode,
  rightConnectCategory,
  rightConnectKeyword,
  rightLocalPath,
  rightLocalRows,
  leftFileKeyword,
  rightFileKeyword,
  localSortBy,
  remoteSortBy,
} = useSftpPanels()

const localPath = ref('')
const localRows = ref<any[]>([])
const selectedLocalFile = ref('')

const {
  notify,
  isWindowsClient,
  getLocalParentPath,
  saveSessionRestoreState,
  clearSessionRestoreState,
  restoreSessionRestoreState,
  formatAppError,
  plainVaultMessage,
} = useAppShellSupport({
  sshStatus,
})

const {
  formatFsTime,
  leftDisplayRows,
  rightDisplayRows,
  leftConnectGroups,
  rightConnectGroups,
  sftpTransferModeLabel,
  leftPanelStateLabel,
  rightPanelStateLabel,
  leftLinkLabel,
  rightLinkLabel,
  leftLocalPathDisplay,
  rightLocalPathDisplay,
} = useSftpViewState({
  hostItems,
  defaultCategory: DEFAULT_CATEGORY,
  allCategory: ALL_CATEGORY,
  leftPanelMode,
  rightPanelMode,
  localPath,
  localRows,
  leftSftpHostId,
  leftSftpRows,
  rightLocalPath,
  rightLocalRows,
  sftpHostId,
  sftpRows,
  leftFileKeyword,
  rightFileKeyword,
  leftConnectCategory,
  leftConnectKeyword,
  rightConnectCategory,
  rightConnectKeyword,
  localSortBy,
  remoteSortBy,
  isWindowsClient,
})

const {
  updateInfo,
  updateActionBusy,
  updateStateLoaded,
  showManualMacUpdate,
  updateStatusText,
  mergeUpdateState,
  refreshUpdateState,
  checkAppUpdate,
  downloadAppUpdate,
  installAppUpdate,
  openManualUpdateLink,
} = useUpdateManager()

const hostsLoaded = ref(false)
const localFsLoaded = ref(false)
const rightLocalFsLoaded = ref(false)
type TerminalEncoding = 'utf-8' | 'gb18030'

const sessionRestoreTried = ref(false)
const {
  auditStatus,
  auditKeyword,
  auditSource,
  selectedAuditTarget,
  auditTargetGroups,
  currentAuditLogs,
  refreshAuditLogs,
  clearAuditLogs,
  appendAuditLog,
  formatAuditTime,
  formatAuditSource,
  formatAuditAction,
} = useAuditManager()

let terminalEncoding = ref<TerminalEncoding>('utf-8')
let terminalModeLabel = computed(() => 'SSH 终端')
let terminalTargetLabel = computed(() => '未连接')
let loadTerminalEncoding = () => {}
let clearSessionDecoders = (_sessionId: string) => {}
let renderActiveSshBuffer = () => {}
let initTerminal = () => {}
let applyTerminalTheme = () => {}
let syncLocalTerminalSize = async () => {}
let readClipboardText = async () => ''
let copyTerminalSelection = async () => {}
let pasteToTerminal = async () => {}
let selectAllTerminal = () => {}
let handleTerminalHotkeys = (_event: KeyboardEvent) => {}
let focusNativeTerminal = () => {}
let resetTerminal = () => {}
let writeTerminal = (_text: string) => {}
let writeTerminalLine = (_text: string) => {}
let fitTerminal = () => {}
let getTerminalSize = () => ({ cols: 0, rows: 0 })
let connectSSH: (optionsOrEvent?: { keepNav?: boolean } | Event) => Promise<boolean> = async () => false
let connectSSHFromHosts = async () => {}

const {
  localTabs,
  activeLocalTabId,
  localBufferBySession,
  localCwd,
  localStatus,
  localShellType,
  localElevated,
  activeLocalSessionId,
  localConnected,
  switchLocalTab,
  connectLocalTerminal,
  closeLocalTab,
  disconnectLocalTerminal,
  runLocalQuickCommand,
  appendLocalData,
  handleLocalClose,
  handleLocalError,
  disconnectAllLocalTabs,
} = useLocalTerminalManager({
  isWindowsClient,
  activeTerminalMode,
  focusTerminal,
  saveSessionRestoreState,
  clearSessionRestoreState,
  renderLocalSession: async (sessionId: string, options?: { announce?: string }) => {
    await nextTick()
    initTerminal()
    applyTerminalTheme()
    resetTerminal()
    writeTerminal(localBufferBySession.value[sessionId] || '')
    if (options?.announce) writeTerminalLine(options.announce)
    focusNativeTerminal()
    await syncLocalTerminalSize()
  },
})
const {
  localQuickCategory,
  localQuickEditId,
  localQuickEditorVisible,
  localQuickDraftCategory,
  localQuickDraftLabel,
  localQuickDraftCmd,
  localQuickCategories,
  filteredLocalQuickItems,
  restoreLocalQuickItems,
  startEditLocalQuickItem,
  resetLocalQuickDraft,
  openLocalQuickCreate,
  closeLocalQuickEditor,
  saveLocalQuickDraft,
  removeLocalQuickItem,
} = useLocalQuickTools({
  localStatus,
})
const {
  serialPortsLoaded,
  serialPorts,
  serialBaudRates,
  serialForm,
  serialBaudPreset,
  serialSendText,
  serialHexMode,
  serialTimerMs,
  serialFlowControl,
  serialAdvancedOpen,
  serialConnected,
  serialCurrentPath,
  serialDialogLogs,
  serialTimerActive,
  serialConnectionInfo,
  pushSerialDialog,
  loadSerialPorts,
  openSerial,
  sendSerial,
  closeSerial,
  toggleTimerSend,
  disposeSerial,
} = useSerialManager({
  sshStatus,
  activeTerminalMode,
  focusTerminal,
  prepareTerminal: async () => {
    await nextTick()
    initTerminal()
    applyTerminalTheme()
  },
  writeTerminalLine,
})

useSerialBaudSync({
  serialForm,
  serialBaudPreset,
  serialBaudRates,
})

const {
  saveSshTabs,
  switchSshTab,
  createSshTab,
  ensureActiveSshSession,
  closeSshTab,
  restoreSshTabs,
} = useSshTabActions({
  sshTabs,
  sshSessionId,
  sshConnected,
  activeTerminalMode,
  focusTerminal,
  nav,
  sshBufferBySession,
  ensureSshBuffer,
  renderActiveSshBuffer: () => renderActiveSshBuffer(),
  clearSessionDecoders: (sessionId: string) => clearSessionDecoders(sessionId),
})

const {
  syncQuickConnectForm,
  saveCurrentHost,
  useHost,
  openHostEditor,
  openCreateHostEditor,
  openHostTerminal,
  saveEditedHost,
  deleteCurrentHost,
  refreshHosts,
  selectedCategory,
  hostKeyword,
  newCategoryName,
  newCategoryInputVisible,
  hostCategories,
  displayCategories,
  filteredHosts,
  beginAddCategory,
  addCategory,
  renameCategoryInline,
  hostProbeRunning,
  cancelHostProbe,
  hostProbeClass,
  hostProbeTitle,
  testHostReachability,
  probeFilteredHosts,
} = useHostWorkspace({
  hostItems,
  extraCategories,
  selectedHostId,
  sshForm,
  quickConnectInput,
  hostName,
  hostCategory,
  authType,
  selectedKeyRef,
  sshStatus,
  editingHost,
  editPasswordVisible,
  hostEditorVisible,
  hostsLoaded,
  defaultCategory: DEFAULT_CATEGORY,
  allCategory: ALL_CATEGORY,
  notify,
  createSshTab,
  closeSshTab,
  connectSSH: (optionsOrEvent?: { keepNav?: boolean } | Event) => connectSSH(optionsOrEvent),
})

const sshConnection = useSshConnection({
  sshForm,
  hostName,
  authType,
  selectedKeyRef,
  sshStatus,
  sshConnected,
  sshTabs,
  activeTerminalMode,
  focusTerminal,
  nav,
  ensureActiveSshSession,
  saveSshTabs,
  saveSessionRestoreState,
  focusTerminalView: () => focusNativeTerminal(),
  writeTerminalLine: (text: string) => writeTerminalLine(text),
  syncQuickConnectForm: () => syncQuickConnectForm(),
  createSshTab,
})

connectSSH = sshConnection.connectSSH
connectSSHFromHosts = sshConnection.connectSSHFromHosts

const {
  snippetsLoaded,
  snippetKeyword,
  snippetCategory,
  snippetStatus,
  snippetRunDelayMs,
  snippetRunning,
  selectedSnippetId,
  snippetEditorVisible,
  snippetEdit,
  newSnippetCategoryName,
  newSnippetCategoryInputVisible,
  terminalSnippetId,
  snippetCategories,
  displaySnippetCategories,
  filteredSnippetItems,
  terminalSnippetItems,
  restoreSnippets,
  openSnippetEditor,
  clearSnippetEditor,
  beginAddSnippetCategory,
  addSnippetCategory,
  saveSnippet,
  deleteSnippet,
  snippetCommandLines,
  runSnippet,
  stopSnippet,
  snippetHostLabel,
  runTerminalSnippet,
  sendSnippetRawToTerminal,
} = useSnippetManager({
  hostItems,
  sshForm,
  sshConnected,
  sshSessionId,
  activeTerminalMode,
  serialConnected,
  serialCurrentPath,
  localConnected,
  activeLocalSessionId,
  useHost,
  connectSSH,
  focusTerminal: () => focusNativeTerminal(),
})

const terminalRuntime = useTerminalRuntime({
  termEl,
  focusTerminal,
  activeTerminalMode,
  sshConnected,
  sshSessionId,
  sshTabs,
  getSshBuffer,
  appendSshBuffer,
  clearSessionDecoders: (sessionId: string) => clearSessionDecoders(sessionId),
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
  terminalEncodingStorageKey: TERMINAL_ENCODING_STORAGE_KEY,
})

terminalEncoding = terminalRuntime.terminalEncoding
terminalModeLabel = terminalRuntime.terminalModeLabel
terminalTargetLabel = terminalRuntime.terminalTargetLabel
loadTerminalEncoding = terminalRuntime.loadTerminalEncoding
clearSessionDecoders = terminalRuntime.clearSessionDecoders
renderActiveSshBuffer = terminalRuntime.renderActiveSshBuffer
initTerminal = terminalRuntime.initTerminal
applyTerminalTheme = terminalRuntime.applyTerminalTheme
syncLocalTerminalSize = terminalRuntime.syncLocalTerminalSize
readClipboardText = terminalRuntime.readClipboardText
copyTerminalSelection = terminalRuntime.copyTerminalSelection
pasteToTerminal = terminalRuntime.pasteToTerminal
selectAllTerminal = terminalRuntime.selectAllTerminal
handleTerminalHotkeys = terminalRuntime.handleTerminalHotkeys
focusNativeTerminal = terminalRuntime.focusNativeTerminal
resetTerminal = terminalRuntime.resetTerminal
writeTerminal = terminalRuntime.writeTerminal
writeTerminalLine = terminalRuntime.writeTerminalLine
fitTerminal = terminalRuntime.fitTerminal
getTerminalSize = terminalRuntime.getTerminalSize

const {
  loadLocalFs,
  loadRightLocalFs,
  loadSftp,
  loadLeftSftp,
  toggleLeftConnectPanel,
  toggleRightConnectPanel,
  connectLeftPanel,
  connectSftp,
  openLeftItem,
  localGoUp,
  openRightItem,
  onLeftDrop,
  onRightDrop,
  onLeftDragStart,
  onRightDragStart,
  showRemoteMenu,
  hideRemoteMenu,
  menuDownload,
  menuRename,
  menuDelete,
  promptMkdirSftp,
  remoteGoUp,
} = useSftpWorkspace({
  hostItems,
  isWindowsClient,
  localPath,
  localRows,
  localFsLoaded,
  rightLocalPath,
  rightLocalRows,
  rightLocalFsLoaded,
  selectedLocalFile,
  selectedRemoteFile,
  sftpPath,
  sftpRows,
  sftpStatus,
  sftpHostId,
  sftpConnected,
  rightConnectPanelOpen,
  rightConnectTarget,
  sftpDragLocalPath,
  sftpDragRemoteFile,
  sftpUploadProgress,
  sftpDownloadProgress,
  sftpNewDirName,
  sftpRenameTo,
  remoteMenu,
  leftPanelMode,
  leftConnectPanelOpen,
  leftConnectTarget,
  leftConnectCategory,
  leftConnectKeyword,
  leftSftpHostId,
  leftSftpPath,
  leftSftpRows,
  rightPanelMode,
  rightConnectCategory,
  rightConnectKeyword,
  getLocalParentPath,
  allCategory: ALL_CATEGORY,
})

const {
  textMenu,
  openTerminalContextMenu,
  openEditorContextMenu,
  hideAllMenus,
  copyFromTextMenu,
  cutFromTextMenu,
  pasteFromTextMenu,
  selectAllFromTextMenu,
} = useTextContextMenu({
  sshStatus,
  hideRemoteMenu,
  readClipboardText,
  copyTerminalSelection,
  pasteToTerminal,
  selectAllTerminal,
})

const sftpPanelVm = {
  allCategory: ALL_CATEGORY,
  hostCategories,
  sftpConnected,
  sftpTransferModeLabel,
  sftpStatus,
  leftPanelStateLabel,
  leftLinkLabel,
  leftPanelMode,
  leftLocalPathDisplay,
  leftSftpPath,
  leftDisplayRows,
  rightPanelStateLabel,
  rightLinkLabel,
  rightPanelMode,
  rightLocalPathDisplay,
  sftpPath,
  rightDisplayRows,
  onLeftDrop,
  localGoUp,
  loadLocalFs,
  loadLeftSftp,
  toggleLeftConnectPanel,
  localSortBy,
  leftConnectPanelOpen,
  leftConnectCategory,
  leftConnectKeyword,
  leftConnectTarget,
  leftConnectGroups,
  connectLeftPanel,
  leftFileKeyword,
  selectedLocalFile,
  selectedRemoteFile,
  openLeftItem,
  onLeftDragStart,
  onRightDrop,
  remoteGoUp,
  loadSftp,
  promptMkdirSftp,
  toggleRightConnectPanel,
  remoteSortBy,
  rightConnectPanelOpen,
  rightConnectCategory,
  rightConnectKeyword,
  rightConnectTarget,
  rightConnectGroups,
  connectSftp,
  rightFileKeyword,
  openRightItem,
  showRemoteMenu,
  onRightDragStart,
  remoteMenu,
  formatFsTime,
  menuDownload,
  menuRename,
  menuDelete,
}

const snippetsPanelVm = {
  snippetRunDelayMs,
  beginAddSnippetCategory,
  newSnippetCategoryInputVisible,
  newSnippetCategoryName,
  addSnippetCategory,
  displaySnippetCategories,
  snippetCategory,
  snippetKeyword,
  clearSnippetEditor,
  filteredSnippetItems,
  selectedSnippetId,
  openSnippetEditor,
  snippetHostLabel,
  snippetCommandLines,
  runSnippet,
  snippetRunning,
  snippetEditorVisible,
  snippetEdit,
  snippetCategories,
  hostItems,
  openEditorContextMenu,
  deleteSnippet,
  stopSnippet,
  saveSnippet,
  snippetStatus,
}

const logsPanelVm = {
  refreshAuditLogs,
  clearAuditLogs,
  auditSource,
  auditKeyword,
  auditStatus,
  auditTargetGroups,
  selectedAuditTarget,
  formatAuditSource,
  formatAuditTime,
  currentAuditLogs,
  formatAuditAction,
}

const serialPanelVm = {
  serialPorts,
  serialBaudRates,
  serialForm,
  serialBaudPreset,
  serialSendText,
  serialHexMode,
  serialTimerMs,
  serialFlowControl,
  serialAdvancedOpen,
  serialConnected,
  serialDialogLogs,
  serialTimerActive,
  serialConnectionInfo,
  terminalEncoding,
  formatAuditTime,
  loadSerialPorts,
  openSerial,
  sendSerial,
  closeSerial,
  toggleTimerSend,
}

const localPanelVm = {
  focusTerminal,
  isWindowsClient,
  localTabs,
  activeLocalTabId,
  localShellType,
  localElevated,
  localConnected,
  localStatus,
  localQuickCategory,
  localQuickEditId,
  localQuickEditorVisible,
  localQuickDraftCategory,
  localQuickDraftLabel,
  localQuickDraftCmd,
  localQuickCategories,
  filteredLocalQuickItems,
  switchLocalTab,
  connectLocalTerminal,
  closeLocalTab,
  disconnectLocalTerminal,
  runLocalQuickCommand,
  startEditLocalQuickItem,
  resetLocalQuickDraft,
  openLocalQuickCreate,
  closeLocalQuickEditor,
  saveLocalQuickDraft,
  removeLocalQuickItem,
}

const {
  vaultMaster,
  vaultStatus,
  bridgeReady,
  vaultInitialized,
  vaultUnlocked,
  vaultItems,
  selectedVaultKeyId,
  vaultKeyword,
  vaultKeyName,
  vaultPrivateKey,
  vaultPublicKey,
  vaultCertificate,
  vaultKeyType,
  vaultEditorVisible,
  vaultKeysLoaded,
  filteredVaultItems,
  checkVault: checkVaultStatus,
  initVault,
  unlockVault,
  resetVault: resetVaultBase,
  clearVaultEditor,
  openVaultEditor,
  saveVaultKey,
  importVaultKeyFile,
  refreshVaultKeys,
} = useVaultManager({
  formatAppError,
})

const hostsPanelVm = {
  defaultCategory: DEFAULT_CATEGORY,
  allCategory: ALL_CATEGORY,
  quickConnectInput,
  connectSSHFromHosts,
  saveCurrentHost,
  beginAddCategory,
  newCategoryInputVisible,
  newCategoryName,
  addCategory,
  displayCategories,
  selectedCategory,
  renameCategoryInline,
  hostKeyword,
  hostProbeRunning,
  filteredHosts,
  probeFilteredHosts,
  openCreateHostEditor,
  hostItems,
  selectedHostId,
  useHost,
  openHostTerminal,
  hostProbeTitle,
  testHostReachability,
  hostProbeClass,
  openHostEditor,
  hostEditorVisible,
  editingHost,
  hostCategories,
  editPasswordVisible,
  vaultItems,
  saveEditedHost,
  deleteCurrentHost,
}

const {
  storageDbPath,
  storagePathInput,
  storageMsg,
  storageMetaText,
  backupItems,
  selectedBackupPath,
  dbFolderFromPath,
  refreshStorageInfo: refreshStorageInfoRaw,
  refreshStorageOverview: refreshStorageOverviewRaw,
  refreshStorageDataNow: refreshStorageDataNowRaw,
  scheduleStorageDataRefresh: scheduleStorageDataRefreshRaw,
  pickStorageFile,
  pickStorageFolder,
  applyStoragePath: applyStoragePathRaw,
  refreshBackupList,
  createDataBackup,
  openBackupsFolder,
  restoreDataBackup: restoreDataBackupRaw,
  clearStorageDataRefreshTimer,
} = useStorageManager({
  formatAppError,
  nav,
  snippetsLoaded,
  restoreSnippets,
  vaultUnlocked,
  vaultKeysLoaded,
  refreshVaultKeys,
  refreshHosts: async () => refreshHosts(),
})

const {
  syncEnabled,
  syncProvider,
  syncTargetPath,
  syncBaseUrl,
  syncToken,
  syncAutoPullOnStartup,
  syncAutoPushOnChange,
  syncDebounceMs,
  syncBusy,
  syncMsg,
  syncQueueItems,
  syncState,
  syncRemoteMeta,
  syncQueueCount,
  syncRuntimeStatusText,
  syncStatusText,
  formatSyncTime,
  mergeSyncStatus,
  refreshSyncStatus,
  refreshSyncQueue,
  saveSyncConfig,
  pickSyncFile,
  pickSyncSaveFile,
  pickSyncFolder,
  testSyncConnection,
  syncPullNow,
  syncPushNow,
  syncRetryFailed,
  clearSyncQueue,
  runStartupSyncPull,
} = useSyncManager({
  refreshStorageDataNow: async () => refreshStorageDataNowRaw(),
})

void refreshSyncStatus()
void refreshSyncQueue()

const {
  startupGateVisible,
  startupGateMode,
  startupGateBusy,
  startupGateError,
  startupDbPath,
  startupMasterConfirm,
  beginStartupInit,
  evaluateVaultGate,
  pickStartupDbPath,
  pickStartupDbSavePath,
  pickStartupDbFolder,
  useCurrentDbPath,
  runUseExistingStorage,
  runStartupInit,
  runStartupUnlock,
  runPostUnlockStartupTasks,
  ensureStartupDbPath,
} = useStartupGate({
  storageDbPath,
  dbFolderFromPath,
  vaultMaster,
  vaultStatus,
  vaultInitialized,
  vaultUnlocked,
  refreshVaultKeys,
  initVault,
  unlockVault,
  refreshHosts: async () => refreshHosts(),
  refreshStorageOverview: async () => refreshStorageOverviewRaw(
    ensureStartupDbPath,
    (message) => { startupGateError.value = message },
  ),
  refreshUpdateState,
  snippetStatus,
  formatAppError,
})

const {
  refreshStorageDataNow,
  scheduleStorageDataRefresh,
  applyStoragePath,
  restoreDataBackup,
  resetVault,
  handleNavChange,
  handleStartupGateVisibleChange,
  bootstrapStartupState,
} = useAppStartupLifecycle({
  startupGateVisible,
  startupGateMode,
  startupGateError,
  startupGateVisibleRef: startupGateVisible,
  sessionRestoreTried,
  startupGateEnsureDbPath: ensureStartupDbPath,
  runPostUnlockStartupTasks,
  evaluateVaultGate,
  checkVaultStatus,
  resetVaultBase,
  restoreSessionRestoreState,
  localConnected,
  localCwd,
  connectLocalTerminal,
  sshForm,
  hostName,
  authType,
  selectedKeyRef,
  connectSSH,
  vaultUnlocked,
  vaultKeysLoaded,
  refreshVaultKeys,
  cancelHostProbe,
  localFsLoaded,
  loadLocalFs,
  rightLocalFsLoaded,
  rightPanelMode,
  loadRightLocalFs,
  snippetsLoaded,
  restoreSnippets,
  serialPortsLoaded,
  loadSerialPorts,
  updateStateLoaded,
  refreshUpdateState,
  refreshAuditLogs,
  refreshStorageInfoRaw,
  refreshStorageDataNowRaw,
  scheduleStorageDataRefreshRaw,
  applyStoragePathRaw,
  restoreDataBackupRaw,
  formatAppError,
  restoreSshTabs,
  restoreLocalQuickItems,
  resetLocalQuickDraft,
  loadTerminalEncoding,
  refreshBackupList,
  runStartupSyncPull,
})

const settingsPanelVm = {
  updateInfo,
  updateActionBusy,
  showManualMacUpdate,
  updateStatusText,
  checkAppUpdate,
  downloadAppUpdate,
  installAppUpdate,
  refreshUpdateState,
  openManualUpdateLink,
  storageDbPath,
  storagePathInput,
  pickStorageFile,
  pickStorageFolder,
  applyStoragePath,
  refreshStorageDataNow,
  storageMsg,
  storageMetaText,
  createDataBackup,
  refreshBackupList,
  openBackupsFolder,
  selectedBackupPath,
  backupItems,
  restoreDataBackup,
  syncEnabled,
  syncProvider,
  syncTargetPath,
  syncBaseUrl,
  syncToken,
  syncAutoPullOnStartup,
  syncAutoPushOnChange,
  syncDebounceMs,
  syncBusy,
  syncMsg,
  syncState,
  syncRemoteMeta,
  syncQueueItems,
  syncQueueCount,
  syncStatusText,
  formatSyncTime,
  saveSyncConfig,
  refreshSyncStatus,
  refreshSyncQueue,
  pickSyncFile,
  pickSyncSaveFile,
  pickSyncFolder,
  testSyncConnection,
  syncPullNow,
  syncPushNow,
  syncRetryFailed,
  clearSyncQueue,
}

const vaultPanelVm = {
  vaultMaster,
  vaultStatus,
  bridgeReady,
  vaultInitialized,
  vaultUnlocked,
  selectedVaultKeyId,
  vaultKeyword,
  vaultKeyName,
  vaultPrivateKey,
  vaultPublicKey,
  vaultCertificate,
  vaultKeyType,
  vaultEditorVisible,
  filteredVaultItems,
  initVault,
  unlockVault,
  resetVault,
  clearVaultEditor,
  openVaultEditor,
  saveVaultKey,
  importVaultKeyFile,
  refreshVaultKeys,
}

const bindTermEl = (el: Element | null) => {
  termEl.value = el instanceof HTMLElement ? el : null
}

const exitTerminalView = () => {
  focusTerminal.value = false
}

const selectNav = (target: NavKey) => {
  focusTerminal.value = false
  nav.value = target
}

const openSnippetsPanel = () => {
  nav.value = 'snippets'
  focusTerminal.value = false
}

const focusSshSession = (id: string) => {
  switchSshTab(id)
  focusTerminal.value = true
}

const createAndFocusSshTab = () => {
  createSshTab()
  focusTerminal.value = true
}

const terminalWorkspaceVm = {
  focusTerminal,
  terminalModeLabel,
  terminalTargetLabel,
  activeTerminalMode,
  sshTabs,
  sshSessionId,
  localTabs,
  activeLocalTabId,
  terminalEncoding,
  terminalSnippetId,
  terminalSnippetItems,
  snippetRunning,
  snippetKeyword,
  switchSshTab,
  closeSshTab,
  createSshTab,
  switchLocalTab,
  closeLocalTab,
  connectLocalTerminal,
  selectAllTerminal,
  copyTerminalSelection,
  pasteToTerminal,
  disconnectLocalTerminal,
  runTerminalSnippet,
  sendSnippetRawToTerminal,
  closeSerial,
  openTerminalContextMenu,
  snippetCommandLines,
  bindTermEl,
  exitTerminalView,
  openSnippetsPanel,
  focusSshSession,
  createAndFocusSshTab,
}

const sidebarVm = {
  nav,
  selectNav,
}

const textContextMenuVm = {
  textMenu,
  cutFromTextMenu,
  copyFromTextMenu,
  pasteFromTextMenu,
  selectAllFromTextMenu,
}

const statusText = computed(() => snippetStatus.value || sftpStatus.value || sshStatus.value || localStatus.value || syncRuntimeStatusText.value || auditStatus.value || '就绪')

const statusBarVm = {
  statusText,
  sftpUploadProgress,
  sftpDownloadProgress,
}

const startupGateVm = {
  storageDbPath,
  vaultMaster,
  vaultStatus,
  plainVaultMessage,
  startupGateVisible,
  startupGateMode,
  startupGateBusy,
  startupGateError,
  startupDbPath,
  startupMasterConfirm,
  beginStartupInit,
  pickStartupDbPath,
  pickStartupDbSavePath,
  pickStartupDbFolder,
  useCurrentDbPath,
  runUseExistingStorage,
  runStartupInit,
  runStartupUnlock,
}

watch(nav, (value) => {
  void handleNavChange(value)
})

watch(startupGateVisible, (visible) => {
  handleStartupGateVisibleChange(visible)
})

useWindowBridgeEvents({
  bootstrapStartupState,
  fitTerminal,
  getTerminalSize,
  activeTerminalMode,
  sshConnected,
  sshSessionId,
  syncLocalTerminalSize,
  sftpUploadProgress,
  sftpDownloadProgress,
  mergeUpdateState,
  mergeSyncStatus,
  scheduleStorageDataRefresh,
  appendAuditLog,
  hideAllMenus,
  handleTerminalHotkeys,
  cancelHostProbe,
  clearStorageDataRefreshTimer,
  disposeSerial,
  disconnectAllLocalTabs,
})
</script>

<template>
  <div class="layout" :class="{ 'terminal-layout': focusTerminal }">
    <AppSidebar :vm="sidebarVm" />

    <main class="main">
      <TerminalWorkspace :vm="terminalWorkspaceVm" />

      <HostsPanel v-if="!focusTerminal && nav === 'hosts'" :vm="hostsPanelVm" />

      <SftpPanel v-else-if="!focusTerminal && nav === 'sftp'" :vm="sftpPanelVm" />

      <SnippetsPanel v-else-if="!focusTerminal && nav === 'snippets'" :vm="snippetsPanelVm" />

      <SerialPanel v-else-if="!focusTerminal && nav === 'serial'" :vm="serialPanelVm" />

      <LocalPanel v-else-if="!focusTerminal && nav === 'local'" :vm="localPanelVm" />

      <VaultPanel v-else-if="!focusTerminal && nav === 'vault'" :vm="vaultPanelVm" />

      <SettingsPanel v-else-if="!focusTerminal && nav === 'settings'" :vm="settingsPanelVm" />

      <LogsPanel v-else-if="!focusTerminal && nav === 'logs'" :vm="logsPanelVm" />

      <section v-else-if="!focusTerminal" class="panel"><h3>模块建设中</h3><p>当前页面：{{ nav }}</p></section>

      <TextContextMenu :vm="textContextMenuVm" />
    </main>

    <AppStatusBar :vm="statusBarVm" />

    <StartupGateOverlay :vm="startupGateVm" />
  </div>
</template>
