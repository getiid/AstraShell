import type { UseSftpWorkspaceParams } from './sftpWorkspaceTypes'

type DndDeps = {
  uploadSftp: () => Promise<void>
  downloadSftp: () => Promise<void>
  renameSftp: () => Promise<void>
  deleteSftp: () => Promise<void>
  mkdirSftp: () => Promise<void>
  loadLocalFs: () => Promise<void>
  getSftpConfig: () => Promise<{ config?: any; error?: string }>
}

export function createSftpWorkspaceDnD(params: UseSftpWorkspaceParams, deps: DndDeps) {
  const {
    isWindowsClient,
    localPath,
    selectedLocalFile,
    selectedRemoteFile,
    sftpPath,
    sftpStatus,
    sftpDragLocalPath,
    sftpDragRemoteFile,
    sftpNewDirName,
    sftpRenameTo,
    remoteMenu,
    leftPanelMode,
    rightPanelMode,
  } = params

  const { uploadSftp, downloadSftp, renameSftp, deleteSftp, mkdirSftp, loadLocalFs, getSftpConfig } = deps

  const hideRemoteMenu = () => {
    remoteMenu.value.visible = false
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

  return {
    hideRemoteMenu,
    onLeftDrop,
    onRightDrop,
    onLeftDragStart,
    onRightDragStart,
    onLocalDragStart,
    onRemoteDragStart,
    onRemoteDrop,
    onLocalDrop,
    showRemoteMenu,
    menuDownload,
    menuRename,
    menuDelete,
    promptMkdirSftp,
  }
}
