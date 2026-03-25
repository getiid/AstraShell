import { computed, ref } from 'vue'

export type UpdateStatePayload = Partial<{
  status: string
  message: string
  currentVersion: string
  latestVersion: string
  source: string
  hasUpdate: boolean
  downloaded: boolean
  checking: boolean
  downloading: boolean
  progress: number
  downloadUrl: string
  releaseUrl: string
}>

type UpdateActionResult = { ok: boolean; error?: string }

export function useUpdateManager() {
  const updateInfo = ref({
    status: 'idle',
    message: '等待检查更新',
    currentVersion: '',
    latestVersion: '',
    source: 'github',
    hasUpdate: false,
    downloaded: false,
    checking: false,
    downloading: false,
    progress: 0,
    downloadUrl: '',
    releaseUrl: '',
  })

  const updateActionBusy = ref(false)
  const updateStateLoaded = ref(false)
  const isMacClient = computed(() => typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || ''))
  const showManualMacUpdate = computed(() => (
    isMacClient.value
    && updateInfo.value.hasUpdate
    && !updateInfo.value.downloaded
    && !!updateInfo.value.downloadUrl
    && /手动安装|DMG/i.test(updateInfo.value.message || '')
  ))
  const updateStatusText = computed(() => {
    const current = updateInfo.value.currentVersion || '-'
    const latest = updateInfo.value.latestVersion || '-'
    return `当前版本：${current} ｜ 最新版本：${latest} ｜ 更新源：GitHub ｜ ${updateInfo.value.message || '就绪'}`
  })

  const mergeUpdateState = (payload: UpdateStatePayload = {}) => {
    const prev = updateInfo.value
    updateInfo.value = {
      status: payload.status ?? prev.status,
      message: payload.message ?? prev.message,
      currentVersion: payload.currentVersion ?? prev.currentVersion,
      latestVersion: payload.latestVersion ?? prev.latestVersion,
      source: payload.source ?? prev.source,
      hasUpdate: payload.hasUpdate ?? prev.hasUpdate,
      downloaded: payload.downloaded ?? prev.downloaded,
      checking: payload.checking ?? prev.checking,
      downloading: payload.downloading ?? prev.downloading,
      progress: Number(payload.progress ?? prev.progress ?? 0),
      downloadUrl: payload.downloadUrl ?? prev.downloadUrl,
      releaseUrl: payload.releaseUrl ?? prev.releaseUrl,
    }
  }

  const runUpdateAction = async (
    action: () => Promise<UpdateActionResult>,
    failurePrefix: string,
  ) => {
    updateActionBusy.value = true
    try {
      const res = await action()
      if (!res.ok) {
        mergeUpdateState({ message: `${failurePrefix}：${res.error || '未知错误'}` })
      }
    } finally {
      updateActionBusy.value = false
    }
  }

  const refreshUpdateState = async () => {
    const res = await window.lightterm.updateGetState()
    if (!res.ok) return
    mergeUpdateState(res)
    updateStateLoaded.value = true
  }

  const checkAppUpdate = async () => runUpdateAction(() => window.lightterm.updateCheck(), '检查更新失败')
  const downloadAppUpdate = async () => runUpdateAction(() => window.lightterm.updateDownload(), '下载更新失败')
  const installAppUpdate = async () => runUpdateAction(() => window.lightterm.updateInstall(), '安装更新失败')

  const openManualUpdateLink = async (url: string) => {
    if (!url) return
    const res = await window.lightterm.appOpenExternal({ url })
    if (!res.ok) {
      mergeUpdateState({ message: `打开下载链接失败：${res.error || '未知错误'}` })
    }
  }

  return {
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
  }
}
