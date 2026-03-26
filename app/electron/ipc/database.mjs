import {
  dbConnectionIdSchema,
  dbConnectionSchema,
  dbExportQuerySchema,
  dbPreviewTableSchema,
  dbQuerySchema,
  dbSelectDatabaseSchema,
  safeParse,
} from './schemas.mjs'

const DEFAULT_PORTS = {
  MySQL: 3306,
  MariaDB: 3306,
  PostgreSQL: 5432,
  'SQL Server': 1433,
}

const sessionMap = new Map()
let mysqlModulePromise = null
let pgModulePromise = null
let mssqlModulePromise = null

function normalizeEngine(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'mysql') return 'MySQL'
  if (raw === 'mariadb') return 'MariaDB'
  if (raw === 'postgres' || raw === 'postgresql' || raw === 'pg') return 'PostgreSQL'
  if (raw === 'sql server' || raw === 'sqlserver' || raw === 'mssql') return 'SQL Server'
  return 'MySQL'
}

function getDefaultPort(engine) {
  return DEFAULT_PORTS[normalizeEngine(engine)] || 3306
}

function toFiniteNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function formatLatency(value) {
  if (!Number.isFinite(value) || value <= 0) return '--'
  return `${Math.round(value)} ms`
}

function formatBytes(bytes) {
  const size = Number(bytes || 0)
  if (!Number.isFinite(size) || size <= 0) return '0 MB'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let next = size
  let index = 0
  while (next >= 1024 && index < units.length - 1) {
    next /= 1024
    index += 1
  }
  const precision = index <= 1 ? 0 : (next >= 100 ? 0 : (next >= 10 ? 1 : 2))
  return `${next.toFixed(precision)} ${units[index]}`
}

function padNumber(value) {
  return String(Math.max(0, Number(value || 0))).padStart(2, '0')
}

function formatDateTime(value) {
  if (!value) return '--'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())} ${padNumber(date.getHours())}:${padNumber(date.getMinutes())}:${padNumber(date.getSeconds())}`
}

function normalizeCell(value) {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return formatDateTime(value)
  if (Buffer.isBuffer(value)) return value.toString('utf8')
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return value
}

function normalizeRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const next = {}
    if (!row || typeof row !== 'object') return next
    for (const [key, value] of Object.entries(row)) {
      next[String(key)] = normalizeCell(value)
    }
    return next
  })
}

function normalizeTableRow(table, engine) {
  const schemaName = String(table?.schemaName || table?.schema_name || '').trim()
  const rawName = String(table?.tableName || table?.table_name || table?.name || '').trim()
  const displayName = schemaName && engine === 'PostgreSQL'
    ? `${schemaName}.${rawName}`
    : rawName
  return {
    name: displayName,
    tableName: rawName,
    schemaName,
    rows: toFiniteNumber(table?.rows ?? table?.rowCount ?? table?.row_count, 0),
    size: formatBytes(table?.bytes ?? table?.totalBytes ?? table?.total_bytes ?? 0),
    updatedAt: formatDateTime(table?.updatedAt || table?.updated_at || table?.modifyDate || table?.modify_date),
  }
}

function normalizeStoredConnection(row) {
  const engine = normalizeEngine(row?.engine)
  const port = toFiniteNumber(row?.port, getDefaultPort(engine))
  return {
    id: String(row?.id || ''),
    name: String(row?.name || '').trim(),
    engine,
    host: String(row?.host || '').trim(),
    port,
    username: String(row?.username || '').trim(),
    password: String(row?.password || ''),
    database: String(row?.database || '').trim(),
    note: String(row?.note || '').trim(),
    created_at: toFiniteNumber(row?.created_at || row?.createdAt, 0),
    updated_at: toFiniteNumber(row?.updated_at || row?.updatedAt, 0),
  }
}

function makeRendererConnection(row, runtime = {}) {
  const normalized = normalizeStoredConnection(row)
  const session = runtime?.session || null
  const tables = Array.isArray(runtime?.tables)
    ? runtime.tables
    : Array.isArray(session?.tables)
      ? session.tables
      : []
  const schemas = Array.isArray(runtime?.schemas)
    ? runtime.schemas
    : Array.isArray(session?.schemas)
      ? session.schemas
      : normalized.database
        ? [normalized.database]
        : []
  const databases = Array.isArray(runtime?.databases)
    ? runtime.databases
    : Array.isArray(session?.databases)
      ? session.databases
      : []
  const state = runtime?.state || (session ? 'connected' : 'idle')
  return {
    ...normalized,
    database: String(runtime?.database || session?.database || normalized.database || ''),
    state,
    version: String(runtime?.version || session?.version || ''),
    latency: formatLatency(runtime?.latencyMs ?? session?.latencyMs),
    databases,
    schemas,
    tables,
    lastError: String(runtime?.lastError || ''),
  }
}

async function loadMysqlModule() {
  if (!mysqlModulePromise) {
    mysqlModulePromise = import('mysql2/promise')
      .then((mod) => mod.default || mod)
      .catch(() => {
        throw new Error('缺少 MySQL 驱动，请执行 npm install mysql2')
      })
  }
  return mysqlModulePromise
}

async function loadPgModule() {
  if (!pgModulePromise) {
    pgModulePromise = import('pg')
      .then((mod) => mod.default || mod)
      .catch(() => {
        throw new Error('缺少 PostgreSQL 驱动，请执行 npm install pg')
      })
  }
  return pgModulePromise
}

async function loadMssqlModule() {
  if (!mssqlModulePromise) {
    mssqlModulePromise = import('mssql')
      .then((mod) => mod.default || mod)
      .catch(() => {
        throw new Error('缺少 SQL Server 驱动，请执行 npm install mssql')
      })
  }
  return mssqlModulePromise
}

async function closeSession(session) {
  if (!session) return
  try {
    if (session.engine === 'PostgreSQL') {
      await session.client?.end?.()
      return
    }
    if (session.engine === 'SQL Server') {
      await session.client?.close?.()
      return
    }
    await session.client?.end?.()
  } catch {}
}

async function createMysqlSession(connection) {
  const mysql = await loadMysqlModule()
  const startedAt = Date.now()
  const client = await mysql.createConnection({
    host: connection.host,
    port: connection.port,
    user: connection.username,
    password: connection.password || '',
    database: connection.database || undefined,
    connectTimeout: 10000,
    charset: 'utf8mb4',
    dateStrings: true,
  })
  const latencyMs = Date.now() - startedAt
  const [rows] = await client.query('SELECT VERSION() AS version, DATABASE() AS current_db')
  const info = Array.isArray(rows) ? rows[0] : null
  return {
    engine: connection.engine,
    client,
    latencyMs,
    version: String(info?.version || ''),
    database: String(info?.current_db || connection.database || ''),
    databases: [],
    tables: [],
    schemas: [],
  }
}

async function createPostgresSession(connection) {
  const pg = await loadPgModule()
  const startedAt = Date.now()
  const client = new pg.Client({
    host: connection.host,
    port: connection.port,
    user: connection.username,
    password: connection.password || undefined,
    database: connection.database || undefined,
    connectionTimeoutMillis: 10000,
    query_timeout: 30000,
    statement_timeout: 30000,
  })
  await client.connect()
  const latencyMs = Date.now() - startedAt
  const info = await client.query('SELECT version() AS version, current_database() AS current_db')
  const row = info.rows?.[0] || null
  return {
    engine: connection.engine,
    client,
    latencyMs,
    version: String(row?.version || ''),
    database: String(row?.current_db || connection.database || ''),
    databases: [],
    tables: [],
    schemas: [],
  }
}

async function createSqlServerSession(connection) {
  const mssql = await loadMssqlModule()
  const startedAt = Date.now()
  const client = new mssql.ConnectionPool({
    server: connection.host,
    port: connection.port,
    user: connection.username,
    password: connection.password || '',
    database: connection.database || undefined,
    options: {
      encrypt: false,
      trustServerCertificate: true,
    },
    pool: {
      max: 5,
      min: 0,
      idleTimeoutMillis: 30000,
    },
    requestTimeout: 30000,
    connectionTimeout: 10000,
  })
  await client.connect()
  const latencyMs = Date.now() - startedAt
  const info = await client.request().query('SELECT @@VERSION AS version, DB_NAME() AS current_db')
  const row = info.recordset?.[0] || null
  return {
    engine: connection.engine,
    client,
    latencyMs,
    version: String(row?.version || ''),
    database: String(row?.current_db || connection.database || ''),
    databases: [],
    tables: [],
    schemas: [],
  }
}

async function createSession(connection) {
  if (connection.engine === 'PostgreSQL') return createPostgresSession(connection)
  if (connection.engine === 'SQL Server') return createSqlServerSession(connection)
  return createMysqlSession(connection)
}

async function listMysqlDatabases(session) {
  const sql = `
    SELECT SCHEMA_NAME AS database_name
    FROM information_schema.schemata
    ORDER BY SCHEMA_NAME
  `
  const [rows] = await session.client.execute(sql)
  const databases = normalizeRows(rows)
    .map((row) => String(row?.database_name || row?.Database || '').trim())
    .filter(Boolean)
  session.databases = databases
  return databases
}

async function listPostgresDatabases(session) {
  const sql = `
    SELECT datname AS database_name
    FROM pg_database
    WHERE datistemplate = false
    ORDER BY datname
  `
  const result = await session.client.query(sql)
  const databases = normalizeRows(result.rows)
    .map((row) => String(row?.database_name || '').trim())
    .filter(Boolean)
  session.databases = databases
  return databases
}

async function listSqlServerDatabases(session) {
  const sql = `
    SELECT name AS database_name
    FROM sys.databases
    WHERE state = 0
    ORDER BY name
  `
  const result = await session.client.request().query(sql)
  const databases = normalizeRows(result.recordset)
    .map((row) => String(row?.database_name || '').trim())
    .filter(Boolean)
  session.databases = databases
  return databases
}

async function listDatabases(session, connection) {
  if (connection.engine === 'PostgreSQL') return listPostgresDatabases(session)
  if (connection.engine === 'SQL Server') return listSqlServerDatabases(session)
  return listMysqlDatabases(session)
}

async function listMysqlTables(session, connection) {
  const sql = `
    SELECT
      TABLE_NAME AS table_name,
      TABLE_ROWS AS row_count,
      (COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0)) AS total_bytes,
      UPDATE_TIME AS updated_at
    FROM information_schema.tables
    WHERE table_schema = COALESCE(?, DATABASE())
      AND TABLE_TYPE = 'BASE TABLE'
    ORDER BY TABLE_NAME
  `
  const [rows] = await session.client.execute(sql, [connection.database || null])
  const tables = normalizeRows(rows).map((row) => normalizeTableRow(row, connection.engine))
  session.tables = tables
  session.schemas = connection.database ? [connection.database] : []
  return { tables, schemas: session.schemas }
}

async function listPostgresTables(session) {
  const sql = `
    SELECT
      ns.nspname AS schema_name,
      c.relname AS table_name,
      COALESCE(s.n_live_tup, 0) AS row_count,
      pg_total_relation_size(c.oid) AS total_bytes,
      pg_stat_get_last_vacuum_time(c.oid) AS updated_at
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
    WHERE c.relkind IN ('r', 'p')
      AND ns.nspname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY ns.nspname, c.relname
  `
  const result = await session.client.query(sql)
  const tables = normalizeRows(result.rows).map((row) => normalizeTableRow(row, 'PostgreSQL'))
  session.tables = tables
  session.schemas = [...new Set(tables.map((item) => item.schemaName).filter(Boolean))]
  return { tables, schemas: session.schemas }
}

async function listSqlServerTables(session) {
  const sql = `
    SELECT
      s.name AS schema_name,
      t.name AS table_name,
      SUM(COALESCE(p.rows, 0)) AS row_count,
      SUM(COALESCE(a.total_pages, 0)) * 8 * 1024 AS total_bytes,
      MAX(t.modify_date) AS updated_at
    FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    LEFT JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
    LEFT JOIN sys.allocation_units a ON a.container_id = p.partition_id
    GROUP BY s.name, t.name
    ORDER BY s.name, t.name
  `
  const result = await session.client.request().query(sql)
  const tables = normalizeRows(result.recordset).map((row) => normalizeTableRow(row, 'SQL Server'))
  session.tables = tables
  session.schemas = [...new Set(tables.map((item) => item.schemaName).filter(Boolean))]
  return { tables, schemas: session.schemas }
}

async function listTables(session, connection) {
  if (connection.engine === 'PostgreSQL') return listPostgresTables(session, connection)
  if (connection.engine === 'SQL Server') return listSqlServerTables(session, connection)
  return listMysqlTables(session, connection)
}

function summarizeMutation(command, affectedRows, insertId) {
  const parts = [`执行成功：${String(command || 'SQL').trim() || 'SQL'}`]
  if (Number.isFinite(affectedRows) && affectedRows >= 0) parts.push(`影响 ${affectedRows} 行`)
  if (insertId !== undefined && insertId !== null && insertId !== 0) parts.push(`插入 ID ${insertId}`)
  return parts.join('，')
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function sanitizeExportFileName(value) {
  const normalized = String(value || 'query-result').trim() || 'query-result'
  return normalized.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-')
}

function buildExcelXml(columns, rows) {
  const headerCells = columns
    .map((col) => `<Cell><Data ss:Type="String">${escapeXml(col)}</Data></Cell>`)
    .join('')
  const bodyRows = rows
    .map((row) => {
      const cells = columns.map((col) => {
        const value = row?.[col]
        const type = typeof value === 'number' ? 'Number' : 'String'
        return `<Cell><Data ss:Type="${type}">${escapeXml(value ?? '')}</Data></Cell>`
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
    `<Row>${headerCells}</Row>`,
    bodyRows,
    '</Table>',
    '</Worksheet>',
    '</Workbook>',
  ].join('')
}

async function runMysqlQuery(session, sql) {
  const startedAt = Date.now()
  const [rows, fields] = await session.client.query(sql)
  session.latencyMs = Date.now() - startedAt
  if (Array.isArray(rows)) {
    return {
      columns: Array.isArray(fields) ? fields.map((field) => String(field?.name || '')) : Object.keys(rows[0] || {}),
      rows: normalizeRows(rows),
      summary: `返回 ${rows.length} 行结果`,
    }
  }
  const affectedRows = toFiniteNumber(rows?.affectedRows, 0)
  const summary = summarizeMutation(rows?.constructor?.name || 'SQL', affectedRows, rows?.insertId)
  return {
    columns: ['结果'],
    rows: [{ 结果: summary }],
    summary,
  }
}

async function runPostgresQuery(session, sql) {
  const startedAt = Date.now()
  const result = await session.client.query(sql)
  session.latencyMs = Date.now() - startedAt
  if (Array.isArray(result.rows) && (result.rows.length > 0 || result.fields?.length)) {
    return {
      columns: Array.isArray(result.fields) ? result.fields.map((field) => String(field?.name || '')) : Object.keys(result.rows[0] || {}),
      rows: normalizeRows(result.rows),
      summary: `返回 ${result.rows.length} 行结果`,
    }
  }
  const summary = summarizeMutation(result.command, toFiniteNumber(result.rowCount, 0))
  return {
    columns: ['结果'],
    rows: [{ 结果: summary }],
    summary,
  }
}

async function runSqlServerQuery(session, sql) {
  const startedAt = Date.now()
  const result = await session.client.request().query(sql)
  session.latencyMs = Date.now() - startedAt
  const rows = Array.isArray(result.recordset) ? result.recordset : []
  if (rows.length > 0) {
    return {
      columns: Object.keys(rows[0] || {}),
      rows: normalizeRows(rows),
      summary: `返回 ${rows.length} 行结果`,
    }
  }
  const affectedRows = Array.isArray(result.rowsAffected)
    ? result.rowsAffected.reduce((sum, item) => sum + toFiniteNumber(item, 0), 0)
    : 0
  const summary = summarizeMutation('SQL', affectedRows)
  return {
    columns: ['结果'],
    rows: [{ 结果: summary }],
    summary,
  }
}

async function runQuery(session, sql) {
  if (session.engine === 'PostgreSQL') return runPostgresQuery(session, sql)
  if (session.engine === 'SQL Server') return runSqlServerQuery(session, sql)
  return runMysqlQuery(session, sql)
}

function quoteIdentifier(engine, value) {
  const name = String(value || '').trim()
  if (!name) return ''
  if (engine === 'SQL Server') return `[${name.replace(/]/g, ']]')}]`
  if (engine === 'MySQL' || engine === 'MariaDB') return `\`${name.replace(/`/g, '``')}\``
  return `"${name.replace(/"/g, '""')}"`
}

function buildPreviewSql(connection, tableName, schemaName = '', limit = 50) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit || 50)))
  if (connection.engine === 'SQL Server') {
    const qualified = schemaName
      ? `${quoteIdentifier(connection.engine, schemaName)}.${quoteIdentifier(connection.engine, tableName)}`
      : quoteIdentifier(connection.engine, tableName)
    return `SELECT TOP (${safeLimit}) * FROM ${qualified}`
  }
  const qualified = schemaName && connection.engine === 'PostgreSQL'
    ? `${quoteIdentifier(connection.engine, schemaName)}.${quoteIdentifier(connection.engine, tableName)}`
    : quoteIdentifier(connection.engine, tableName)
  return `SELECT * FROM ${qualified} LIMIT ${safeLimit}`
}

function getConnectionRowById(currentDb, id) {
  return (Array.isArray(currentDb?.data?.db_connections) ? currentDb.data.db_connections : [])
    .map(normalizeStoredConnection)
    .find((item) => item.id === id) || null
}

async function reconnectSession(connectionId, connection) {
  const previous = sessionMap.get(connectionId)
  if (previous) {
    await closeSession(previous)
    sessionMap.delete(connectionId)
  }
  const session = await createSession(connection)
  sessionMap.set(connectionId, session)
  return session
}

async function ensureConnected(connectionId, deps, options = {}) {
  const currentDb = deps.requireDbReady()
  const connection = getConnectionRowById(currentDb, connectionId)
  if (!connection) throw new Error('数据库连接不存在')

  let session = sessionMap.get(connectionId)
  if (!session || options.reconnect) {
    session = await reconnectSession(connectionId, connection)
  }

  if (options.refreshDatabases) {
    const databases = await listDatabases(session, connection)
    session.databases = databases
  }

  if (options.refreshTables) {
    const { tables, schemas } = await listTables(session, connection)
    session.tables = tables
    session.schemas = schemas
  }

  return {
    connection,
    session,
    item: makeRendererConnection(connection, { session }),
  }
}

export function registerDatabaseIpc(ipcMain, deps) {
  const {
    app,
    BrowserWindow,
    dialog,
    fs,
    path,
    requireDbReady,
    refreshDbFromDisk,
    uuidv4,
    logMain,
    appendAuditLog,
  } = deps

  ipcMain.handle('db:list-connections', async () => {
    try {
      refreshDbFromDisk('db:list-connections', true)
      const currentDb = requireDbReady()
      const items = (Array.isArray(currentDb.data.db_connections) ? currentDb.data.db_connections : [])
        .map(normalizeStoredConnection)
        .sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0))
        .map((row) => makeRendererConnection(row, { session: sessionMap.get(row.id) || null }))
      return { ok: true, items }
    } catch (error) {
      return { ok: false, error: error?.message || '读取数据库连接失败', items: [] }
    }
  })

  ipcMain.handle('db:save-connection', async (_event, payload) => {
    const parsed = safeParse(dbConnectionSchema, payload)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    try {
      refreshDbFromDisk('db:save-connection', true)
      const currentDb = requireDbReady()
      const now = Date.now()
      const input = parsed.data
      const id = String(input.id || uuidv4())
      const existing = getConnectionRowById(currentDb, id)
      const row = {
        id,
        name: input.name,
        engine: normalizeEngine(input.engine),
        host: input.host,
        port: toFiniteNumber(input.port, getDefaultPort(input.engine)),
        username: input.username,
        password: input.password || '',
        database: input.database || '',
        note: input.note || '',
        created_at: Number(existing?.created_at || now),
        updated_at: now,
      }
      const rows = Array.isArray(currentDb.data.db_connections) ? currentDb.data.db_connections.map(normalizeStoredConnection) : []
      const nextRows = rows.filter((item) => item.id !== id)
      nextRows.push(row)
      currentDb.data.db_connections = nextRows
      currentDb.save()

      const existingSession = sessionMap.get(id)
      if (existingSession) {
        await closeSession(existingSession)
        sessionMap.delete(id)
      }

      appendAuditLog({
        source: 'database',
        action: existing ? 'update' : 'create',
        target: row.name,
        content: `${row.engine} ${row.host}:${row.port}/${row.database || '-'}`,
      })

      return { ok: true, id, item: makeRendererConnection(row) }
    } catch (error) {
      return { ok: false, error: error?.message || '保存数据库连接失败' }
    }
  })

  ipcMain.handle('db:delete-connection', async (_event, payload) => {
    const parsed = safeParse(dbConnectionIdSchema, payload)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    try {
      refreshDbFromDisk('db:delete-connection', true)
      const currentDb = requireDbReady()
      const target = getConnectionRowById(currentDb, parsed.data.id)
      if (!target) return { ok: false, error: '数据库连接不存在' }

      const existingSession = sessionMap.get(target.id)
      if (existingSession) {
        await closeSession(existingSession)
        sessionMap.delete(target.id)
      }

      currentDb.data.db_connections = (Array.isArray(currentDb.data.db_connections) ? currentDb.data.db_connections : [])
        .map(normalizeStoredConnection)
        .filter((item) => item.id !== target.id)
      currentDb.save()

      appendAuditLog({
        source: 'database',
        action: 'delete',
        target: target.name,
        content: `${target.engine} ${target.host}:${target.port}/${target.database || '-'}`,
      })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error?.message || '删除数据库连接失败' }
    }
  })

  ipcMain.handle('db:connect', async (_event, payload) => {
    const parsed = safeParse(dbConnectionIdSchema, payload)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    try {
      refreshDbFromDisk('db:connect', true)
      const currentDb = requireDbReady()
      const connection = getConnectionRowById(currentDb, parsed.data.id)
      if (!connection) return { ok: false, error: '数据库连接不存在' }
      const connectTarget = { ...connection, database: '' }
      const session = await reconnectSession(parsed.data.id, connectTarget)
      const databases = await listDatabases(session, connectTarget)
      session.databases = databases
      session.tables = []
      session.schemas = []
      session.database = ''
      appendAuditLog({
        source: 'database',
        action: 'connect',
        target: connection.name,
        content: `${connection.engine} ${connection.host}:${connection.port}/-`,
      })
      return {
        ok: true,
        item: makeRendererConnection(connection, { session, database: '' }),
      }
    } catch (error) {
      const message = error?.message || '数据库连接失败'
      logMain(`db:connect failed id=${parsed.data.id} error=${message}`)
      return { ok: false, error: message }
    }
  })

  ipcMain.handle('db:disconnect', async (_event, payload) => {
    const parsed = safeParse(dbConnectionIdSchema, payload)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    try {
      refreshDbFromDisk('db:disconnect', false)
      const currentDb = requireDbReady()
      const target = getConnectionRowById(currentDb, parsed.data.id)
      if (!target) return { ok: false, error: '数据库连接不存在' }
      const session = sessionMap.get(target.id)
      if (session) {
        await closeSession(session)
        sessionMap.delete(target.id)
      }
      appendAuditLog({
        source: 'database',
        action: 'disconnect',
        target: target.name,
        content: `${target.engine} ${target.host}:${target.port}/${target.database || '-'}`,
      })
      return { ok: true, item: makeRendererConnection(target) }
    } catch (error) {
      return { ok: false, error: error?.message || '断开数据库连接失败' }
    }
  })

  ipcMain.handle('db:list-tables', async (_event, payload) => {
    const parsed = safeParse(dbConnectionIdSchema, payload)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    try {
      refreshDbFromDisk('db:list-tables', true)
      const { connection, session } = await ensureConnected(parsed.data.id, { requireDbReady, refreshDbFromDisk }, {
        refreshDatabases: true,
        refreshTables: true,
      })
      return {
        ok: true,
        databases: Array.isArray(session.databases) ? session.databases : [],
        tables: Array.isArray(session.tables) ? session.tables : [],
        schemas: Array.isArray(session.schemas) ? session.schemas : [],
        item: makeRendererConnection(connection, { session }),
      }
    } catch (error) {
      const message = error?.message || '读取表清单失败'
      logMain(`db:list-tables failed id=${parsed.data.id} error=${message}`)
      return { ok: false, error: message, tables: [], schemas: [] }
    }
  })

  ipcMain.handle('db:list-databases', async (_event, payload) => {
    const parsed = safeParse(dbConnectionIdSchema, payload)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    try {
      refreshDbFromDisk('db:list-databases', true)
      const { connection, session } = await ensureConnected(parsed.data.id, { requireDbReady, refreshDbFromDisk }, {
        refreshDatabases: true,
      })
      return {
        ok: true,
        databases: Array.isArray(session.databases) ? session.databases : [],
        item: makeRendererConnection(connection, { session }),
      }
    } catch (error) {
      const message = error?.message || '读取数据库清单失败'
      logMain(`db:list-databases failed id=${parsed.data.id} error=${message}`)
      return { ok: false, error: message, databases: [] }
    }
  })

  ipcMain.handle('db:select-database', async (_event, payload) => {
    const parsed = safeParse(dbSelectDatabaseSchema, payload)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    try {
      refreshDbFromDisk('db:select-database', true)
      const currentDb = requireDbReady()
      const target = getConnectionRowById(currentDb, parsed.data.id)
      if (!target) return { ok: false, error: '数据库连接不存在' }

      const sessionTarget = {
        ...normalizeStoredConnection(target),
        database: parsed.data.database,
      }
      const session = await reconnectSession(sessionTarget.id, sessionTarget)
      const databases = await listDatabases(session, sessionTarget)
      const { tables, schemas } = await listTables(session, sessionTarget)
      session.databases = databases
      session.tables = tables
      session.schemas = schemas

      return {
        ok: true,
        databases,
        tables,
        schemas,
        item: makeRendererConnection(target, { session, database: parsed.data.database }),
      }
    } catch (error) {
      const message = error?.message || '切换数据库失败'
      logMain(`db:select-database failed id=${parsed.data.id} error=${message}`)
      return { ok: false, error: message }
    }
  })

  ipcMain.handle('db:query', async (_event, payload) => {
    const parsed = safeParse(dbQuerySchema, payload)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    try {
      refreshDbFromDisk('db:query', true)
      const { connection, session } = await ensureConnected(parsed.data.id, { requireDbReady, refreshDbFromDisk })
      const result = await runQuery(session, parsed.data.sql)
      appendAuditLog({
        source: 'database',
        action: 'query',
        target: connection.name,
        content: parsed.data.sql.slice(0, 400),
      })
      return {
        ok: true,
        ...result,
        item: makeRendererConnection(connection, { session }),
      }
    } catch (error) {
      const message = error?.message || '执行 SQL 失败'
      logMain(`db:query failed id=${parsed.data.id} error=${message}`)
      return { ok: false, error: message }
    }
  })

  ipcMain.handle('db:export-query', async (_event, payload) => {
    const parsed = safeParse(dbExportQuerySchema, payload)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    try {
      const columns = Array.isArray(parsed.data.columns) ? parsed.data.columns : []
      const rows = Array.isArray(parsed.data.rows) ? parsed.data.rows : []
      if (!columns.length) return { ok: false, error: '没有可导出的查询结果' }
      const win = BrowserWindow.getFocusedWindow()
      const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
      const defaultPath = path.join(app.getPath('documents'), `${sanitizeExportFileName(parsed.data.name)}-${stamp}.xls`)
      const picked = await dialog.showSaveDialog(win, {
        title: '导出查询结果',
        defaultPath,
        filters: [{ name: 'Excel', extensions: ['xls'] }],
      })
      if (picked.canceled || !picked.filePath) return { ok: false, error: '已取消' }
      const content = buildExcelXml(columns, rows)
      fs.writeFileSync(picked.filePath, content, 'utf8')
      appendAuditLog({
        source: 'database',
        action: 'export',
        target: String(parsed.data.name || 'query-result'),
        content: picked.filePath,
      })
      return { ok: true, filePath: picked.filePath }
    } catch (error) {
      const message = error?.message || '导出查询结果失败'
      logMain(`db:export-query failed error=${message}`)
      return { ok: false, error: message }
    }
  })

  ipcMain.handle('db:preview-table', async (_event, payload) => {
    const parsed = safeParse(dbPreviewTableSchema, payload)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    try {
      refreshDbFromDisk('db:preview-table', true)
      const { connection, session } = await ensureConnected(parsed.data.id, { requireDbReady, refreshDbFromDisk })
      const sql = buildPreviewSql(connection, parsed.data.tableName, parsed.data.schemaName, parsed.data.limit)
      const result = await runQuery(session, sql)
      return {
        ok: true,
        sql,
        ...result,
        item: makeRendererConnection(connection, { session }),
      }
    } catch (error) {
      const message = error?.message || '读取表内容失败'
      logMain(`db:preview-table failed id=${parsed.data.id} error=${message}`)
      return { ok: false, error: message }
    }
  })
}
