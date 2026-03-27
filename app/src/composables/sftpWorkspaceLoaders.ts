import { useSftpActions } from './useSftpActions'
import type { LocalSshConfig, UseSftpWorkspaceParams } from './sftpWorkspaceTypes'

export function createSftpWorkspaceLoaders(params: UseSftpWorkspaceParams) {
  const {
    hostItems,
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
    sftpUploadProgress,
    sftpDownloadProgress,
    sftpNewDirName,
    sftpRenameTo,
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
    allCategory,
  } = params

  const loadLocalFs = async () => {
    const res = await window.lightterm.localfsList({ localPath: localPath.value || undefined })
    if (!res.ok) {
      if (localPath.value) {
        localPath.value = ''
        await loadLocalFs()
        return
      }
      localRows.value = []
      sftpStatus.value = `本地目录读取失败：${res.error || '未知错误'}`
      return
    }
    localPath.value = res.path || localPath.value
    localRows.value = res.items || []
    localFsLoaded.value = true
  }

  const loadRightLocalFs = async () => {
    const res = await window.lightterm.localfsList({ localPath: rightLocalPath.value || undefined })
    if (!res.ok) {
      if (rightLocalPath.value) {
        rightLocalPath.value = ''
        await loadRightLocalFs()
        return
      }
      rightLocalRows.value = []
      sftpStatus.value = `右侧本地读取失败：${res.error || '未知错误'}`
      return
    }
    rightLocalPath.value = res.path || rightLocalPath.value
    rightLocalRows.value = res.items || []
    rightLocalFsLoaded.value = true
  }

  const getSftpConfigByHostId = async (hostId: string) => {
    const host = hostItems.value.find((item) => item.id === hostId)
    if (!host) return { error: '请选择 SSH 服务器' }

    const config: LocalSshConfig = {
      host: host.host,
      port: Number(host.port || 22),
      username: host.username,
      password: host.password || undefined,
    }

    if (host.auth_type === 'key') {
      if (!host.private_key_ref) return { error: '该主机未绑定密钥' }
      const keyRes = await window.lightterm.vaultKeyGet({ id: host.private_key_ref })
      if (!keyRes.ok) return { error: keyRes.error || '读取密钥失败' }
      const privateKey = keyRes.item?.privateKey
      if (!privateKey) return { error: '密钥内容为空' }
      config.privateKey = privateKey
    }

    return { config }
  }

  const getSftpConfig = async () => getSftpConfigByHostId(sftpHostId.value)

  const sftpActions = useSftpActions({
    sftpPath,
    sftpRows,
    sftpStatus,
    rightPanelMode,
    selectedLocalFile,
    sftpUploadProgress,
    selectedRemoteFile,
    sftpDownloadProgress,
    sftpNewDirName,
    sftpRenameTo,
    loadRightLocalFs,
    getSftpConfig,
  })

  const loadLeftSftp = async () => {
    if (!leftSftpHostId.value) {
      sftpStatus.value = '请选择左侧 SSH 服务器'
      return
    }
    const { config, error } = await getSftpConfigByHostId(leftSftpHostId.value)
    if (!config) {
      sftpStatus.value = error || '请选择左侧 SSH 服务器'
      return
    }
    const res = await window.lightterm.sftpList({ ...config, remotePath: leftSftpPath.value })
    if (!res.ok) {
      sftpStatus.value = `左侧读取失败：${res.error}`
      return
    }
    leftSftpRows.value = res.items || []
  }

  const toggleLeftConnectPanel = () => {
    leftConnectPanelOpen.value = !leftConnectPanelOpen.value
    if (!leftConnectPanelOpen.value) return
    leftConnectCategory.value = allCategory
    leftConnectKeyword.value = ''
    leftConnectTarget.value = leftPanelMode.value === 'local' ? 'local' : leftSftpHostId.value
  }

  const toggleRightConnectPanel = () => {
    rightConnectPanelOpen.value = !rightConnectPanelOpen.value
    if (!rightConnectPanelOpen.value) return
    rightConnectCategory.value = allCategory
    rightConnectKeyword.value = ''
    rightConnectTarget.value = rightPanelMode.value === 'local' ? 'local' : sftpHostId.value
  }

  const connectLeftPanel = async () => {
    if (leftConnectTarget.value === 'local') {
      leftPanelMode.value = 'local'
      leftConnectPanelOpen.value = false
      await loadLocalFs()
      sftpStatus.value = '左侧已切换到本地目录'
      return
    }
    leftSftpHostId.value = leftConnectTarget.value
    leftSftpPath.value = '.'
    leftPanelMode.value = 'remote'
    leftConnectPanelOpen.value = false
    await loadLeftSftp()
    const host = hostItems.value.find((item) => item.id === leftSftpHostId.value)
    sftpStatus.value = host ? `左侧已连接：${host.host}` : '左侧已连接'
  }

  const connectSftp = async () => {
    const target = rightConnectTarget.value || (rightPanelMode.value === 'local' ? 'local' : sftpHostId.value)
    if (target === 'local') {
      rightPanelMode.value = 'local'
      rightConnectPanelOpen.value = false
      await loadRightLocalFs()
      sftpConnected.value = false
      sftpStatus.value = '右侧已切换到本地目录'
      return
    }
    if (!target) {
      sftpStatus.value = '请选择右侧 SSH 服务器'
      return
    }
    sftpHostId.value = target
    rightPanelMode.value = 'remote'
    const { config, error } = await getSftpConfig()
    if (!config) {
      sftpStatus.value = error || '请选择 SSH 服务器'
      sftpConnected.value = false
      return
    }
    sftpConnected.value = true
    rightConnectPanelOpen.value = false
    sftpStatus.value = `已连接：${config.host}`
    await sftpActions.loadSftp()
  }

  return {
    ...sftpActions,
    loadLocalFs,
    loadRightLocalFs,
    getSftpConfig,
    loadLeftSftp,
    toggleLeftConnectPanel,
    toggleRightConnectPanel,
    connectLeftPanel,
    connectSftp,
  }
}
