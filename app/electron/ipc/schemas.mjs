import { z } from 'zod'

const nonEmpty = z.string().trim().min(1)

export const remoteConnSchema = z.object({
  host: nonEmpty,
  port: z.coerce.number().int().min(1).max(65535).default(22),
  username: nonEmpty,
  password: z.string().optional(),
  privateKey: z.string().optional(),
  passphrase: z.string().optional(),
})

export const setStorageFolderSchema = z.object({
  folder: nonEmpty,
})

export const syncSetConfigSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.enum(['folder', 'http']).default('folder'),
  targetPath: z.string().trim().default(''),
  baseUrl: z.string().trim().default(''),
  token: z.string().trim().default(''),
  password: z.string().default(''),
  autoPullOnStartup: z.boolean().default(true),
  autoPushOnChange: z.boolean().default(true),
  debounceMs: z.coerce.number().int().min(300).max(60000).default(1500),
})

export const localFsListSchema = z.object({
  localPath: z.string().trim().optional(),
})

export const sshSessionIdSchema = z.object({
  sessionId: nonEmpty,
})

export const sshConnectSchema = remoteConnSchema.extend({
  sessionId: nonEmpty,
  displayName: z.string().optional(),
})

export const sshExecScriptSchema = remoteConnSchema.extend({
  script: nonEmpty,
  timeoutMs: z.coerce.number().int().min(1000).max(600000).default(120000),
})

export const sshWriteSchema = z.object({
  sessionId: nonEmpty,
  data: z.string().default(''),
})

export const sshResizeSchema = z.object({
  sessionId: nonEmpty,
  cols: z.coerce.number().int().min(20).max(500).default(120),
  rows: z.coerce.number().int().min(8).max(200).default(30),
})

export const sftpListSchema = remoteConnSchema.extend({
  remotePath: z.string().trim().optional(),
})

export const sftpDownloadSchema = remoteConnSchema.extend({
  remoteFile: nonEmpty,
  resume: z.boolean().optional(),
  conflictPolicy: z.enum(['overwrite', 'resume', 'skip', 'rename']).optional(),
})

export const sftpDownloadToLocalSchema = remoteConnSchema.extend({
  remoteFile: nonEmpty,
  localDir: z.string().optional(),
  filename: nonEmpty,
  resume: z.boolean().optional(),
  conflictPolicy: z.enum(['overwrite', 'resume', 'skip', 'rename']).optional(),
})

export const sftpMkdirSchema = remoteConnSchema.extend({
  remoteDir: nonEmpty,
})

export const sftpRenameSchema = remoteConnSchema.extend({
  oldPath: nonEmpty,
  newPath: nonEmpty,
})

export const sftpDeleteSchema = remoteConnSchema.extend({
  remoteFile: nonEmpty,
})

export const sftpUploadSchema = remoteConnSchema.extend({
  remoteDir: z.string().trim().default('.'),
  localFile: z.string().optional(),
  resume: z.boolean().optional(),
  conflictPolicy: z.enum(['overwrite', 'resume', 'skip', 'rename']).optional(),
  remoteFileName: z.string().trim().optional(),
})

const dbEngineSchema = z.enum(['MySQL', 'MariaDB', 'PostgreSQL', 'SQL Server'])

export const dbConnectionIdSchema = z.object({
  id: nonEmpty,
})

export const dbSelectDatabaseSchema = z.object({
  id: nonEmpty,
  database: nonEmpty,
})

export const dbConnectionSchema = z.object({
  id: z.string().trim().optional(),
  name: nonEmpty,
  engine: dbEngineSchema,
  host: nonEmpty,
  port: z.coerce.number().int().min(1).max(65535),
  username: nonEmpty,
  password: z.string().default(''),
  database: z.string().trim().default(''),
  note: z.string().trim().default(''),
})

export const dbQuerySchema = z.object({
  id: nonEmpty,
  sql: nonEmpty,
})

export const dbExportQuerySchema = z.object({
  id: z.string().trim().optional(),
  name: z.string().trim().default('query-result'),
  columns: z.array(z.string()).default([]),
  rows: z.array(z.record(z.string(), z.any())).default([]),
})

export const dbPreviewTableSchema = z.object({
  id: nonEmpty,
  tableName: nonEmpty,
  schemaName: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
})

export function safeParse(schema, payload) {
  const parsed = schema.safeParse(payload ?? {})
  if (!parsed.success) {
    const first = parsed.error.issues?.[0]
    return { ok: false, error: first?.message || '参数无效' }
  }
  return { ok: true, data: parsed.data }
}
