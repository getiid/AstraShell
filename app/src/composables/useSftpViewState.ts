import { computed, type Ref } from 'vue'

type FsRow = {
  isDir?: boolean
  name?: string
  filename?: string
  createdAt?: number
  modifiedAt?: number
  mtime?: number
}

type UseSftpViewStateParams = {
  hostItems: Ref<any[]>
  defaultCategory: string
  allCategory: string
  leftPanelMode: Ref<'local' | 'remote'>
  rightPanelMode: Ref<'local' | 'remote'>
  localPath: Ref<string>
  localRows: Ref<any[]>
  leftSftpHostId: Ref<string>
  leftSftpRows: Ref<any[]>
  rightLocalPath: Ref<string>
  rightLocalRows: Ref<any[]>
  sftpHostId: Ref<string>
  sftpRows: Ref<any[]>
  leftFileKeyword: Ref<string>
  rightFileKeyword: Ref<string>
  leftConnectCategory: Ref<string>
  leftConnectKeyword: Ref<string>
  rightConnectCategory: Ref<string>
  rightConnectKeyword: Ref<string>
  localSortBy: Ref<'name' | 'createdAt' | 'modifiedAt'>
  remoteSortBy: Ref<'name' | 'createdAt' | 'modifiedAt'>
  isWindowsClient: Readonly<Ref<boolean>>
}

export function useSftpViewState(params: UseSftpViewStateParams) {
  const {
    hostItems,
    defaultCategory,
    allCategory,
    leftPanelMode,
    rightPanelMode,
    localPath,
    localRows,
    leftSftpHostId,
    leftSftpRows,
    rightLocalPath,
    rightLocalRows,
    sftpHostId,
    sftpRows,
    leftFileKeyword,
    rightFileKeyword,
    leftConnectCategory,
    leftConnectKeyword,
    rightConnectCategory,
    rightConnectKeyword,
    localSortBy,
    remoteSortBy,
    isWindowsClient,
  } = params

  const toTimeMs = (value: unknown) => {
    const num = Number(value || 0)
    if (!Number.isFinite(num) || num <= 0) return 0
    return num > 1e12 ? num : num * 1000
  }

  const formatFsTime = (value: unknown) => {
    const ts = toTimeMs(value)
    if (!ts) return '未知时间'
    return new Date(ts).toLocaleDateString()
  }

  const sortFsRows = <T extends FsRow>(
    rows: T[],
    sortBy: 'name' | 'createdAt' | 'modifiedAt',
  ) => [...rows].sort((a, b) => {
    if (!!a.isDir !== !!b.isDir) return a.isDir ? -1 : 1
    if (sortBy === 'name') {
      const aName = String(a.name || a.filename || '').toLowerCase()
      const bName = String(b.name || b.filename || '').toLowerCase()
      return aName.localeCompare(bName, 'zh-Hans-CN')
    }
    const aTime = sortBy === 'createdAt' ? toTimeMs(a.createdAt) : toTimeMs(a.modifiedAt || a.mtime)
    const bTime = sortBy === 'createdAt' ? toTimeMs(b.createdAt) : toTimeMs(b.modifiedAt || b.mtime)
    if (aTime !== bTime) return bTime - aTime
    const aName = String(a.name || a.filename || '').toLowerCase()
    const bName = String(b.name || b.filename || '').toLowerCase()
    return aName.localeCompare(bName, 'zh-Hans-CN')
  })

  const filterFsRowsByKeyword = (rows: any[], keyword: string, nameKey: 'name' | 'filename') => {
    const q = String(keyword || '').trim().toLowerCase()
    if (!q) return rows
    return rows.filter((item) => String(item?.[nameKey] || '').toLowerCase().includes(q))
  }

  const sortedLocalRows = computed(() => sortFsRows(localRows.value, localSortBy.value))
  const sortedSftpRows = computed(() => sortFsRows(sftpRows.value, remoteSortBy.value))
  const sortedLeftSftpRows = computed(() => sortFsRows(leftSftpRows.value, localSortBy.value))
  const sortedRightLocalRows = computed(() => sortFsRows(rightLocalRows.value, remoteSortBy.value))

  const leftDisplayRows = computed(() => {
    const source = leftPanelMode.value === 'local' ? sortedLocalRows.value : sortedLeftSftpRows.value
    return filterFsRowsByKeyword(source, leftFileKeyword.value, leftPanelMode.value === 'local' ? 'name' : 'filename')
  })

  const rightDisplayRows = computed(() => {
    const source = rightPanelMode.value === 'remote' ? sortedSftpRows.value : sortedRightLocalRows.value
    return filterFsRowsByKeyword(source, rightFileKeyword.value, rightPanelMode.value === 'remote' ? 'filename' : 'name')
  })

  const groupHostsByCategory = (categoryFilter: string, keyword: string) => {
    const normalizedKeyword = String(keyword || '').trim().toLowerCase()
    const grouped = new Map<string, any[]>()

    hostItems.value.forEach((host) => {
      const category = String(host?.category || defaultCategory).trim() || defaultCategory
      if (categoryFilter !== allCategory && category !== categoryFilter) return
      if (normalizedKeyword) {
        const matched = [host?.name, host?.host, host?.username, category]
          .some((value) => String(value || '').toLowerCase().includes(normalizedKeyword))
        if (!matched) return
      }
      if (!grouped.has(category)) grouped.set(category, [])
      grouped.get(category)!.push(host)
    })

    return [...grouped.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'zh-Hans-CN'))
      .map(([category, items]) => ({
        category,
        items: [...items].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), 'zh-Hans-CN')),
      }))
  }

  const leftConnectGroups = computed(() => groupHostsByCategory(leftConnectCategory.value, leftConnectKeyword.value))
  const rightConnectGroups = computed(() => groupHostsByCategory(rightConnectCategory.value, rightConnectKeyword.value))

  const sftpTransferModeLabel = computed(() => (rightPanelMode.value === 'remote' ? 'SFTP 双向' : '本地浏览'))
  const leftPanelStateLabel = computed(() => (leftPanelMode.value === 'local' ? '本地' : '远程'))
  const rightPanelStateLabel = computed(() => (rightPanelMode.value === 'local' ? '本地' : '远程'))

  const hostLabelById = (id: string) => {
    const host = hostItems.value.find((item) => item.id === id)
    return host ? `${host.name} (${host.host})` : '未连接'
  }

  const leftLinkLabel = computed(() => {
    if (leftPanelMode.value === 'local') return '本地目录'
    if (!leftSftpHostId.value) return '未连接'
    return hostLabelById(leftSftpHostId.value)
  })

  const rightLinkLabel = computed(() => {
    if (rightPanelMode.value === 'local') return '本地目录'
    if (!sftpHostId.value || sftpHostId.value === 'local') return '未连接'
    return hostLabelById(sftpHostId.value)
  })

  const leftLocalPathDisplay = computed(() => (
    isWindowsClient.value ? (localPath.value || '盘符列表') : (localPath.value || '/')
  ))
  const rightLocalPathDisplay = computed(() => (
    isWindowsClient.value ? (rightLocalPath.value || '盘符列表') : (rightLocalPath.value || '/')
  ))

  return {
    formatFsTime,
    leftDisplayRows,
    rightDisplayRows,
    leftConnectGroups,
    rightConnectGroups,
    sftpTransferModeLabel,
    leftPanelStateLabel,
    rightPanelStateLabel,
    leftLinkLabel,
    rightLinkLabel,
    leftLocalPathDisplay,
    rightLocalPathDisplay,
  }
}
