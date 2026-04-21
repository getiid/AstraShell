import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import {
  safeParse,
  sftpDeleteSchema,
  sftpDownloadSchema,
  sftpDownloadToLocalSchema,
  sftpListSchema,
  sftpMkdirSchema,
  sftpRenameSchema,
  sftpUploadSchema,
} from './schemas.mjs'

export function registerSftpIpc(ipcMain, deps) {
  const { withSftp, broadcast } = deps

  const joinRemotePath = (...parts) => {
    const filtered = parts
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .map((item, index) => (index === 0 ? item : item.replace(/^\/+/, '')))
    if (filtered.length === 0) return '.'
    const joined = path.posix.join(...filtered)
    return joined || '.'
  }

  const resolveConflictPath = (filePath) => {
    if (!fs.existsSync(filePath)) return filePath
    const dir = path.dirname(filePath)
    const ext = path.extname(filePath)
    const base = path.basename(filePath, ext)
    for (let i = 1; i < 9999; i += 1) {
      const candidate = path.join(dir, `${base} (${i})${ext}`)
      if (!fs.existsSync(candidate)) return candidate
    }
    return `${filePath}.${Date.now()}`
  }

  const getRemoteStat = (sftp, remotePath) => new Promise((resolve) => {
    sftp.stat(remotePath, (err, stats) => {
      if (err) return resolve(null)
      resolve(stats || null)
    })
  })

  const ensureRemoteDir = async (sftp, remoteDir) => {
    const target = String(remoteDir || '.').trim()
    if (!target || target === '.') return
    const normalized = path.posix.normalize(target)
    const segments = normalized.split('/').filter(Boolean)
    const isAbsolute = normalized.startsWith('/')
    let current = isAbsolute ? '/' : '.'
    for (const segment of segments) {
      current = current === '/' ? `/${segment}` : joinRemotePath(current, segment)
      const existing = await getRemoteStat(sftp, current)
      if (existing) continue
      const created = await new Promise((resolve) => {
        sftp.mkdir(current, {}, (err) => {
          if (err) return resolve({ ok: false, error: err.message })
          resolve({ ok: true })
        })
      })
      if (!created.ok) throw new Error(created.error || `创建远程目录失败：${current}`)
    }
  }

  const collectLocalTreeEntries = async (rootPath) => {
    const rootName = path.basename(rootPath)
    const directories = [{ relativePath: '', remoteDirName: rootName }]
    const files = []

    const walk = async (currentPath, relativePath) => {
      const entries = await fs.promises.readdir(currentPath, { withFileTypes: true })
      for (const entry of entries) {
        const entryPath = path.join(currentPath, entry.name)
        const nextRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name
        if (entry.isDirectory()) {
          directories.push({ relativePath: nextRelativePath, remoteDirName: entry.name })
          await walk(entryPath, nextRelativePath)
          continue
        }
        if (!entry.isFile()) continue
        files.push({
          localFile: entryPath,
          relativePath: nextRelativePath,
          remoteFileName: entry.name,
        })
      }
    }

    await walk(rootPath, '')
    return { rootName, directories, files }
  }

  const uploadSingleFile = async (sftp, options) => {
    const { localFile, remoteDir, remoteFileName, conflictPolicy, resume } = options
    const remoteFile = joinRemotePath(remoteDir || '.', remoteFileName || path.basename(localFile))
    const resolvedConflictPolicy = conflictPolicy || (resume ? 'resume' : 'overwrite')
    const remoteStat = await getRemoteStat(sftp, remoteFile)
    const remoteSize = Number(remoteStat?.size || 0)

    if (remoteStat) {
      if (resolvedConflictPolicy === 'skip') return { ok: true, skipped: true, localFile, remoteFile }
      if (resolvedConflictPolicy === 'rename') {
        const ext = path.extname(remoteFile)
        const base = path.basename(remoteFile, ext)
        const dir = path.posix.dirname(remoteFile)
        let candidate = remoteFile
        for (let i = 1; i < 9999; i += 1) {
          candidate = `${dir === '.' ? '' : dir + '/'}${base} (${i})${ext}`
          const exists = await getRemoteStat(sftp, candidate)
          if (!exists) break
        }
        return streamUploadWithResume(sftp, localFile, candidate, 0)
      }
    }

    if (resolvedConflictPolicy === 'resume' && remoteSize > 0) {
      return streamUploadWithResume(sftp, localFile, remoteFile, remoteSize)
    }

    return await new Promise((resolve) => {
      sftp.fastPut(
        localFile,
        remoteFile,
        {
          step: (totalTransferred, _chunk, total) => {
            const percent = total > 0 ? Math.min(100, Math.floor((totalTransferred / total) * 100)) : 0
            broadcast('sftp:progress', { type: 'upload', percent, transferred: totalTransferred, total })
          },
        },
        (err) => {
          if (err) return resolve({ ok: false, error: err.message })
          broadcast('sftp:progress', { type: 'upload', percent: 100, done: true })
          resolve({ ok: true, localFile, remoteFile })
        },
      )
    })
  }

  const uploadDirectory = async (sftp, localDir, options = {}) => {
    const tree = await collectLocalTreeEntries(localDir)
    const conflictPolicy = options.conflictPolicy || (options.resume ? 'resume' : 'overwrite')
    let rootRemoteDir = joinRemotePath(options.remoteDir || '.', tree.rootName)
    const rootRemoteStat = await getRemoteStat(sftp, rootRemoteDir)

    if (rootRemoteStat) {
      if (conflictPolicy === 'skip') {
        return { ok: true, skipped: true, localFile: localDir, remoteDir: rootRemoteDir, folderMode: true }
      }
      if (conflictPolicy === 'rename') {
        const parentDir = path.posix.dirname(rootRemoteDir)
        const baseName = path.posix.basename(rootRemoteDir)
        for (let i = 1; i < 9999; i += 1) {
          const candidate = joinRemotePath(parentDir === '.' ? '' : parentDir, `${baseName} (${i})`)
          const exists = await getRemoteStat(sftp, candidate)
          if (exists) continue
          rootRemoteDir = candidate
          break
        }
      }
    }

    await ensureRemoteDir(sftp, rootRemoteDir)

    for (const directory of tree.directories) {
      const currentRemoteDir = directory.relativePath
        ? joinRemotePath(rootRemoteDir, directory.relativePath)
        : rootRemoteDir
      await ensureRemoteDir(sftp, currentRemoteDir)
    }

    let lastRemoteFile = rootRemoteDir
    for (const file of tree.files) {
      const relativeDir = path.dirname(file.relativePath)
      const nextRemoteDir = relativeDir === '.' ? rootRemoteDir : joinRemotePath(rootRemoteDir, relativeDir)
      const result = await uploadSingleFile(sftp, {
        localFile: file.localFile,
        remoteDir: nextRemoteDir,
        remoteFileName: file.remoteFileName,
        conflictPolicy,
        resume: options.resume,
      })
      if (!result.ok) return result
      lastRemoteFile = result.remoteFile || lastRemoteFile
    }

    return {
      ok: true,
      localFile: localDir,
      remoteFile: lastRemoteFile,
      remoteDir: rootRemoteDir,
      uploadedFiles: tree.files.length,
      uploadedDirs: tree.directories.length,
      folderMode: true,
      empty: tree.files.length === 0,
    }
  }

  const streamDownloadWithResume = (sftp, remoteFile, localFile, resumeEnabled) => new Promise((resolve) => {
    const localSize = resumeEnabled && fs.existsSync(localFile) ? Number(fs.statSync(localFile)?.size || 0) : 0
    const remote = sftp.createReadStream(remoteFile, localSize > 0 ? { start: localSize } : undefined)
    const local = fs.createWriteStream(localFile, localSize > 0 ? { flags: 'a' } : undefined)
    let transferred = localSize
    remote.on('data', (chunk) => {
      transferred += Number(chunk?.length || 0)
      broadcast('sftp:progress', { type: 'download', transferred })
    })
    remote.on('error', (err) => resolve({ ok: false, error: err?.message || '下载失败' }))
    local.on('error', (err) => resolve({ ok: false, error: err?.message || '写入本地文件失败' }))
    local.on('close', () => {
      broadcast('sftp:progress', { type: 'download', percent: 100, done: true })
      resolve({ ok: true, filePath: localFile, resumedFrom: localSize })
    })
    remote.pipe(local)
  })

  const streamUploadWithResume = (sftp, localFile, remoteFile, remoteOffset) => new Promise((resolve) => {
    const localStat = fs.statSync(localFile)
    if (remoteOffset >= Number(localStat?.size || 0)) return resolve({ ok: true, localFile, remoteFile, skipped: true })
    const reader = fs.createReadStream(localFile, remoteOffset > 0 ? { start: remoteOffset } : undefined)
    const writer = sftp.createWriteStream(remoteFile, remoteOffset > 0 ? { flags: 'a' } : undefined)
    let transferred = remoteOffset
    reader.on('data', (chunk) => {
      transferred += Number(chunk?.length || 0)
      const total = Number(localStat?.size || 0)
      const percent = total > 0 ? Math.min(100, Math.floor((transferred / total) * 100)) : 0
      broadcast('sftp:progress', { type: 'upload', percent, transferred, total })
    })
    reader.on('error', (err) => resolve({ ok: false, error: err?.message || '读取本地文件失败' }))
    writer.on('error', (err) => resolve({ ok: false, error: err?.message || '写入远程文件失败' }))
    writer.on('close', () => {
      broadcast('sftp:progress', { type: 'upload', percent: 100, done: true })
      resolve({ ok: true, localFile, remoteFile, resumedFrom: remoteOffset })
    })
    reader.pipe(writer)
  })

  ipcMain.handle('sftp:list', async (_event, payload) => {
    const parsed = safeParse(sftpListSchema, payload)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const validatedPayload = parsed.data
    return withSftp(validatedPayload, async (sftp) => {
      const remotePath = validatedPayload.remotePath || '.'
      return await new Promise((resolve) => {
        sftp.readdir(remotePath, (readErr, list) => {
          if (readErr) return resolve({ ok: false, error: readErr.message })
          const rows = (list || []).map((item) => ({
            filename: item.filename,
            longname: item.longname,
            size: item.attrs?.size,
            createdAt: item.attrs?.ctime || item.attrs?.mtime || 0,
            mtime: item.attrs?.mtime,
            modifiedAt: item.attrs?.mtime || 0,
            isDir: !!(item.attrs?.mode && (item.attrs.mode & 0o40000)),
          }))
          resolve({ ok: true, items: rows })
        })
      })
    })
  })

  ipcMain.handle('sftp:download', async (_event, payload) => {
    const parsed = safeParse(sftpDownloadSchema, payload)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const validatedPayload = parsed.data
    return withSftp(validatedPayload, async (sftp) => {
      const win = BrowserWindow.getFocusedWindow()
      const save = await dialog.showSaveDialog(win, { title: '保存文件到本地', defaultPath: path.basename(validatedPayload.remoteFile || 'download.bin') })
      if (save.canceled || !save.filePath) return { ok: false, error: '已取消' }

      const conflictPolicy = validatedPayload.conflictPolicy || (validatedPayload.resume ? 'resume' : 'overwrite')
      let targetPath = save.filePath
      if (fs.existsSync(targetPath)) {
        if (conflictPolicy === 'skip') return { ok: true, skipped: true, filePath: targetPath }
        if (conflictPolicy === 'rename') targetPath = resolveConflictPath(targetPath)
      }
      if (conflictPolicy === 'resume') {
        return streamDownloadWithResume(sftp, validatedPayload.remoteFile, targetPath, true)
      }

      return await new Promise((resolve) => {
        sftp.fastGet(
          validatedPayload.remoteFile,
          targetPath,
          {
            step: (totalTransferred, _chunk, total) => {
              const percent = total > 0 ? Math.min(100, Math.floor((totalTransferred / total) * 100)) : 0
              broadcast('sftp:progress', { type: 'download', percent, transferred: totalTransferred, total })
            },
          },
          (err) => {
            if (err) return resolve({ ok: false, error: err.message })
            broadcast('sftp:progress', { type: 'download', percent: 100, done: true })
            resolve({ ok: true, filePath: targetPath })
          },
        )
      })
    })
  })

  ipcMain.handle('sftp:download-to-local', async (_event, payload) => {
    const parsed = safeParse(sftpDownloadToLocalSchema, payload)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const validatedPayload = parsed.data
    return withSftp(validatedPayload, async (sftp) => {
      const filename = validatedPayload.filename || path.basename(validatedPayload.remoteFile || 'download.bin')
      let localFile = path.join(validatedPayload.localDir || app.getPath('downloads'), filename)
      const conflictPolicy = validatedPayload.conflictPolicy || (validatedPayload.resume ? 'resume' : 'overwrite')
      if (fs.existsSync(localFile)) {
        if (conflictPolicy === 'skip') return { ok: true, skipped: true, filePath: localFile }
        if (conflictPolicy === 'rename') localFile = resolveConflictPath(localFile)
      }
      if (conflictPolicy === 'resume') {
        return streamDownloadWithResume(sftp, validatedPayload.remoteFile, localFile, true)
      }
      return await new Promise((resolve) => {
        sftp.fastGet(
          validatedPayload.remoteFile,
          localFile,
          {
            step: (totalTransferred, _chunk, total) => {
              const percent = total > 0 ? Math.min(100, Math.floor((totalTransferred / total) * 100)) : 0
              broadcast('sftp:progress', { type: 'download', percent, transferred: totalTransferred, total })
            },
          },
          (err) => {
            if (err) return resolve({ ok: false, error: err.message })
            broadcast('sftp:progress', { type: 'download', percent: 100, done: true })
            resolve({ ok: true, filePath: localFile })
          },
        )
      })
    })
  })

  ipcMain.handle('sftp:mkdir', async (_event, payload) => {
    const parsed = safeParse(sftpMkdirSchema, payload)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const validatedPayload = parsed.data
    return withSftp(validatedPayload, async (sftp) => {
      return await new Promise((resolve) => {
        sftp.mkdir(validatedPayload.remoteDir, {}, (err) => {
          if (err) return resolve({ ok: false, error: err.message })
          resolve({ ok: true })
        })
      })
    })
  })

  ipcMain.handle('sftp:rename', async (_event, payload) => {
    const parsed = safeParse(sftpRenameSchema, payload)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const validatedPayload = parsed.data
    return withSftp(validatedPayload, async (sftp) => {
      return await new Promise((resolve) => {
        sftp.rename(validatedPayload.oldPath, validatedPayload.newPath, (err) => {
          if (err) return resolve({ ok: false, error: err.message })
          resolve({ ok: true })
        })
      })
    })
  })

  ipcMain.handle('sftp:delete', async (_event, payload) => {
    const parsed = safeParse(sftpDeleteSchema, payload)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const validatedPayload = parsed.data
    return withSftp(validatedPayload, async (sftp) => {
      return await new Promise((resolve) => {
        sftp.unlink(validatedPayload.remoteFile, (err) => {
          if (!err) return resolve({ ok: true })
          sftp.rmdir(validatedPayload.remoteFile, (err2) => {
            if (err2) return resolve({ ok: false, error: err2.message })
            resolve({ ok: true })
          })
        })
      })
    })
  })

  ipcMain.handle('sftp:upload', async (_event, payload) => {
    const parsed = safeParse(sftpUploadSchema, payload)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const validatedPayload = parsed.data
    return withSftp(validatedPayload, async (sftp) => {
      let localFile = validatedPayload.localFile
      if (!localFile) {
        const win = BrowserWindow.getFocusedWindow()
        const pick = await dialog.showOpenDialog(win, {
          title: '选择本地文件或文件夹上传',
          properties: ['openFile', 'openDirectory'],
        })
        if (pick.canceled || !pick.filePaths?.[0]) return { ok: false, error: '已取消' }
        localFile = pick.filePaths[0]
      }
      const localStat = await fs.promises.stat(localFile)
      if (localStat.isDirectory()) {
        return uploadDirectory(sftp, localFile, {
          remoteDir: validatedPayload.remoteDir,
          conflictPolicy: validatedPayload.conflictPolicy,
          resume: validatedPayload.resume,
        })
      }
      return uploadSingleFile(sftp, {
        localFile,
        remoteDir: validatedPayload.remoteDir,
        remoteFileName: validatedPayload.remoteFileName,
        conflictPolicy: validatedPayload.conflictPolicy,
        resume: validatedPayload.resume,
      })
    })
  })
}
