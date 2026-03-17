import type { Ref } from 'vue'

export function useSftpActions(params: {
  sftpPath: Ref<string>
  sftpRows: Ref<any[]>
  sftpStatus: Ref<string>
  rightPanelMode: Ref<'remote' | 'local'>
  selectedLocalFile: Ref<string>
  sftpUploadProgress: Ref<number>
  selectedRemoteFile: Ref<string>
  sftpDownloadProgress: Ref<number>
  sftpNewDirName: Ref<string>
  sftpRenameTo: Ref<string>
  loadRightLocalFs: () => Promise<void>
  getSftpConfig: () => Promise<{ config?: any; error?: string }>
}) {
  const {
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
  } = params

  const loadSftp = async () => {
    if (rightPanelMode.value === 'local') {
      await loadRightLocalFs()
      return
    }
    const { config, error } = await getSftpConfig()
    if (!config) {
      sftpStatus.value = error || '请先选择并连接 SSH 服务器'
      return
    }
    sftpStatus.value = '读取中...'
    const res = await window.lightterm.sftpList({ ...config, remotePath: sftpPath.value })
    if (!res.ok) return (sftpStatus.value = `读取失败：${res.error}`)
    sftpRows.value = res.items || []
    sftpStatus.value = `已读取 ${sftpRows.value.length} 项`
  }

  const uploadSftp = async () => {
    const { config, error } = await getSftpConfig()
    if (!config) {
      sftpStatus.value = error || '请先选择并连接 SSH 服务器'
      return
    }
    sftpUploadProgress.value = 0
    const res = await window.lightterm.sftpUpload({ ...config, remoteDir: sftpPath.value, localFile: selectedLocalFile.value || undefined, conflictPolicy: 'resume', resume: true })
    sftpStatus.value = res.ok ? `上传成功：${res.remoteFile}` : `上传失败：${res.error}`
    if (res.ok) await loadSftp()
  }

  const downloadSftp = async () => {
    const { config, error } = await getSftpConfig()
    if (!config) {
      sftpStatus.value = error || '请先选择并连接 SSH 服务器'
      return
    }
    if (!selectedRemoteFile.value) {
      sftpStatus.value = '请先在列表中选择远程文件'
      return
    }
    sftpDownloadProgress.value = 0
    const remoteFile = `${sftpPath.value.replace(/\/$/, '')}/${selectedRemoteFile.value}`
    const res = await window.lightterm.sftpDownload({ ...config, remoteFile, conflictPolicy: 'resume', resume: true })
    sftpStatus.value = res.ok ? `下载成功：${res.filePath}` : `下载失败：${res.error}`
  }

  const mkdirSftp = async () => {
    const { config, error } = await getSftpConfig()
    if (!config) {
      sftpStatus.value = error || '请先选择并连接 SSH 服务器'
      return
    }
    if (!sftpNewDirName.value) return
    const remoteDir = `${sftpPath.value.replace(/\/$/, '')}/${sftpNewDirName.value}`
    const res = await window.lightterm.sftpMkdir({ ...config, remoteDir })
    sftpStatus.value = res.ok ? `目录已创建：${remoteDir}` : `创建失败：${res.error}`
    if (res.ok) {
      sftpNewDirName.value = ''
      await loadSftp()
    }
  }

  const renameSftp = async () => {
    const { config, error } = await getSftpConfig()
    if (!config) {
      sftpStatus.value = error || '请先选择并连接 SSH 服务器'
      return
    }
    if (!selectedRemoteFile.value || !sftpRenameTo.value) return
    const oldPath = `${sftpPath.value.replace(/\/$/, '')}/${selectedRemoteFile.value}`
    const newPath = `${sftpPath.value.replace(/\/$/, '')}/${sftpRenameTo.value}`
    const res = await window.lightterm.sftpRename({ ...config, oldPath, newPath })
    sftpStatus.value = res.ok ? `已重命名为：${sftpRenameTo.value}` : `重命名失败：${res.error}`
    if (res.ok) {
      selectedRemoteFile.value = sftpRenameTo.value
      sftpRenameTo.value = ''
      await loadSftp()
    }
  }

  const deleteSftp = async () => {
    const { config, error } = await getSftpConfig()
    if (!config) {
      sftpStatus.value = error || '请先选择并连接 SSH 服务器'
      return
    }
    if (!selectedRemoteFile.value) return
    const remoteFile = `${sftpPath.value.replace(/\/$/, '')}/${selectedRemoteFile.value}`
    const res = await window.lightterm.sftpDelete({ ...config, remoteFile })
    sftpStatus.value = res.ok ? `已删除：${selectedRemoteFile.value}` : `删除失败：${res.error}`
    if (res.ok) {
      selectedRemoteFile.value = ''
      await loadSftp()
    }
  }

  return {
    loadSftp,
    uploadSftp,
    downloadSftp,
    mkdirSftp,
    renameSftp,
    deleteSftp,
  }
}
