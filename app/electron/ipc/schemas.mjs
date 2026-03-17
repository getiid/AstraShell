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

export function safeParse(schema, payload) {
  const parsed = schema.safeParse(payload ?? {})
  if (!parsed.success) {
    const first = parsed.error.issues?.[0]
    return { ok: false, error: first?.message || '参数无效' }
  }
  return { ok: true, data: parsed.data }
}
