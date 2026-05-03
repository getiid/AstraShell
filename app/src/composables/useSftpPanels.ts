import { ref } from 'vue'

export function useSftpPanels() {
  type SortKey = 'name' | 'modifiedAt' | 'size' | 'kind'
  type SortDirection = 'asc' | 'desc'
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
  const selectedRemoteFiles = ref<string[]>([])
  const selectedLocalFiles = ref<string[]>([])
  const leftSelectedKeys = ref<string[]>([])
  const rightSelectedKeys = ref<string[]>([])
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
  const localSortBy = ref<SortKey>('name')
  const localSortDirection = ref<SortDirection>('asc')
  const remoteSortBy = ref<SortKey>('name')
  const remoteSortDirection = ref<SortDirection>('asc')

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
    selectedRemoteFiles,
    selectedLocalFiles,
    leftSelectedKeys,
    rightSelectedKeys,
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
    localSortDirection,
    remoteSortBy,
    remoteSortDirection,
  }
}
