import { ref, type Ref } from 'vue'

type UseStartupGateParams = {
  storageDbPath: Ref<string>
  dbFolderFromPath: (dbPath: string) => string
  vaultMaster: Ref<string>
  vaultStatus: Ref<string>
  vaultInitialized: Ref<boolean>
  vaultUnlocked: Ref<boolean>
  refreshVaultKeys: () => Promise<void>
  initVault: () => Promise<void>
  unlockVault: () => Promise<void>
  refreshHosts: () => Promise<unknown>
  refreshStorageOverview: () => Promise<void>
  refreshUpdateState: () => Promise<void>
  snippetStatus: Ref<string>
  formatAppError: (error: unknown) => string
}

export function useStartupGate(params: UseStartupGateParams) {
  const {
    storageDbPath,
    dbFolderFromPath,
    vaultMaster,
    vaultStatus,
    vaultInitialized,
    vaultUnlocked,
    refreshVaultKeys,
    initVault,
    unlockVault,
    refreshHosts,
    refreshStorageOverview,
    refreshUpdateState,
    snippetStatus,
    formatAppError,
  } = params

  const startupGateVisible = ref(true)
  const startupGateMode = ref<'loading' | 'init' | 'unlock'>('loading')
  const startupGateBusy = ref(false)
  const startupGateError = ref('')
  const startupDbPath = ref('')
  const startupMasterConfirm = ref('')
  const startupTasksLoaded = ref(false)

  const plainVaultMessage = (msg: string) => String(msg || '').replace(/^[✅❌]\s*/, '').trim()

  const ensureStartupDbPath = () => {
    if (startupDbPath.value) return
    if (storageDbPath.value) startupDbPath.value = storageDbPath.value
  }

  const beginStartupInit = () => {
    ensureStartupDbPath()
    startupGateMode.value = 'init'
    startupGateError.value = ''
  }

  const evaluateVaultGate = () => {
    if (!vaultInitialized.value) {
      startupGateMode.value = 'init'
      startupGateVisible.value = true
      ensureStartupDbPath()
      return
    }
    if (!vaultUnlocked.value) {
      startupGateMode.value = 'unlock'
      startupGateVisible.value = true
      return
    }
    startupGateVisible.value = false
    startupGateError.value = ''
    startupMasterConfirm.value = ''
  }

  const pickStartupDbPath = async () => {}

  const pickStartupDbSavePath = async () => {}

  const pickStartupDbFolder = async () => {}

  const useCurrentDbPath = () => {
    startupDbPath.value = storageDbPath.value || dbFolderFromPath(storageDbPath.value)
    startupGateError.value = ''
  }

  const applyStartupStoragePath = async () => ({ ok: true, changed: false })

  const runUseExistingStorage = async () => {
    startupGateMode.value = 'unlock'
    startupGateError.value = ''
  }

  const runStartupInit = async () => {
    if (startupGateBusy.value) return
    ensureStartupDbPath()
    if (!vaultMaster.value) {
      startupGateError.value = '请设置主密码'
      return
    }
    if (vaultMaster.value !== startupMasterConfirm.value) {
      startupGateError.value = '两次输入的主密码不一致'
      return
    }
    startupGateBusy.value = true
    startupGateError.value = ''
    try {
      await initVault()
      if (!vaultUnlocked.value) {
        startupGateError.value = plainVaultMessage(vaultStatus.value) || '初始化失败'
        return
      }
      startupGateVisible.value = false
    } finally {
      startupGateBusy.value = false
    }
  }

  const runStartupUnlock = async () => {
    if (startupGateBusy.value) return
    if (!vaultMaster.value) {
      startupGateError.value = '请输入主密码'
      return
    }
    startupGateBusy.value = true
    startupGateError.value = ''
    try {
      await unlockVault()
      if (!vaultUnlocked.value) {
        startupGateError.value = plainVaultMessage(vaultStatus.value) || '解锁失败'
        return
      }
      startupGateVisible.value = false
    } finally {
      startupGateBusy.value = false
    }
  }

  const runPostUnlockStartupTasks = async () => {
    if (startupTasksLoaded.value) return
    if (startupGateVisible.value) return

    const tasks: Array<[string, () => Promise<unknown>]> = [
      ['主机列表', refreshHosts],
      ['存储信息', refreshStorageOverview],
      ['更新状态', refreshUpdateState],
    ]
    if (vaultUnlocked.value) tasks.push(['密钥列表', refreshVaultKeys])

    const failures: string[] = []
    const settled = await Promise.allSettled(tasks.map(async ([, task]) => await task()))
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') return
      const label = tasks[index]?.[0] || `任务${index + 1}`
      failures.push(`${label}加载失败：${formatAppError(result.reason)}`)
    })

    startupTasksLoaded.value = true
    if (failures.length > 0) {
      const message = failures[0] || '启动初始化失败'
      if (!snippetStatus.value) snippetStatus.value = message
      console.error('[startup]', failures)
    }
  }

  return {
    startupGateVisible,
    startupGateMode,
    startupGateBusy,
    startupGateError,
    startupDbPath,
    startupMasterConfirm,
    startupTasksLoaded,
    ensureStartupDbPath,
    beginStartupInit,
    evaluateVaultGate,
    pickStartupDbPath,
    pickStartupDbSavePath,
    pickStartupDbFolder,
    useCurrentDbPath,
    applyStartupStoragePath,
    runUseExistingStorage,
    runStartupInit,
    runStartupUnlock,
    runPostUnlockStartupTasks,
  }
}
