import { computed, ref } from 'vue'

type UseVaultManagerParams = {
  formatAppError: (error: unknown) => string
}

export function useVaultManager(params: UseVaultManagerParams) {
  const { formatAppError } = params

  const vaultMaster = ref('')
  const vaultStatus = ref('')
  const bridgeReady = ref(typeof window !== 'undefined' && !!window.lightterm)
  const vaultInitialized = ref(false)
  const vaultUnlocked = ref(false)
  const vaultItems = ref<any[]>([])
  const selectedVaultKeyId = ref('')
  const vaultKeyword = ref('')
  const vaultKeyName = ref('')
  const vaultPrivateKey = ref('')
  const vaultPublicKey = ref('')
  const vaultCertificate = ref('')
  const vaultKeyType = ref('auto')
  const vaultEditorVisible = ref(true)
  const vaultKeysLoaded = ref(false)

  const filteredVaultItems = computed(() => {
    const keyword = vaultKeyword.value.trim().toLowerCase()
    if (!keyword) return vaultItems.value
    return vaultItems.value.filter((item) =>
      [item.name, item.type, item.fingerprint]
        .some((value) => String(value || '').toLowerCase().includes(keyword)),
    )
  })

  const clearVaultEditor = () => {
    selectedVaultKeyId.value = ''
    vaultKeyName.value = ''
    vaultPrivateKey.value = ''
    vaultPublicKey.value = ''
    vaultCertificate.value = ''
    vaultKeyType.value = 'auto'
    vaultEditorVisible.value = true
  }

  const refreshVaultKeys = async () => {
    const res = await window.lightterm.vaultKeyList()
    if (res.ok) {
      vaultItems.value = res.items || []
      vaultKeysLoaded.value = true
      if (selectedVaultKeyId.value && !vaultItems.value.some((item) => item.id === selectedVaultKeyId.value)) {
        clearVaultEditor()
      }
    }
  }

  const checkVault = async () => {
    if (!window.lightterm?.vaultStatus) {
      bridgeReady.value = false
      vaultStatus.value = '❌ 桌面桥接未加载（请完全退出 AstraShell 后重新打开桌面版 App）'
      return null
    }
    bridgeReady.value = true
    try {
      const res = await window.lightterm.vaultStatus()
      vaultInitialized.value = !!res.initialized
      vaultUnlocked.value = !!res.unlocked
      return res
    } catch (error) {
      bridgeReady.value = false
      vaultInitialized.value = false
      vaultUnlocked.value = false
      vaultStatus.value = `❌ 读取密钥仓库状态失败：${formatAppError(error)}`
      return null
    }
  }

  const initVault = async () => {
    try {
      if (!vaultMaster.value) {
        vaultStatus.value = '主密码不能为空'
        return
      }
      if (!window.lightterm?.vaultSetMaster) {
        bridgeReady.value = false
        vaultStatus.value = '❌ 桌面桥接未加载（当前不是可写入版本）'
        return
      }
      vaultStatus.value = '正在初始化仓库...'
      const res = await window.lightterm.vaultSetMaster({ masterPassword: vaultMaster.value })
      vaultStatus.value = res.ok ? '✅ 密钥仓库初始化成功（已解锁）' : `❌ 初始化失败：${res.error || '未知错误'}`
      await checkVault()
    } catch (error: any) {
      vaultStatus.value = `❌ 初始化异常：${error?.message || error}`
    }
  }

  const unlockVault = async () => {
    try {
      if (!vaultMaster.value) {
        vaultStatus.value = '请输入主密码'
        return
      }
      if (!window.lightterm?.vaultUnlock) {
        bridgeReady.value = false
        vaultStatus.value = '❌ 桌面桥接未加载（当前不是可写入版本）'
        return
      }
      vaultStatus.value = '正在解锁仓库...'
      const res = await window.lightterm.vaultUnlock({ masterPassword: vaultMaster.value })
      vaultStatus.value = res.ok ? '✅ 密钥仓库已解锁' : `❌ 解锁失败：${res.error || '未知错误'}`
      await checkVault()
      if (res.ok) await refreshVaultKeys()
    } catch (error: any) {
      vaultStatus.value = `❌ 解锁异常：${error?.message || error}`
    }
  }

  const resetVault = async () => {
    try {
      if (!window.lightterm?.vaultReset) {
        bridgeReady.value = false
        vaultStatus.value = '❌ 桌面桥接未加载（当前不是可写入版本）'
        return
      }
      vaultStatus.value = '正在重置仓库...'
      const res = await window.lightterm.vaultReset()
      vaultStatus.value = res.ok ? '✅ 密钥仓库已重置，请重新初始化' : `❌ 重置失败：${res.error || '未知错误'}`
      vaultMaster.value = ''
      await checkVault()
      await refreshVaultKeys()
      clearVaultEditor()
    } catch (error: any) {
      vaultStatus.value = `❌ 重置异常：${error?.message || error}`
    }
  }

  const openVaultEditor = async (item: any) => {
    if (!item?.id) return
    if (!vaultUnlocked.value) {
      vaultStatus.value = '请先解锁密钥仓库'
      return
    }
    const res = await window.lightterm.vaultKeyGet({ id: item.id })
    if (!res.ok) {
      vaultStatus.value = `读取密钥失败：${res.error || '未知错误'}`
      return
    }
    selectedVaultKeyId.value = item.id
    vaultKeyName.value = res.item?.name || item.name || ''
    vaultPrivateKey.value = res.item?.privateKey || ''
    vaultPublicKey.value = res.item?.publicKey || ''
    vaultCertificate.value = res.item?.certificate || ''
    vaultKeyType.value = res.item?.type || item.type || 'auto'
    vaultEditorVisible.value = true
  }

  const saveVaultKey = async () => {
    if (!vaultUnlocked.value) {
      vaultStatus.value = '请先解锁密钥仓库'
      return
    }
    const privateKey = vaultPrivateKey.value.trim()
    const publicKey = vaultPublicKey.value.trim()
    const certificate = vaultCertificate.value.trim()
    if (!privateKey && !publicKey && !certificate) {
      vaultStatus.value = '请至少填写私钥/公钥/证书中的一项'
      return
    }
    const res = await window.lightterm.vaultKeySave({
      id: selectedVaultKeyId.value || undefined,
      name: vaultKeyName.value || '未命名密钥',
      privateKey,
      publicKey,
      certificate,
      type: vaultKeyType.value,
    })
    vaultStatus.value = res.ok
      ? `密钥已保存（格式：${res.detectedType || vaultKeyType.value}）`
      : `保存失败：${res.error}`
    if (res.ok) {
      selectedVaultKeyId.value = res.id || selectedVaultKeyId.value
      await refreshVaultKeys()
      if (selectedVaultKeyId.value) {
        const current = vaultItems.value.find((item) => item.id === selectedVaultKeyId.value)
        if (current) await openVaultEditor(current)
      }
    }
  }

  const importVaultKeyFile = async () => {
    const res = await window.lightterm.vaultKeyImportFile()
    if (!res.ok) {
      vaultStatus.value = res.error || '导入失败'
      if (res.raw) {
        vaultPrivateKey.value = res.raw
        vaultKeyType.value = 'ppk'
      }
      return
    }
    vaultPrivateKey.value = res.content || ''
    vaultKeyType.value = res.detectedType || 'openssh'
    if (!vaultKeyName.value && res.filePath) {
      const parts = res.filePath.split('/')
      vaultKeyName.value = parts[parts.length - 1] || ''
    }
    vaultStatus.value = `已导入文件：${res.filePath}`
  }

  return {
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
    checkVault,
    initVault,
    unlockVault,
    resetVault,
    clearVaultEditor,
    openVaultEditor,
    saveVaultKey,
    importVaultKeyFile,
    refreshVaultKeys,
  }
}
