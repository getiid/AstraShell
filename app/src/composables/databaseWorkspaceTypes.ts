export type DbEngine = 'MySQL' | 'MariaDB' | 'PostgreSQL' | 'SQL Server'
export type DbState = 'connected' | 'idle' | 'offline'

export type DatabaseTable = {
  name: string
  tableName?: string
  schemaName?: string
  rows: number
  size: string
  updatedAt: string
}

export type DatabaseConnection = {
  id: string
  name: string
  engine: DbEngine
  host: string
  port: number
  username: string
  password?: string
  database: string
  note: string
  state: DbState
  version: string
  latency: string
  databases: string[]
  schemas: string[]
  tables: DatabaseTable[]
  lastError?: string
}

export type QueryRow = Record<string, string | number | boolean>

export type DatabaseSnippetItem = {
  id: string
  name: string
  category: string
  commands: string
}

export type DatabaseConnectionPayload = {
  id?: string
  name: string
  engine: DbEngine
  host: string
  port: number
  username: string
  password?: string
  database?: string
  note?: string
}
