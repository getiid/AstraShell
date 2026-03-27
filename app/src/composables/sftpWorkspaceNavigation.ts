import type { UseSftpWorkspaceParams } from './sftpWorkspaceTypes'

type NavigationDeps = {
  loadLocalFs: () => Promise<void>
  loadRightLocalFs: () => Promise<void>
  loadLeftSftp: () => Promise<void>
  loadSftp: () => Promise<unknown>
  hideRemoteMenu: () => void
}

export function createSftpWorkspaceNavigation(params: UseSftpWorkspaceParams, deps: NavigationDeps) {
  const {
    isWindowsClient,
    localPath,
    selectedLocalFile,
    selectedRemoteFile,
    sftpPath,
    leftPanelMode,
    leftSftpPath,
    rightPanelMode,
    rightLocalPath,
    getLocalParentPath,
  } = params

  const { loadLocalFs, loadRightLocalFs, loadLeftSftp, loadSftp, hideRemoteMenu } = deps

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
    openLocalItem,
    openLeftRemoteItem,
    openLeftItem,
    localGoUp,
    openRightLocalItem,
    openRemoteItem,
    openRightItem,
    remoteGoUp,
  }
}
