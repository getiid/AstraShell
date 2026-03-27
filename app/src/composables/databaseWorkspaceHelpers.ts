import type {
  DatabaseConnection,
  DatabaseConnectionPayload,
  DatabaseSnippetItem,
  DatabaseTable,
  DbEngine,
  DbState,
  QueryRow,
} from './databaseWorkspaceTypes'

const DEFAULT_QUERY_TEMPLATE: Record<DbEngine, string> = {
  MySQL: [
    '-- MySQL 巡检示例',
    'SELECT NOW() AS current_time, DATABASE() AS current_db, USER() AS current_user;',
  ].join('\n'),
  MariaDB: [
    '-- MariaDB 巡检示例',
    'SELECT NOW() AS current_time, DATABASE() AS current_db, USER() AS current_user;',
  ].join('\n'),
  PostgreSQL: [
    '-- PostgreSQL 巡检示例',
    'SELECT current_database() AS current_db, current_user AS current_user, now() AS current_time;',
  ].join('\n'),
  'SQL Server': [
    '-- SQL Server 巡检示例',
    "SELECT DB_NAME() AS current_db, SYSTEM_USER AS login_name, GETDATE() AS current_time;",
  ].join('\n'),
}

export const DEFAULT_PORTS: Record<DbEngine, number> = {
  MySQL: 3306,
  MariaDB: 3306,
  PostgreSQL: 5432,
  'SQL Server': 1433,
}

export function normalizeEngine(value: string, fallback: DbEngine = 'MySQL'): DbEngine | null {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return fallback
  if (raw === 'mysql') return 'MySQL'
  if (raw === 'mariadb') return 'MariaDB'
  if (raw === 'postgres' || raw === 'postgresql' || raw === 'pg') return 'PostgreSQL'
  if (raw === 'sql server' || raw === 'sqlserver' || raw === 'mssql') return 'SQL Server'
  return null
}

export function toNumber(value: unknown, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

export function mapTable(item: any): DatabaseTable {
  return {
    name: String(item?.name || ''),
    tableName: String(item?.tableName || item?.table_name || item?.name || ''),
    schemaName: String(item?.schemaName || item?.schema_name || ''),
    rows: toNumber(item?.rows, 0),
    size: String(item?.size || '--'),
    updatedAt: String(item?.updatedAt || item?.updated_at || '--'),
  }
}

export function mapConnection(item: any): DatabaseConnection {
  const engine = normalizeEngine(String(item?.engine || ''), 'MySQL') || 'MySQL'
  return {
    id: String(item?.id || ''),
    name: String(item?.name || ''),
    engine,
    host: String(item?.host || ''),
    port: toNumber(item?.port, DEFAULT_PORTS[engine]),
    username: String(item?.username || ''),
    password: String(item?.password || ''),
    database: String(item?.database || ''),
    note: String(item?.note || ''),
    state: item?.state === 'connected' ? 'connected' : item?.state === 'offline' ? 'offline' : 'idle',
    version: String(item?.version || ''),
    latency: String(item?.latency || '--'),
    databases: Array.isArray(item?.databases) ? item.databases.map((row: unknown) => String(row || '')).filter(Boolean) : [],
    schemas: Array.isArray(item?.schemas) ? item.schemas.map((row: unknown) => String(row || '')).filter(Boolean) : [],
    tables: Array.isArray(item?.tables) ? item.tables.map(mapTable) : [],
    lastError: String(item?.lastError || ''),
  }
}

export function normalizeQueryRows(rows: any[]): QueryRow[] {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const next: QueryRow = {}
    if (!row || typeof row !== 'object') return next
    for (const [key, value] of Object.entries(row)) {
      if (value === null || value === undefined) {
        next[key] = ''
        continue
      }
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        next[key] = value
        continue
      }
      next[key] = String(value)
    }
    return next
  })
}

function escapeSpreadsheetText(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function sanitizeExportName(value: string) {
  const normalized = String(value || 'query-result').trim() || 'query-result'
  return normalized.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-')
}

function buildSpreadsheetXml(columns: string[], rows: QueryRow[]) {
  const header = columns
    .map((col) => `<Cell><Data ss:Type="String">${escapeSpreadsheetText(col)}</Data></Cell>`)
    .join('')
  const body = rows
    .map((row) => {
      const cells = columns.map((col) => {
        const value = row[col]
        const type = typeof value === 'number' ? 'Number' : 'String'
        return `<Cell><Data ss:Type="${type}">${escapeSpreadsheetText(value ?? '')}</Data></Cell>`
      }).join('')
      return `<Row>${cells}</Row>`
    })
    .join('')
  return [
    '<?xml version="1.0"?>',
    '<?mso-application progid="Excel.Sheet"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
    ' xmlns:o="urn:schemas-microsoft-com:office:office"',
    ' xmlns:x="urn:schemas-microsoft-com:office:excel"',
    ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"',
    ' xmlns:html="http://www.w3.org/TR/REC-html40">',
    '<Worksheet ss:Name="QueryResult">',
    '<Table>',
    `<Row>${header}</Row>`,
    body,
    '</Table>',
    '</Worksheet>',
    '</Workbook>',
  ].join('')
}

export function downloadSpreadsheetFallback(name: string, columns: string[], rows: QueryRow[]) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  const content = buildSpreadsheetXml(columns, rows)
  const blob = new Blob([content], { type: 'application/vnd.ms-excel;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${sanitizeExportName(name)}.xls`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  return true
}

export function getDefaultQueryTemplate(engine: DbEngine) {
  return DEFAULT_QUERY_TEMPLATE[engine] || DEFAULT_QUERY_TEMPLATE.MySQL
}

export function normalizeConnectionPayload(payload: Partial<DatabaseConnectionPayload> | null | undefined, existing?: DatabaseConnection | null) {
  const fallbackEngine = existing?.engine || 'MySQL'
  const engine = normalizeEngine(String(payload?.engine || fallbackEngine), fallbackEngine)
  if (!engine) return { ok: false as const, error: '数据库类型不支持' }
  const name = String(payload?.name || '').trim()
  if (!name) return { ok: false as const, error: '请输入连接名称' }
  const host = String(payload?.host || '').trim()
  if (!host) return { ok: false as const, error: '请输入主机地址' }
  const port = Number(payload?.port ?? DEFAULT_PORTS[engine])
  if (!Number.isFinite(port) || port <= 0) return { ok: false as const, error: '端口格式不正确' }
  const username = String(payload?.username || '').trim()
  if (!username) return { ok: false as const, error: '请输入用户名' }
  return {
    ok: true as const,
    data: {
      id: existing?.id || payload?.id,
      name,
      engine,
      host,
      port,
      username,
      password: String(payload?.password || ''),
      database: String(payload?.database || '').trim(),
      note: String(payload?.note || '').trim(),
    },
  }
}

export function isDatabaseSnippetCategory(value: string) {
  const category = String(value || '').trim().toLowerCase()
  return category.includes('数据库') || category === 'database' || category.includes('db') || category.includes('sql')
}

export function filterDatabaseSnippetItems(items: DatabaseSnippetItem[]) {
  return items
    .filter((item) => isDatabaseSnippetCategory(item.category))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

export function databaseStateLabel(state: DbState) {
  if (state === 'connected') return '已连接'
  if (state === 'offline') return '不可达'
  return '待连接'
}

export function databaseStateClass(state: DbState) {
  if (state === 'connected') return 'online'
  if (state === 'offline') return 'danger'
  return 'plain'
}
