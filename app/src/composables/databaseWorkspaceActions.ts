import type { ComputedRef, Ref } from 'vue'
import {
  downloadSpreadsheetFallback,
  getDefaultQueryTemplate,
  mapConnection,
  normalizeConnectionPayload,
  normalizeQueryRows,
} from './databaseWorkspaceHelpers'
import type {
  DatabaseConnection,
  DatabaseConnectionPayload,
  DatabaseSnippetItem,
  DbState,
  QueryRow,
} from './databaseWorkspaceTypes'

type CreateDatabaseWorkspaceActionsParams = {
  openSnippetsPanel: () => void
  databaseItems: Ref<DatabaseConnection[]>
  selectedDatabaseId: Ref<string>
  databaseStatus: Ref<string>
  databaseQuery: Ref<string>
  queryResultColumns: Ref<string[]>
  queryResultRows: Ref<QueryRow[]>
  queryResultSummary: Ref<string>
  selectedDatabase: ComputedRef<DatabaseConnection | null>
  databaseSnippetItems: ComputedRef<DatabaseSnippetItem[]>
  bridgeAvailable: () => boolean
}

export function createDatabaseWorkspaceActions(params: CreateDatabaseWorkspaceActionsParams) {
  const {
    openSnippetsPanel,
    databaseItems,
    selectedDatabaseId,
    databaseStatus,
    databaseQuery,
    queryResultColumns,
    queryResultRows,
    queryResultSummary,
    selectedDatabase,
    databaseSnippetItems,
    bridgeAvailable,
  } = params

  const setDefaultQueryForConnection = (target: DatabaseConnection | null) => {
    if (!target) return
    databaseQuery.value = getDefaultQueryTemplate(target.engine)
  }

  const ensureSelection = () => {
    if (selectedDatabaseId.value && databaseItems.value.some((item) => item.id === selectedDatabaseId.value)) return
    selectedDatabaseId.value = databaseItems.value[0]?.id || ''
  }

  const replaceConnection = (nextItem: DatabaseConnection) => {
    const next = mapConnection(nextItem)
    const index = databaseItems.value.findIndex((item) => item.id === next.id)
    if (index >= 0) {
      databaseItems.value.splice(index, 1, next)
    } else {
      databaseItems.value.unshift(next)
    }
    if (!selectedDatabaseId.value) selectedDatabaseId.value = next.id
  }

  const patchConnectionState = (id: string, state: DbState, error = '') => {
    const index = databaseItems.value.findIndex((item) => item.id === id)
    if (index < 0) return
    const current = databaseItems.value[index]
    if (!current) return
    databaseItems.value.splice(index, 1, {
      ...current,
      state,
      lastError: error,
      latency: state === 'offline' ? '--' : current.latency,
    })
  }

  const applyQueryResult = (payload: { columns?: string[]; rows?: any[]; summary?: string }) => {
    queryResultColumns.value = Array.isArray(payload.columns) ? payload.columns.map((item) => String(item || '')) : []
    queryResultRows.value = normalizeQueryRows(Array.isArray(payload.rows) ? payload.rows : [])
    queryResultSummary.value = String(payload.summary || '执行完成')
  }

  const loadDatabaseConnections = async () => {
    if (!bridgeAvailable()) {
      databaseStatus.value = '当前环境不支持数据库连接能力'
      return
    }
    databaseStatus.value = '正在加载数据库连接...'
    const response = await window.lightterm.dbListConnections()
    if (!response?.ok) {
      databaseStatus.value = response?.error || '加载数据库连接失败'
      return
    }
    databaseItems.value = Array.isArray(response.items) ? response.items.map(mapConnection) : []
    ensureSelection()
    if (!databaseItems.value.length) {
      databaseStatus.value = '暂无数据库连接，请先新建连接'
      databaseQuery.value = ''
      queryResultColumns.value = []
      queryResultRows.value = []
      queryResultSummary.value = '尚未执行查询'
      return
    }
    const target = selectedDatabase.value
    if (target && !databaseQuery.value.trim()) setDefaultQueryForConnection(target)
    databaseStatus.value = `已加载 ${databaseItems.value.length} 个数据库连接`
  }

  const selectDatabaseConnection = (id: string) => {
    const target = databaseItems.value.find((item) => item.id === id)
    if (!target) return
    selectedDatabaseId.value = target.id
    if (!databaseQuery.value.trim()) setDefaultQueryForConnection(target)
    databaseStatus.value = `已选中服务器：${target.name} (${target.engine})`
  }

  const loadDatabaseCatalogs = async (id = selectedDatabaseId.value) => {
    const target = databaseItems.value.find((item) => item.id === id)
    if (!target || !bridgeAvailable()) return { ok: false, error: '数据库连接不存在' }
    const response = await window.lightterm.dbListDatabases({ id: target.id })
    if (!response?.ok) {
      databaseStatus.value = response?.error || '读取数据库清单失败'
      return { ok: false, error: response?.error || '读取数据库清单失败' }
    }
    if (response.item) replaceConnection(response.item)
    return { ok: true, databases: Array.isArray(response.databases) ? response.databases : [] }
  }

  const connectDatabaseConnection = async (id = selectedDatabaseId.value) => {
    const target = databaseItems.value.find((item) => item.id === id)
    if (!target || !bridgeAvailable()) return
    selectedDatabaseId.value = target.id
    databaseStatus.value = `连接中：${target.name}`
    const response = await window.lightterm.dbConnect({ id: target.id })
    if (!response?.ok || !response.item) {
      patchConnectionState(target.id, 'offline', response?.error || '连接失败')
      databaseStatus.value = `连接失败：${response?.error || '未知错误'}`
      return
    }
    replaceConnection(response.item)
    setDefaultQueryForConnection(mapConnection(response.item))
    const next = mapConnection(response.item)
    databaseStatus.value = next.database
      ? `已连接服务器：${next.name}，当前数据库 ${next.database}`
      : `已连接服务器：${next.name}，请在左侧选择数据库`
  }

  const disconnectDatabaseConnection = async (id = selectedDatabaseId.value) => {
    const target = databaseItems.value.find((item) => item.id === id)
    if (!target || !bridgeAvailable()) return
    const response = await window.lightterm.dbDisconnect({ id: target.id })
    if (!response?.ok) {
      databaseStatus.value = response?.error || '断开连接失败'
      return
    }
    if (response.item) replaceConnection(response.item)
    else patchConnectionState(target.id, 'idle')
    databaseStatus.value = `已断开服务器：${target.name}`
  }

  const selectDatabaseCatalog = async (databaseName: string) => {
    const target = selectedDatabase.value
    const nextName = String(databaseName || '').trim()
    if (!target || !bridgeAvailable()) {
      databaseStatus.value = '请先选择一个数据库服务器'
      return { ok: false, error: '请先选择一个数据库服务器' }
    }
    if (!nextName) {
      databaseStatus.value = '请选择具体数据库'
      return { ok: false, error: '请选择具体数据库' }
    }
    databaseStatus.value = `切换数据库中：${target.name} / ${nextName}`
    const response = await window.lightterm.dbSelectDatabase({ id: target.id, database: nextName })
    if (!response?.ok || !response.item) {
      databaseStatus.value = response?.error || '切换数据库失败'
      return { ok: false, error: response?.error || '切换数据库失败' }
    }
    replaceConnection(response.item)
    databaseStatus.value = `已进入数据库：${nextName}`
    return { ok: true, item: mapConnection(response.item) }
  }

  const createDatabaseConnection = async (payload?: Partial<DatabaseConnectionPayload>) => {
    if (!bridgeAvailable()) {
      const message = '数据库桥接不可用，请重启应用'
      databaseStatus.value = message
      return { ok: false, error: message }
    }
    const normalized = normalizeConnectionPayload(payload)
    if (!normalized.ok) {
      databaseStatus.value = normalized.error
      return { ok: false, error: normalized.error }
    }
    let response
    try {
      response = await window.lightterm.dbSaveConnection(normalized.data)
    } catch (error) {
      const message = String((error as any)?.message || '新建数据库连接失败')
      databaseStatus.value = message
      return { ok: false, error: message }
    }
    if (!response?.ok || !response.item) {
      databaseStatus.value = response?.error || '新建数据库连接失败'
      return { ok: false, error: response?.error || '新建数据库连接失败' }
    }
    replaceConnection(response.item)
    selectedDatabaseId.value = response.item.id
    setDefaultQueryForConnection(mapConnection(response.item))
    databaseStatus.value = `已新建连接：${response.item.name}`
    return { ok: true, item: mapConnection(response.item) }
  }

  const editDatabaseConnection = async (id = selectedDatabaseId.value, payload?: Partial<DatabaseConnectionPayload>) => {
    if (!bridgeAvailable()) {
      const message = '数据库桥接不可用，请重启应用'
      databaseStatus.value = message
      return { ok: false, error: message }
    }
    const target = databaseItems.value.find((item) => item.id === id)
    if (!target) return { ok: false, error: '数据库连接不存在' }
    const normalized = normalizeConnectionPayload(payload, target)
    if (!normalized.ok) {
      databaseStatus.value = normalized.error
      return { ok: false, error: normalized.error }
    }
    let response
    try {
      response = await window.lightterm.dbSaveConnection(normalized.data)
    } catch (error) {
      const message = String((error as any)?.message || '更新数据库连接失败')
      databaseStatus.value = message
      return { ok: false, error: message }
    }
    if (!response?.ok || !response.item) {
      databaseStatus.value = response?.error || '更新数据库连接失败'
      return { ok: false, error: response?.error || '更新数据库连接失败' }
    }
    replaceConnection(response.item)
    selectedDatabaseId.value = response.item.id
    databaseStatus.value = `已更新连接：${response.item.name}`
    return { ok: true, item: mapConnection(response.item) }
  }

  const deleteDatabaseConnection = async (id = selectedDatabaseId.value) => {
    if (!bridgeAvailable()) return
    const target = databaseItems.value.find((item) => item.id === id)
    if (!target) return
    if (!window.confirm(`确定删除数据库连接「${target.name}」吗？`)) return
    const response = await window.lightterm.dbDeleteConnection({ id: target.id })
    if (!response?.ok) {
      databaseStatus.value = response?.error || '删除数据库连接失败'
      return
    }
    databaseItems.value = databaseItems.value.filter((item) => item.id !== target.id)
    ensureSelection()
    if (!databaseItems.value.length) {
      databaseQuery.value = ''
      queryResultColumns.value = []
      queryResultRows.value = []
      queryResultSummary.value = '尚未执行查询'
      databaseStatus.value = `已删除连接：${target.name}`
      return
    }
    if (!databaseQuery.value.trim() && selectedDatabase.value) setDefaultQueryForConnection(selectedDatabase.value)
    databaseStatus.value = `已删除连接：${target.name}`
  }

  const importDatabaseConnection = (id = selectedDatabaseId.value) => {
    const target = databaseItems.value.find((item) => item.id === id)
    if (!target) return
    selectedDatabaseId.value = target.id
    databaseStatus.value = `导入功能待补充：${target.name}`
  }

  const exportDatabaseConnection = (id = selectedDatabaseId.value) => {
    const target = databaseItems.value.find((item) => item.id === id)
    if (!target) return
    selectedDatabaseId.value = target.id
    databaseStatus.value = `导出功能待补充：${target.name}`
  }

  const openDatabaseQuery = (id = selectedDatabaseId.value) => {
    const target = databaseItems.value.find((item) => item.id === id)
    if (!target) return
    selectedDatabaseId.value = target.id
    setDefaultQueryForConnection(target)
    databaseStatus.value = `已切换到查询模式：${target.name}`
  }

  const executeDatabaseQuery = async () => {
    const target = selectedDatabase.value
    if (!target || !bridgeAvailable()) {
      databaseStatus.value = '请先选择一个数据库连接'
      return
    }
    const sql = databaseQuery.value.trim()
    if (!sql) {
      databaseStatus.value = '请输入 SQL 后再执行'
      return
    }
    databaseStatus.value = `执行中：${target.name}`
    const response = await window.lightterm.dbQuery({ id: target.id, sql })
    if (!response?.ok) {
      patchConnectionState(target.id, 'offline', response?.error || '执行失败')
      databaseStatus.value = `执行失败：${response?.error || '未知错误'}`
      return
    }
    if (response.item) replaceConnection(response.item)
    applyQueryResult(response)
    databaseStatus.value = `执行完成：${target.name}`
  }

  const exportDatabaseQueryResult = async () => {
    const target = selectedDatabase.value
    if (!bridgeAvailable()) {
      databaseStatus.value = '数据库桥接不可用，请重启应用'
      return
    }
    if (!queryResultColumns.value.length) {
      databaseStatus.value = '当前没有可导出的查询结果'
      return
    }
    databaseStatus.value = '正在导出查询结果...'
    const exportName = target?.database ? `${target.name}-${target.database}` : (target?.name || 'query-result')
    try {
      const response = await window.lightterm.dbExportQuery({
        id: target?.id || undefined,
        name: exportName,
        columns: [...queryResultColumns.value],
        rows: queryResultRows.value.map((row) => ({ ...row })),
      })
      if (!response?.ok) {
        databaseStatus.value = response?.error || '导出失败'
        return
      }
      databaseStatus.value = `已导出到 ${response.filePath || ''}`.trim()
    } catch {
      const ok = downloadSpreadsheetFallback(exportName, [...queryResultColumns.value], [...queryResultRows.value])
      databaseStatus.value = ok ? '已导出 Excel 文件' : '导出失败，请重启应用后重试'
    }
  }

  const openDatabaseSnippets = () => {
    databaseStatus.value = '已打开代码片段页，请在“数据库”分类维护常用 SQL'
    openSnippetsPanel()
  }

  const insertDatabaseSnippet = (snippetId: string) => {
    const target = databaseSnippetItems.value.find((item) => item.id === snippetId)
    if (!target) {
      databaseStatus.value = '未找到可插入的代码片段'
      return
    }
    const next = String(target.commands || '').trim()
    if (!next) {
      databaseStatus.value = `片段内容为空：${target.name}`
      return
    }
    databaseQuery.value = next
    databaseStatus.value = `已插入代码片段：${target.name}`
  }

  const previewDatabaseTable = async (tableName: string) => {
    const target = selectedDatabase.value
    if (!target || !bridgeAvailable()) {
      databaseStatus.value = '请先选择一个数据库连接'
      return
    }
    const table = target.tables.find((item) => item.name === tableName)
    if (!table) {
      databaseStatus.value = `未找到表：${tableName}`
      return
    }
    databaseStatus.value = `读取表内容中：${table.name}`
    const response = await window.lightterm.dbPreviewTable({
      id: target.id,
      tableName: table.tableName || table.name,
      schemaName: table.schemaName || undefined,
      limit: 50,
    })
    if (!response?.ok) {
      patchConnectionState(target.id, 'offline', response?.error || '读取表内容失败')
      databaseStatus.value = `读取表内容失败：${response?.error || '未知错误'}`
      return
    }
    if (response.item) replaceConnection(response.item)
    databaseQuery.value = String(response.sql || '')
    applyQueryResult(response)
    databaseStatus.value = `已打开表内容：${table.name}`
  }

  const databaseContextActions = [
    { key: 'connect', label: '连接', run: connectDatabaseConnection },
    { key: 'disconnect', label: '断开', run: disconnectDatabaseConnection },
    { key: 'import', label: '导入', run: importDatabaseConnection },
    { key: 'export', label: '导出', run: exportDatabaseConnection },
    { key: 'query', label: '查询', run: openDatabaseQuery },
  ]

  return {
    databaseContextActions,
    loadDatabaseConnections,
    selectDatabaseConnection,
    loadDatabaseCatalogs,
    connectDatabaseConnection,
    disconnectDatabaseConnection,
    selectDatabaseCatalog,
    createDatabaseConnection,
    editDatabaseConnection,
    deleteDatabaseConnection,
    importDatabaseConnection,
    exportDatabaseConnection,
    openDatabaseQuery,
    executeDatabaseQuery,
    exportDatabaseQueryResult,
    openDatabaseSnippets,
    insertDatabaseSnippet,
    previewDatabaseTable,
  }
}
