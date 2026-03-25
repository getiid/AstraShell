import type { Ref } from 'vue'
import { useSftpActions } from './useSftpActions'

type PanelMode = 'local' | 'remote'

type LocalSshConfig = {
  host: string
  port?: number
  username: string
  password?: string
  privateKey?: string
}

type UseSftpWorkspaceParams = {
  hostItems: Ref<any[]>
  isWindowsClient: Readonly<Ref<boolean>>
  localPath: Ref<string>
  localRows: Ref<any[]>
  localFsLoaded: Ref<boolean>
  rightLocalPath: Ref<string>
  rightLocalRows: Ref<any[]>
  rightLocalFsLoaded: Ref<boolean>
  selectedLocalFile: Ref<string>
  selectedRemoteFile: Ref<string>
  sftpPath: Ref<string>
  sftpRows: Ref<any[]>
  sftpStatus: Ref<string>
  sftpHostId: Ref<string>
  sftpConnected: Ref<boolean>
  rightConnectPanelOpen: Ref<boolean>
  rightConnectTarget: Ref<string>
  sftpDragLocalPath: Ref<string>
  sftpDragRemoteFile: Ref<string>
  sftpUploadProgress: Ref<number>
  sftpDownloadProgress: Ref<number>
  sftpNewDirName: Ref<string>
  sftpRenameTo: Ref<string>
  remoteMenu: Ref<{ visible: boolean; x: number; y: number; filename: string }>
  leftPanelMode: Ref<PanelMode>
  leftConnectPanelOpen: Ref<boolean>
  leftConnectTarget: Ref<string>
  leftConnectCategory: Ref<string>
  leftConnectKeyword: Ref<string>
  leftSftpHostId: Ref<string>
  leftSftpPath: Ref<string>
  leftSftpRows: Ref<any[]>
  rightPanelMode: Ref<PanelMode>
  rightConnectCategory: Ref<string>
  rightConnectKeyword: Ref<string>
  getLocalParentPath: (rawPath: string) => string
  allCategory: string
}

export function useSftpWorkspace(params: UseSftpWorkspaceParams) {
  const {
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
    allCategory,
  } = params

  const loadLocalFs = async () => {
    const res = await window.lightterm.localfsList({ localPath: localPath.value || undefined })
    if (!res.ok) {
      if (localPath.value) {
        localPath.value = ''
        return loadLocalFs()
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
        return loadRightLocalFs()
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

  const {
    loadSftp,
    uploadSftp,
    downloadSftp,
    mkdirSftp,
    renameSftp,
    deleteSftp,
  } = useSftpActions({
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
    await loadSftp()
  }

  const openLocalItem = async (item: any) => {
    if (!item?.isDir) {
      selectedLocalFile.value = item.path
      return
    }
    localPath.value = item.path
    await loadLocalFs()
  }

  const openLeftRemoteItem = async (item: any) => {
    if (!item?.isDir) return
    leftSftpPath.value = `${leftSftpPath.value.replace(/\/$/, '')}/${item.filename}`
    await loadLeftSftp()
  }

  const openLeftItem = async (item: any) => {
    if (leftPanelMode.value === 'local') {
      await openLocalItem(item)
      return
    }
    await openLeftRemoteItem(item)
  }

  const localGoUp = async () => {
    if (leftPanelMode.value === 'remote') {
      const parts = leftSftpPath.value.split('/').filter(Boolean)
      leftSftpPath.value = parts.length ? `/${parts.slice(0, -1).join('/')}` || '/' : '/'
      await loadLeftSftp()
      return
    }
    if (!localPath.value) {
      if (isWindowsClient.value) await loadLocalFs()
      return
    }
    localPath.value = getLocalParentPath(localPath.value)
    await loadLocalFs()
  }

  const openRightLocalItem = async (item: any) => {
    if (!item?.isDir) return
    rightLocalPath.value = item.path
    await loadRightLocalFs()
  }

  const hideRemoteMenu = () => {
    remoteMenu.value.visible = false
  }

  const openRemoteItem = async (item: any) => {
    hideRemoteMenu()
    if (item?.isDir) {
      sftpPath.value = `${sftpPath.value.replace(/\/$/, '')}/${item.filename}`
      await loadSftp()
      return
    }
    selectedRemoteFile.value = item.filename
  }

  const openRightItem = async (item: any) => {
    if (rightPanelMode.value === 'local') {
      await openRightLocalItem(item)
      return
    }
    await openRemoteItem(item)
  }

  const onLocalDragStart = (item: any) => {
    if (item?.isDir) return
    sftpDragLocalPath.value = item.path
  }

  const onRemoteDragStart = (item: any) => {
    if (item?.isDir) return
    sftpDragRemoteFile.value = item.filename
  }

  const onRemoteDrop = async () => {
    if (!sftpDragLocalPath.value) return
    selectedLocalFile.value = sftpDragLocalPath.value
    await uploadSftp()
    sftpDragLocalPath.value = ''
  }

  const onLocalDrop = async () => {
    const { config, error } = await getSftpConfig()
    if (!config) {
      sftpStatus.value = error || '请先选择并连接 SSH 服务器'
      return
    }
    if (!sftpDragRemoteFile.value) return
    if (isWindowsClient.value && !localPath.value) {
      sftpStatus.value = '请先进入左侧具体盘符目录，再接收下载文件'
      return
    }
    const remoteFile = `${sftpPath.value.replace(/\/$/, '')}/${sftpDragRemoteFile.value}`
    const res = await window.lightterm.sftpDownloadToLocal({
      ...config,
      remoteFile,
      localDir: localPath.value || '',
      filename: sftpDragRemoteFile.value,
      conflictPolicy: 'resume',
      resume: true,
    })
    sftpStatus.value = res.ok ? `拖拽下载成功：${res.filePath}` : `拖拽下载失败：${res.error}`
    sftpDragRemoteFile.value = ''
    if (res.ok) await loadLocalFs()
  }

  const onLeftDrop = async () => {
    if (leftPanelMode.value === 'local' && rightPanelMode.value === 'remote') {
      await onLocalDrop()
      return
    }
    sftpStatus.value = '当前左右组合暂不支持此拖拽操作'
  }

  const onRightDrop = async () => {
    if (leftPanelMode.value === 'local' && rightPanelMode.value === 'remote') {
      await onRemoteDrop()
      return
    }
    sftpStatus.value = '当前左右组合暂不支持此拖拽操作'
  }

  const onLeftDragStart = (item: any) => {
    if (leftPanelMode.value !== 'local') return
    onLocalDragStart(item)
  }

  const onRightDragStart = (item: any) => {
    if (rightPanelMode.value === 'remote') {
      onRemoteDragStart(item)
      return
    }
    onLocalDragStart(item)
  }

  const showRemoteMenu = (event: MouseEvent, item: any) => {
    event.preventDefault()
    selectedRemoteFile.value = item.filename
    remoteMenu.value = { visible: true, x: event.clientX, y: event.clientY, filename: item.filename }
  }

  const menuDownload = async () => {
    hideRemoteMenu()
    await downloadSftp()
  }

  const menuRename = async () => {
    hideRemoteMenu()
    const next = window.prompt('重命名为', selectedRemoteFile.value)
    if (!next) return
    sftpRenameTo.value = next
    await renameSftp()
  }

  const menuDelete = async () => {
    hideRemoteMenu()
    await deleteSftp()
  }

  const promptMkdirSftp = async () => {
    const name = window.prompt('新目录名', '')
    if (!name) return
    sftpNewDirName.value = name
    await mkdirSftp()
  }

  const remoteGoUp = async () => {
    if (rightPanelMode.value === 'local') {
      if (!rightLocalPath.value) {
        if (isWindowsClient.value) await loadRightLocalFs()
        return
      }
      rightLocalPath.value = getLocalParentPath(rightLocalPath.value)
      await loadRightLocalFs()
      return
    }
    const parts = sftpPath.value.split('/').filter(Boolean)
    sftpPath.value = parts.length ? `/${parts.slice(0, -1).join('/')}` || '/' : '/'
    await loadSftp()
  }

  return {
    loadLocalFs,
    loadRightLocalFs,
    loadSftp,
    uploadSftp,
    downloadSftp,
    mkdirSftp,
    renameSftp,
    deleteSftp,
    loadLeftSftp,
    toggleLeftConnectPanel,
    toggleRightConnectPanel,
    connectLeftPanel,
    connectSftp,
    openLocalItem,
    openLeftRemoteItem,
    openLeftItem,
    localGoUp,
    openRightLocalItem,
    openRightItem,
    openRemoteItem,
    onLeftDrop,
    onRightDrop,
    onLeftDragStart,
    onRightDragStart,
    onLocalDragStart,
    onRemoteDragStart,
    onRemoteDrop,
    onLocalDrop,
    showRemoteMenu,
    hideRemoteMenu,
    menuDownload,
    menuRename,
    menuDelete,
    promptMkdirSftp,
    remoteGoUp,
  }
}
