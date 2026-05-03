import type { Ref } from 'vue'

export type PanelMode = 'local' | 'remote'

export type LocalSshConfig = {
  host: string
  port?: number
  username: string
  password?: string
  privateKey?: string
}

export type UseSftpWorkspaceParams = {
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
  selectedLocalFiles: Ref<string[]>
  selectedRemoteFiles: Ref<string[]>
  leftSelectedKeys: Ref<string[]>
  rightSelectedKeys: Ref<string[]>
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
