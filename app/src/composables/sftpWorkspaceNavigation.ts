import type { UseSftpWorkspaceParams } from './sftpWorkspaceTypes'

const isRemoteDir = (item: any) => !!(item?.isDir || item?.is_dir)

const normalizeRemoteBasePath = (path: string) => {
  const value = String(path || '').trim()
  if (!value || value === '.') return '.'
  if (value === '/') return '/'
  return value.replace(/\/+$/, '') || '/'
}

const joinRemotePath = (basePath: string, name: string) => {
  const base = normalizeRemoteBasePath(basePath)
  const entry = String(name || '').trim().replace(/^\/+/, '')
  if (!entry) return base
  if (base === '.') return entry
  if (base === '/') return `/${entry}`
  return `${base}/${entry}`
}

const resolveRemoteItemPath = (basePath: string, item: any) => {
  const itemPath = String(item?.path || '').trim()
  if (itemPath) return normalizeRemoteBasePath(itemPath)
  return joinRemotePath(basePath, item?.filename || item?.name || '')
}

const getRemoteParentPath = (path: string) => {
  const current = normalizeRemoteBasePath(path)
  if (current === '.' || current === '/') return current
  const absolute = current.startsWith('/')
  const parts = current.split('/').filter(Boolean)
  if (parts.length <= 1) return absolute ? '/' : '.'
  const parent = parts.slice(0, -1).join('/')
  return absolute ? `/${parent}` : parent
}

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
    if (!isRemoteDir(item)) return
    leftSftpPath.value = resolveRemoteItemPath(leftSftpPath.value, item)
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
      leftSftpPath.value = getRemoteParentPath(leftSftpPath.value)
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
    if (isRemoteDir(item)) {
      sftpPath.value = resolveRemoteItemPath(sftpPath.value, item)
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
    sftpPath.value = getRemoteParentPath(sftpPath.value)
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
