import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronBinary = require('electron')

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appRoot = path.resolve(__dirname, '..')
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'astrashell-folder-sync-'))
const userDataDir = path.join(tmpRoot, 'userData')
const localDataPath = path.join(tmpRoot, 'local', 'astrashell.data.json')
const remoteDataPath = path.join(tmpRoot, 'remote', 'astrashell.data.json')
const reportPath = path.join(tmpRoot, 'report.json')

fs.mkdirSync(userDataDir, { recursive: true })
fs.mkdirSync(path.dirname(localDataPath), { recursive: true })
fs.mkdirSync(path.dirname(remoteDataPath), { recursive: true })

console.log('[folder-sync-smoke] tmpRoot:', tmpRoot)

const child = spawn(electronBinary, ['.'], {
  cwd: appRoot,
  env: {
    ...process.env,
    ASTRASHELL_SMOKE_FOLDER_SYNC: '1',
    ASTRASHELL_SMOKE_USER_DATA_DIR: userDataDir,
    ASTRASHELL_DATA_PATH: localDataPath,
    ASTRASHELL_SMOKE_REMOTE_PATH: remoteDataPath,
    ASTRASHELL_SMOKE_REPORT_PATH: reportPath,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
  },
  stdio: 'inherit',
})

child.on('exit', (code, signal) => {
  let report = null
  try {
    if (fs.existsSync(reportPath)) report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
  } catch {}

  if (report) {
    console.log('[folder-sync-smoke] summary:')
    console.log(JSON.stringify({
      ok: report.ok,
      localPath: report.localPath,
      remotePath: report.remotePath,
      finalStatus: report.finalStatus || {},
      revisions: report.revisions || {},
      steps: report.steps || [],
    }, null, 2))
  }

  if (code === 0 && report?.ok) {
    process.exit(0)
    return
  }

  if (signal) {
    console.error(`[folder-sync-smoke] electron exited by signal: ${signal}`)
  } else {
    console.error(`[folder-sync-smoke] electron exited with code: ${code ?? 'unknown'}`)
  }
  process.exit(1)
})
