import { createSftpWorkspaceDnD } from './sftpWorkspaceDnD'
import { createSftpWorkspaceLoaders } from './sftpWorkspaceLoaders'
import { createSftpWorkspaceNavigation } from './sftpWorkspaceNavigation'
import type { UseSftpWorkspaceParams } from './sftpWorkspaceTypes'

export function useSftpWorkspace(params: UseSftpWorkspaceParams) {
  const loaderBundle = createSftpWorkspaceLoaders(params)
  const dndBundle = createSftpWorkspaceDnD(params, {
    uploadSftp: loaderBundle.uploadSftp,
    downloadSftp: loaderBundle.downloadSftp,
    renameSftp: loaderBundle.renameSftp,
    deleteSftp: loaderBundle.deleteSftp,
    mkdirSftp: loaderBundle.mkdirSftp,
    loadLocalFs: loaderBundle.loadLocalFs,
    getSftpConfig: loaderBundle.getSftpConfig,
  })
  const navigationBundle = createSftpWorkspaceNavigation(params, {
    loadLocalFs: loaderBundle.loadLocalFs,
    loadRightLocalFs: loaderBundle.loadRightLocalFs,
    loadLeftSftp: loaderBundle.loadLeftSftp,
    loadSftp: loaderBundle.loadSftp,
    hideRemoteMenu: dndBundle.hideRemoteMenu,
  })

  return {
    ...loaderBundle,
    ...navigationBundle,
    ...dndBundle,
  }
}
