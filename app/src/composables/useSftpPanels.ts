import { ref } from 'vue'

export function useSftpPanels() {
  const sftpPath = ref('.')
  const sftpRows = ref<any[]>([])
  const sftpStatus = ref('')
  const sftpHostId = ref('')
  const sftpConnected = ref(false)
  const rightConnectPanelOpen = ref(false)
  const rightConnectTarget = ref<string>('')
  const sftpDragLocalPath = ref('')
  const sftpDragRemoteFile = ref('')
  const sftpUploadProgress = ref(0)
  const sftpDownloadProgress = ref(0)
  const selectedRemoteFile = ref('')
  const sftpNewDirName = ref('')
  const sftpRenameTo = ref('')
  const remoteMenu = ref({ visible: false, x: 0, y: 0, filename: '' })
  const leftPanelMode = ref<'local' | 'remote'>('local')
  const leftConnectPanelOpen = ref(false)
  const leftConnectTarget = ref<string>('local')
  const leftConnectCategory = ref('全部')
  const leftConnectKeyword = ref('')
  const leftSftpHostId = ref('')
  const leftSftpPath = ref('.')
  const leftSftpRows = ref<any[]>([])
  const rightPanelMode = ref<'remote' | 'local'>('remote')
  const rightConnectCategory = ref('全部')
  const rightConnectKeyword = ref('')
  const rightLocalPath = ref('')
  const rightLocalRows = ref<any[]>([])
  const leftFileKeyword = ref('')
  const rightFileKeyword = ref('')
  const localSortBy = ref<'name' | 'createdAt' | 'modifiedAt'>('name')
  const remoteSortBy = ref<'name' | 'createdAt' | 'modifiedAt'>('name')

  return {
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
    selectedRemoteFile,
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
    rightLocalPath,
    rightLocalRows,
    leftFileKeyword,
    rightFileKeyword,
    localSortBy,
    remoteSortBy,
  }
}
