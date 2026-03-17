import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { localFsListSchema, safeParse } from './schemas.mjs'

function listWindowsDriveRoots() {
  const roots = []
  for (let code = 65; code <= 90; code += 1) {
    const letter = String.fromCharCode(code)
    const driveRoot = `${letter}:\\`
    try {
      if (!fs.existsSync(driveRoot)) continue
      roots.push({
        name: `${letter}:`,
        isDir: true,
        path: driveRoot,
        size: 0,
        createdAt: 0,
        modifiedAt: 0,
      })
    } catch {}
  }
  return roots
}

export function registerLocalFsIpc(ipcMain) {
  ipcMain.handle('localfs:list', async (_event, payload) => {
    const parsed = safeParse(localFsListSchema, payload)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const requestedPath = String(parsed.data.localPath || '').trim()
    if (process.platform === 'win32' && !requestedPath) {
      return { ok: true, path: '', items: listWindowsDriveRoots() }
    }
    const localPath = requestedPath || os.homedir()
    try {
      const entries = await fs.promises.readdir(localPath, { withFileTypes: true })
      const STAT_THRESHOLD = 260
      const shouldReadStats = entries.length <= STAT_THRESHOLD

      let statsByName = new Map()
      if (shouldReadStats) {
        const stats = await Promise.all(entries.map(async (entry) => {
          const fullPath = path.join(localPath, entry.name)
          try {
            const stat = await fs.promises.stat(fullPath)
            return [entry.name, stat]
          } catch {
            return [entry.name, null]
          }
        }))
        statsByName = new Map(stats)
      }

      const items = entries.map((entry) => {
        const fullPath = path.join(localPath, entry.name)
        const stat = shouldReadStats ? statsByName.get(entry.name) : null
        return {
          name: entry.name,
          isDir: entry.isDirectory(),
          path: fullPath,
          size: stat?.size || 0,
          createdAt: stat?.birthtimeMs || stat?.ctimeMs || 0,
          modifiedAt: stat?.mtimeMs || 0,
        }
      })
      return { ok: true, path: localPath, items }
    } catch (e) {
      return { ok: false, error: e?.message || '本地目录读取失败' }
    }
  })
}
