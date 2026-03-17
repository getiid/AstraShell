import { app, BrowserWindow, ipcMain, dialog, Menu, clipboard, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { v4 as uuidv4 } from 'uuid'
import { safeParse, setStorageFolderSchema } from './ipc/schemas.mjs'
import { registerLocalFsIpc } from './ipc/localfs.mjs'
import { registerLocalIpc } from './ipc/local.mjs'
import { registerSftpIpc } from './ipc/sftp.mjs'
import { registerSshIpc } from './ipc/ssh.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDev = !app.isPackaged
try {
  const p = path.join(app.getPath('userData'), 'bootstrap.log')
  fs.appendFileSync(p, `[${new Date().toISOString()}] main loaded isDev=${isDev}\n`, 'utf8')
} catch {}
const serialPorts = new Map()
const sshSessions = new Map()
const localShellSessions = new Map()
const serialInputBuffers = new Map()
const sshInputBuffers = new Map()
const localInputBuffers = new Map()
const serialOutputBuffers = new Map()
const sshOutputBuffers = new Map()
const localOutputBuffers = new Map()
const responseLogBuffers = new Map()
let db
let vaultKey = null
let SerialPortCtor = null
let SSHClientCtor = null
let sshpkModule = null
let nodePtySpawn = null
let serialModuleLoadError = ''
let autoUpdater = null
let updaterInitialized = false
let activeUpdateProvider = 'github'
let runtimeCleanupPromise = null
let runtimeCleanupReason = ''
let suppressWindowAllClosedQuit = false
let macAutoInstallSupport = null
let activeDbPath = ''
let dbWatchTimer = null
const DATA_FILE_NAME = 'astrashell.data.json'
const LEGACY_DB_FILE_NAME = 'lightterm.db'
const MAX_AUDIT_LOGS = 5000
const macManualInstallTip = '当前构建未使用 Developer ID 签名，无法一键安装更新。请从 GitHub Release 下载 DMG 手动覆盖安装。'
const githubReleaseProvider = {
  provider: 'github',
  owner: 'getiid',
  repo: 'AstraShell',
  releaseType: 'release',
}

function stripAnsi(input) {
  return String(input || '')
    // OSC: \x1b] ... \x07 or \x1b\
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
    // CSI / single-char escapes
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
}

function sanitizeCommandLine(input) {
  return stripAnsi(input)
    .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '')
    .trim()
}

function sanitizeOutputLine(input) {
  return stripAnsi(input)
    // 某些 SSH 场景会留下 OSC 片段前缀，如 "0;root@host:..."
    .replace(/^\d+;(?=[\w.-]+@)/, '')
    .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '')
    .trim()
}

function isLikelyPromptLine(text) {
  const value = String(text || '').trim()
  if (!value) return true
  const compact = value.replace(/\s+/g, ' ')
  if (/^[\w.-]+@[\w.-]+.*[>%#$]\s*$/.test(compact)) return true
  if (/^\[[^\]]+@[\w.-]+\s+[^\]]+\][>%#$]\s*$/.test(compact)) return true
  if (/^[\w.-]+@[\w.-]+:.*\[[^\]]+\][>%#$](?:\s+.*)?$/.test(compact)) return true
  if (/^\d+;[\w.-]+@[\w.-]+:.*\[[^\]]+\][>%#$](?:\s+.*)?$/.test(compact)) return true
  return false
}

function ensureLogsArray(currentDb) {
  if (!currentDb?.data) return []
  if (!Array.isArray(currentDb.data.logs)) currentDb.data.logs = []
  return currentDb.data.logs
}

function appendAuditLog(payload = {}) {
  try {
    const currentDb = requireDbReady({ allowCreate: true })
    const logs = ensureLogsArray(currentDb)
    const now = Date.now()
    const row = {
      id: String(payload.id || uuidv4()),
      ts: Number(payload.ts || now),
      source: String(payload.source || 'app'),
      action: String(payload.action || 'event'),
      target: String(payload.target || ''),
      content: String(payload.content || ''),
      level: String(payload.level || 'info'),
    }
    logs.unshift(row)
    if (logs.length > MAX_AUDIT_LOGS) logs.splice(MAX_AUDIT_LOGS)
    currentDb.save()
    broadcast('audit:appended', row)
    return row
  } catch (e) {
    logMain(`appendAuditLog failed: ${e?.message || e}`)
    return null
  }
}

function listAuditLogsFromDb(currentDb, payload = {}) {
  const limitRaw = Number(payload?.limit || 300)
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 300, 1), MAX_AUDIT_LOGS)
  const source = String(payload?.source || '').trim()
  const keyword = String(payload?.keyword || '').trim().toLowerCase()
  let rows = [...ensureLogsArray(currentDb)].map((row) => {
    const next = { ...row }
    const content = String(next?.content || '')
    const action = String(next?.action || '')
    if (content.includes('session=') || content.includes('reason=')) {
      if (action === 'connect') next.content = '连接成功'
      else if (action === 'disconnect' && /reason=manual/i.test(content)) next.content = '用户手动断开'
      else if (action === 'disconnect' && /reason=app-exit/i.test(content)) next.content = '应用退出，自动断开'
      else if (action === 'disconnect') next.content = '会话已断开'
    }
    return next
  })
  if (source && source !== 'all') rows = rows.filter((item) => String(item?.source || '') === source)
  if (keyword) {
    rows = rows.filter((item) => `${item?.action || ''} ${item?.target || ''} ${item?.content || ''}`.toLowerCase().includes(keyword))
  }
  return rows.slice(0, limit)
}

function extractCommandLines(bufferMap, sessionId, chunk) {
  const prev = bufferMap.get(sessionId) || ''
  const merged = `${prev}${String(chunk || '')}`
  const normalized = merged.replace(/\r/g, '\n')
  const lines = normalized.split('\n')
  const tail = String(lines.pop() || '').slice(-4000)
  bufferMap.set(sessionId, tail)
  return lines
}

function logCommandLines(bufferMap, sessionId, chunk, source, target) {
  flushResponseLogsForSession(source, sessionId)
  const lines = extractCommandLines(bufferMap, sessionId, chunk)
  for (const line of lines) {
    const content = sanitizeCommandLine(line)
    if (!content) continue
    appendAuditLog({ source, action: 'command', target, content })
  }
}

function responseLogBufferKey(source, sessionId) {
  return `${String(source || 'app')}::${String(sessionId || '-')}`
}

function flushResponseLogBuffer(key) {
  const state = responseLogBuffers.get(key)
  if (!state) return
  if (state.timer) clearTimeout(state.timer)
  const lines = Array.isArray(state.lines) ? state.lines : []
  const content = lines.join('\n').trim().slice(0, 4000)
  if (content) {
    appendAuditLog({
      source: String(state.source || 'app'),
      action: 'response',
      target: String(state.target || ''),
      content,
    })
  }
  responseLogBuffers.delete(key)
}

function flushResponseLogsForSession(source, sessionId) {
  const key = responseLogBufferKey(source, sessionId)
  flushResponseLogBuffer(key)
}

function flushAllResponseLogs() {
  for (const key of [...responseLogBuffers.keys()]) flushResponseLogBuffer(key)
}

function appendResponseLogLine(source, sessionId, target, line) {
  const key = responseLogBufferKey(source, sessionId)
  let state = responseLogBuffers.get(key)
  if (!state) {
    state = {
      source: String(source || 'app'),
      target: String(target || ''),
      lines: [],
      timer: null,
    }
    responseLogBuffers.set(key, state)
  }
  if (String(target || '').trim()) state.target = String(target || '').trim()
  state.lines.push(String(line || ''))
  if (state.lines.length > 120) {
    flushResponseLogBuffer(key)
    return
  }
  if (state.timer) clearTimeout(state.timer)
  state.timer = setTimeout(() => flushResponseLogBuffer(key), 240)
}

function logOutputLines(bufferMap, sessionId, chunk, source, target) {
  const lines = extractCommandLines(bufferMap, sessionId, chunk)
  for (const line of lines) {
    const content = sanitizeOutputLine(line)
    if (!content) continue
    if (isLikelyPromptLine(content)) {
      flushResponseLogsForSession(source, sessionId)
      continue
    }
    appendResponseLogLine(source, sessionId, target, content.slice(0, 600))
  }
}

function checkMacAutoInstallSupport() {
  if (process.platform !== 'darwin' || isDev) return { supported: true, reason: '' }
  try {
    const appBundlePath = path.resolve(process.execPath, '../../..')
    const res = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=4', appBundlePath], { encoding: 'utf8' })
    const output = `${res.stdout || ''}\n${res.stderr || ''}`
    if (res.status !== 0) {
      return { supported: false, reason: '无法验证当前应用签名状态' }
    }
    if (!/Authority=Developer ID Application:/i.test(output)) {
      return { supported: false, reason: '当前应用未使用 Developer ID Application 证书签名' }
    }
    return { supported: true, reason: '' }
  } catch {
    return { supported: false, reason: '无法读取当前应用签名信息' }
  }
}

const updateState = {
  status: 'idle',
  message: isDev ? '开发模式：自动更新已禁用' : '等待检查更新',
  currentVersion: app.getVersion(),
  latestVersion: '',
  hasUpdate: false,
  downloaded: false,
  checking: false,
  downloading: false,
  progress: 0,
  source: 'github',
  downloadUrl: '',
  releaseUrl: '',
}

async function getSSHClientCtor() {
  if (SSHClientCtor) return SSHClientCtor
  const mod = await import('ssh2')
  SSHClientCtor = mod.Client
  return SSHClientCtor
}

async function createSSHClient() {
  const ClientCtor = await getSSHClientCtor()
  return new ClientCtor()
}

async function getSshpk() {
  if (sshpkModule) return sshpkModule
  const mod = await import('sshpk')
  sshpkModule = mod.default || mod
  return sshpkModule
}

async function getAutoUpdater() {
  if (autoUpdater) return autoUpdater
  const mod = await import('electron-updater')
  autoUpdater = mod.autoUpdater || mod.default?.autoUpdater || null
  if (!autoUpdater) throw new Error('无法加载自动更新模块')
  return autoUpdater
}

async function getNodePtySpawn() {
  if (nodePtySpawn) return nodePtySpawn
  const mod = await import('node-pty')
  const spawnFn = mod?.spawn || mod?.default?.spawn
  if (typeof spawnFn !== 'function') throw new Error('无法加载 node-pty')
  nodePtySpawn = spawnFn
  return nodePtySpawn
}

function getMacAutoInstallSupport() {
  if (!macAutoInstallSupport) macAutoInstallSupport = checkMacAutoInstallSupport()
  return macAutoInstallSupport
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function readSettings() {
  try {
    const p = getSettingsPath()
    if (!fs.existsSync(p)) return {}
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return {}
  }
}

function writeSettings(next) {
  const p = getSettingsPath()
  fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf8')
}

function getUpdateSourceLabel(source) {
  return 'GitHub'
}

function resolveDbPath() {
  const envPath = process.env.ASTRASHELL_DATA_PATH || process.env.LIGHTTERM_DB_PATH
  if (envPath) return normalizeStoragePath(envPath)
  const s = readSettings()
  if (s.dataPath) return normalizeStoragePath(s.dataPath)
  if (s.dbPath) {
    const legacy = String(s.dbPath)
    if (/[\\/]lightterm\.db$/i.test(legacy)) {
      return normalizeStoragePath(path.join(path.dirname(legacy), DATA_FILE_NAME))
    }
    return normalizeStoragePath(legacy)
  }
  return ''
}

function isStorageFilePath(inputPath) {
  const ext = path.extname(String(inputPath || '')).toLowerCase()
  return ext === '.json' || ext === '.db'
}

function normalizeStoragePath(inputPath) {
  const raw = String(inputPath || '').trim()
  if (!raw) return ''
  if (isStorageFilePath(raw)) return raw
  return path.join(raw, DATA_FILE_NAME)
}

function getStorageDirFromPath(inputPath) {
  const raw = String(inputPath || '').trim()
  if (!raw) return ''
  return isStorageFilePath(raw) ? path.dirname(raw) : raw
}

function getStorageSuggestionPath() {
  const configuredPath = resolveDbPath()
  if (configuredPath) return configuredPath
  return path.join(app.getPath('documents'), DATA_FILE_NAME)
}

function storageFileExists(filePath) {
  try {
    return !!(filePath && fs.existsSync(filePath))
  } catch {
    return false
  }
}

function readJsonFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function parseExtraCategories(rawValue) {
  if (Array.isArray(rawValue)) {
    return [...new Set(rawValue.map((value) => String(value || '').trim()).filter(Boolean))]
  }
  if (typeof rawValue === 'string') {
    try {
      const parsed = JSON.parse(rawValue)
      if (Array.isArray(parsed)) {
        return [...new Set(parsed.map((value) => String(value || '').trim()).filter(Boolean))]
      }
    } catch {}
  }
  return []
}

function normalizeSnippetStateForRead(payload) {
  const now = Date.now()
  const rawItems = Array.isArray(payload?.items) ? payload.items : []
  const items = rawItems
    .map((item) => {
      const name = String(item?.name || item?.title || '').trim()
      const commands = String(item?.commands ?? item?.command ?? item?.cmd ?? '')
      if (!name || !commands.trim()) return null
      const createdAtRaw = Number(item?.createdAt ?? item?.created_at ?? now)
      const updatedAtRaw = Number(item?.updatedAt ?? item?.updated_at ?? createdAtRaw ?? now)
      const createdAt = Number.isFinite(createdAtRaw) && createdAtRaw > 0 ? createdAtRaw : now
      const updatedAt = Number.isFinite(updatedAtRaw) && updatedAtRaw > 0 ? updatedAtRaw : createdAt
      return {
        id: String(item?.id || item?.snippetId || uuidv4()),
        name,
        category: String(item?.category || item?.group || '部署').trim() || '部署',
        hostId: String(item?.hostId ?? item?.host_id ?? '').trim(),
        description: String(item?.description || item?.desc || '').trim(),
        commands,
        createdAt,
        updatedAt,
      }
    })
    .filter(Boolean)

  const deduped = new Map()
  for (const item of items) {
    const prev = deduped.get(item.id)
    if (!prev || (item.updatedAt || 0) >= (prev.updatedAt || 0)) deduped.set(item.id, item)
  }

  const meta = payload?.snippetMeta || payload?.snippet_meta || {}
  const extraCategories = parseExtraCategories(
    payload?.extraCategories ?? payload?.extra_categories ?? meta?.extra_categories ?? meta?.extraCategories ?? [],
  )

  return {
    items: [...deduped.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
    extraCategories,
  }
}

function readSnippetStateFromJsonFile(filePath) {
  const parsed = readJsonFile(filePath)
  if (!parsed) return null
  return normalizeSnippetStateForRead({
    items: parsed?.snippets,
    snippet_meta: parsed?.snippet_meta,
  })
}

function recoverSnippetsFromSiblingFilesIfNeeded() {
  const existingItems = Array.isArray(db?.data?.snippets) ? db.data.snippets : []
  if (existingItems.length > 0) return false

  const dbPath = activeDbPath || db?.filePath || resolveDbPath()
  const dir = path.dirname(dbPath)
  const currentBase = path.basename(dbPath).toLowerCase()
  let names = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    return false
  }

  let best = null
  for (const name of names) {
    const lower = String(name || '').toLowerCase()
    if (!lower || lower === currentBase) continue
    const isCandidate =
      (lower.endsWith('.json') || lower.endsWith('.db'))
      && (lower.includes('astrashell') || lower.includes('lightterm'))
    if (!isCandidate) continue
    const filePath = path.join(dir, name)
    const state = readSnippetStateFromJsonFile(filePath)
    if (!state || state.items.length === 0) continue
    if (!best || state.items.length > best.items.length) {
      best = { filePath, items: state.items, extraCategories: state.extraCategories }
    }
  }

  if (!best) return false
  db.data.snippets = best.items
  db.data.snippet_meta = {
    extra_categories: best.extraCategories,
    updated_at: Date.now(),
  }
  db.save()
  logMain(`snippets recovered from sibling file: ${best.filePath}, count=${best.items.length}`)
  return true
}

function migrateLegacyDbFileIfNeeded(targetPath) {
  if (!targetPath || fs.existsSync(targetPath)) return
  const legacyPath = path.join(path.dirname(targetPath), LEGACY_DB_FILE_NAME)
  if (!fs.existsSync(legacyPath)) return
  try {
    fs.copyFileSync(legacyPath, targetPath)
    logMain(`migrated legacy db file: ${legacyPath} -> ${targetPath}`)
  } catch (e) {
    logMain(`migrate legacy db file failed: ${e?.message || e}`)
  }
}

class JsonDB {
  constructor(filePath) {
    this.filePath = filePath
    this.lastFileSignature = ''
    this.encryptionKey = null
    this.encryptedPayload = null
    this.data = {
      storage_version: 2,
      hosts: [],
      snippets: [],
      snippet_meta: { extra_categories: [], updated_at: 0 },
      vault_meta: null,
      vault_keys: [],
      logs: [],
    }
    this.load()
  }

  setEncryptionKey(key) {
    this.encryptionKey = key || null
  }

  getFileSignature() {
    if (!fs.existsSync(this.filePath)) return ''
    try {
      const stat = fs.statSync(this.filePath)
      const size = Number(stat?.size || 0)
      const mtimeMs = Number(stat?.mtimeMs || 0)
      return `${size}:${Math.trunc(mtimeMs)}`
    } catch {
      return ''
    }
  }

  shouldEncryptOnSave() {
    return !!(this.encryptionKey && this.data?.vault_meta?.salt && this.data?.vault_meta?.verifier_hash)
  }

  applyDecryptedPayload() {
    if (!this.encryptedPayload || !this.encryptionKey) return false
    try {
      const raw = decryptText(this.encryptedPayload, this.encryptionKey)
      const parsed = JSON.parse(raw)
      this.data.hosts = Array.isArray(parsed?.hosts) ? parsed.hosts : []
      this.data.snippets = Array.isArray(parsed?.snippets) ? parsed.snippets : []
      this.data.snippet_meta = parsed?.snippet_meta && typeof parsed.snippet_meta === 'object'
        ? {
          extra_categories: Array.isArray(parsed.snippet_meta.extra_categories) ? parsed.snippet_meta.extra_categories : [],
          updated_at: Number(parsed.snippet_meta.updated_at || 0),
        }
        : { extra_categories: [], updated_at: 0 }
      this.data.vault_keys = Array.isArray(parsed?.vault_keys) ? parsed.vault_keys : []
      this.data.logs = Array.isArray(parsed?.logs) ? parsed.logs : []
      return true
    } catch {
      return false
    }
  }

  load() {
    if (!fs.existsSync(this.filePath)) {
      this.lastFileSignature = ''
      return
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8')
      const parsed = JSON.parse(raw)
      this.data = { ...this.data, ...parsed }
      if (parsed?.encrypted_payload && typeof parsed.encrypted_payload === 'object') {
        this.encryptedPayload = parsed.encrypted_payload
        this.data.hosts = []
        this.data.snippets = []
        this.data.snippet_meta = { extra_categories: [], updated_at: 0 }
        this.data.vault_keys = []
        this.data.logs = []
        this.applyDecryptedPayload()
      } else {
        this.encryptedPayload = null
      }
      this.lastFileSignature = this.getFileSignature()
    } catch {}
  }

  reloadIfChanged() {
    if (!fs.existsSync(this.filePath)) {
      if (this.lastFileSignature) {
        this.lastFileSignature = ''
        return true
      }
      return false
    }
    try {
      const nextSignature = this.getFileSignature()
      if (nextSignature && nextSignature === this.lastFileSignature) return false
      this.load()
      return true
    } catch {
      return false
    }
  }

  save() {
    const dir = path.dirname(this.filePath)
    fs.mkdirSync(dir, { recursive: true })
    const tmpPath = path.join(dir, `.${path.basename(this.filePath)}.${process.pid}.${Date.now()}.tmp`)
    const persist = { ...this.data }
    persist.storage_version = 2
    persist.updated_at = Date.now()
    if (this.shouldEncryptOnSave()) {
      const encryptedPayload = encryptText(JSON.stringify({
        hosts: Array.isArray(this.data.hosts) ? this.data.hosts : [],
        snippets: Array.isArray(this.data.snippets) ? this.data.snippets : [],
        snippet_meta: this.data.snippet_meta && typeof this.data.snippet_meta === 'object'
          ? this.data.snippet_meta
          : { extra_categories: [], updated_at: 0 },
        vault_keys: Array.isArray(this.data.vault_keys) ? this.data.vault_keys : [],
        logs: Array.isArray(this.data.logs) ? this.data.logs : [],
      }), this.encryptionKey)
      this.encryptedPayload = encryptedPayload
      persist.hosts = []
      persist.snippets = []
      persist.snippet_meta = { extra_categories: [], updated_at: 0 }
      persist.vault_keys = []
      persist.logs = []
      persist.encrypted_payload = encryptedPayload
    } else {
      this.encryptedPayload = null
      delete persist.encrypted_payload
    }
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(persist, null, 2), 'utf8')
      fs.renameSync(tmpPath, this.filePath)
      this.lastFileSignature = this.getFileSignature()
    } finally {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
      } catch {}
    }
  }

  exec() {}

  prepare(sql) {
    const s = sql.trim().replace(/\s+/g, ' ').toUpperCase()
    const self = this
    return {
      all(...args) {
        if (s.startsWith('SELECT * FROM HOSTS')) return [...self.data.hosts].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
        if (s.startsWith('SELECT ID, NAME, TYPE, FINGERPRINT, CREATED_AT, UPDATED_AT FROM VAULT_KEYS')) {
          return [...self.data.vault_keys]
            .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
            .map(({ id, name, type, fingerprint, created_at, updated_at }) => ({ id, name, type, fingerprint, created_at, updated_at }))
        }
        return []
      },
      get(...args) {
        if (s.startsWith('SELECT ID FROM VAULT_META')) return self.data.vault_meta ? { id: 1 } : undefined
        if (s.startsWith('SELECT * FROM VAULT_META')) return self.data.vault_meta || undefined
        if (s.startsWith('SELECT * FROM VAULT_KEYS WHERE ID = ?')) {
          const id = args[0]
          return self.data.vault_keys.find((k) => k.id === id)
        }
        return undefined
      },
      run(...args) {
        if (s.startsWith('INSERT INTO HOSTS')) {
          const row = args[0]
          const idx = self.data.hosts.findIndex((h) => h.id === row.id)
          if (idx >= 0) self.data.hosts[idx] = { ...self.data.hosts[idx], ...row }
          else self.data.hosts.push(row)
          self.save()
          return
        }
        if (s.startsWith('DELETE FROM HOSTS WHERE ID = ?')) {
          const id = args[0]
          self.data.hosts = self.data.hosts.filter((h) => h.id !== id)
          self.save()
          return
        }
        if (s.startsWith('INSERT OR REPLACE INTO VAULT_META')) {
          const [salt, verifier_hash, updated_at] = args
          self.data.vault_meta = { id: 1, salt, verifier_hash, updated_at }
          self.save()
          return
        }
        if (s.startsWith('INSERT INTO VAULT_KEYS')) {
          const row = args[0]
          const idx = self.data.vault_keys.findIndex((k) => k.id === row.id)
          if (idx >= 0) self.data.vault_keys[idx] = { ...self.data.vault_keys[idx], ...row }
          else self.data.vault_keys.push(row)
          self.save()
          return
        }
      },
    }
  }
}

function getHostUpdatedAt(row) {
  return Number(row?.updated_at || row?.updatedAt || 0)
}

function getVaultKeyUpdatedAt(row) {
  return Number(row?.updated_at || row?.updatedAt || 0)
}

function getSnippetUpdatedAt(row) {
  return Number(row?.updatedAt || row?.updated_at || 0)
}

function getAuditUpdatedAt(row) {
  return Number(row?.ts || row?.updatedAt || row?.updated_at || 0)
}

function mergeAuditLogs(baseRows, incomingRows) {
  const merged = mergeRowsById(baseRows, incomingRows, getAuditUpdatedAt)
  return merged.sort((a, b) => getAuditUpdatedAt(b) - getAuditUpdatedAt(a)).slice(0, MAX_AUDIT_LOGS)
}

function mergeRowsById(baseRows, incomingRows, getUpdatedAt) {
  const merged = new Map()
  for (const row of Array.isArray(baseRows) ? baseRows : []) {
    if (!row?.id) continue
    merged.set(String(row.id), row)
  }
  for (const row of Array.isArray(incomingRows) ? incomingRows : []) {
    if (!row?.id) continue
    const key = String(row.id)
    const prev = merged.get(key)
    if (!prev || getUpdatedAt(row) >= getUpdatedAt(prev)) merged.set(key, row)
  }
  return [...merged.values()]
}

function mergeSnippetMeta(baseMeta, incomingMeta) {
  const baseUpdated = Number(baseMeta?.updated_at || 0)
  const incomingUpdated = Number(incomingMeta?.updated_at || 0)
  const mergedCategories = [...new Set([
    ...(Array.isArray(baseMeta?.extra_categories) ? baseMeta.extra_categories : []),
    ...(Array.isArray(incomingMeta?.extra_categories) ? incomingMeta.extra_categories : []),
  ].map((v) => String(v || '').trim()).filter(Boolean))]
  return {
    extra_categories: mergedCategories,
    updated_at: Math.max(baseUpdated, incomingUpdated),
  }
}

function mergeVaultMeta(baseMeta, incomingMeta) {
  if (!baseMeta) return incomingMeta || null
  if (!incomingMeta) return baseMeta || null
  const baseUpdated = Number(baseMeta.updated_at || 0)
  const incomingUpdated = Number(incomingMeta.updated_at || 0)
  return incomingUpdated >= baseUpdated ? incomingMeta : baseMeta
}

function mergeDbData(baseData, incomingData) {
  return {
    storage_version: Math.max(Number(baseData?.storage_version || 1), Number(incomingData?.storage_version || 1), 2),
    hosts: mergeRowsById(baseData?.hosts, incomingData?.hosts, getHostUpdatedAt),
    snippets: mergeRowsById(baseData?.snippets, incomingData?.snippets, getSnippetUpdatedAt),
    snippet_meta: mergeSnippetMeta(baseData?.snippet_meta, incomingData?.snippet_meta),
    vault_meta: mergeVaultMeta(baseData?.vault_meta, incomingData?.vault_meta),
    vault_keys: mergeRowsById(baseData?.vault_keys, incomingData?.vault_keys, getVaultKeyUpdatedAt),
    logs: mergeAuditLogs(baseData?.logs, incomingData?.logs),
  }
}

function broadcast(channel, payload) {
  BrowserWindow.getAllWindows().forEach((win) => win.webContents.send(channel, payload))
}

function deriveKey(masterPassword, salt) {
  return crypto.pbkdf2Sync(masterPassword, salt, 120000, 32, 'sha256')
}

function encryptText(plain, key) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return { iv: iv.toString('base64'), tag: tag.toString('base64'), data: encrypted.toString('base64') }
}

function decryptText(payload, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'))
  const decrypted = Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()])
  return decrypted.toString('utf8')
}

function connectConfigFromPayload(payload) {
  return {
    host: payload.host,
    port: Number(payload.port || 22),
    username: payload.username,
    password: payload.password || undefined,
    privateKey: payload.privateKey || undefined,
    passphrase: payload.passphrase || undefined,
    readyTimeout: 12000,
    tryKeyboard: true,
  }
}

function normalizeSnippetState(payload) {
  const now = Date.now()
  const normalizedRead = normalizeSnippetStateForRead(payload)
  const dedupedItems = normalizedRead.items
  const extraCategories = normalizedRead.extraCategories

  return {
    items: dedupedItems.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
    extraCategories,
    updatedAt: now,
  }
}

async function getSerialPortCtor() {
  if (SerialPortCtor) return SerialPortCtor
  try {
    const mod = await import('serialport')
    SerialPortCtor = mod.SerialPort
    return SerialPortCtor
  } catch (e) {
    serialModuleLoadError = e?.message || String(e)
    throw new Error(`串口模块加载失败：${serialModuleLoadError}`)
  }
}

function attachKeyboardHandler(conn, password) {
  conn.on('keyboard-interactive', (_name, _instructions, _instructionsLang, prompts, finish) => {
    if (!password) {
      finish([])
      return
    }
    const responses = (prompts || []).map(() => password)
    finish(responses)
  })
}

async function withSftp(payload, handler) {
  return await new Promise((resolve) => {
    createSSHClient().then((conn) => {
      attachKeyboardHandler(conn, payload.password)
      conn
        .on('ready', () => {
          conn.sftp(async (err, sftp) => {
            if (err) {
              conn.end()
              return resolve({ ok: false, error: err.message })
            }
            try {
              const result = await handler(sftp)
              conn.end()
              resolve(result)
            } catch (e) {
              conn.end()
              resolve({ ok: false, error: e?.message || 'SFTP 操作失败' })
            }
          })
        })
        .on('error', (err) => resolve({ ok: false, error: err.message }))
        .connect(connectConfigFromPayload(payload))
    }).catch((e) => resolve({ ok: false, error: e?.message || 'SSH 模块加载失败' }))
  })
}

function openDbAtPath(filePath, { migrateLegacy = false } = {}) {
  if (migrateLegacy) migrateLegacyDbFileIfNeeded(filePath)
  const nextDb = new JsonDB(filePath)
  nextDb.setEncryptionKey(vaultKey)
  return nextDb
}

function requireDbReady({ allowCreate = false } = {}) {
  const dbPath = resolveDbPath()
  if (!dbPath) throw new Error('请先选择数据文件')
  if (!allowCreate && !storageFileExists(dbPath)) {
    throw new Error('数据文件不存在，请重新选择或先初始化')
  }
  activeDbPath = dbPath
  if (!db || db.filePath !== dbPath) db = openDbAtPath(dbPath, { migrateLegacy: true })
  db.setEncryptionKey(vaultKey)
  return db
}

function initDb() {
  const dbPath = resolveDbPath()
  activeDbPath = dbPath || ''
  const settings = readSettings()
  if (!settings.dataPath && settings.dbPath && /[\\/]lightterm\.db$/i.test(String(settings.dbPath))) {
    settings.dataPath = dbPath
    delete settings.dbPath
    writeSettings(settings)
  }
  if (!dbPath) {
    db = null
    vaultKey = null
    return
  }
  try {
    db = openDbAtPath(dbPath, { migrateLegacy: true })
  } catch (e) {
    db = null
    logMain(`initDb failed path=${dbPath} error=${e?.message || e}`)
  }

  if (!db) return

  db.exec(`
    CREATE TABLE IF NOT EXISTS hosts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER DEFAULT 22,
      username TEXT NOT NULL,
      auth_type TEXT DEFAULT 'password',
      password TEXT,
      private_key_ref TEXT,
      tags TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS vault_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      salt TEXT NOT NULL,
      verifier_hash TEXT NOT NULL,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS vault_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'openssh',
      fingerprint TEXT,
      encrypted_blob TEXT NOT NULL,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS snippets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      host_id TEXT,
      description TEXT,
      commands TEXT NOT NULL,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS snippet_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      extra_categories TEXT,
      updated_at INTEGER
    );
  `)
}

function refreshDbFromDisk(reason = 'manual', force = false) {
  const dbPath = resolveDbPath()
  if (!dbPath) return false
  try {
    const currentDb = requireDbReady()
    let changed = false
    if (force) {
      const prevSignature = currentDb.lastFileSignature
      const nextSignature = currentDb.getFileSignature()
      if (nextSignature && nextSignature === prevSignature) return false
      currentDb.load()
      changed = prevSignature !== currentDb.lastFileSignature
    } else {
      changed = currentDb.reloadIfChanged()
    }
    if (changed) logMain(`db refreshed from disk reason=${reason}`)
    return changed
  } catch (e) {
    logMain(`db refresh failed reason=${reason} error=${e?.message || e}`)
    return false
  }
}

function startDbWatchTimer() {
  if (dbWatchTimer) clearInterval(dbWatchTimer)
  dbWatchTimer = setInterval(() => {
    const changed = refreshDbFromDisk('poll', false)
    if (changed) {
      broadcast('storage:data-changed', { changedAt: Date.now() })
    }
  }, 3200)
  dbWatchTimer.unref?.()
}

function getStorageMeta() {
  const dbPath = resolveDbPath() || activeDbPath || ''
  const currentDb = db?.filePath === dbPath ? db : null
  let exists = false
  let size = 0
  let mtimeMs = 0
  try {
    if (fs.existsSync(dbPath)) {
      exists = true
      const stat = fs.statSync(dbPath)
      size = Number(stat?.size || 0)
      mtimeMs = Number(stat?.mtimeMs || 0)
    }
  } catch {}
  return {
    configured: !!dbPath,
    dbPath,
    exists,
    size,
    mtimeMs,
    encrypted: !!currentDb?.encryptedPayload,
    storageVersion: Number(currentDb?.data?.storage_version || 1),
    hosts: Array.isArray(currentDb?.data?.hosts) ? currentDb.data.hosts.length : 0,
    snippets: Array.isArray(currentDb?.data?.snippets) ? currentDb.data.snippets.length : 0,
    vaultKeys: Array.isArray(currentDb?.data?.vault_keys) ? currentDb.data.vault_keys.length : 0,
    logs: Array.isArray(currentDb?.data?.logs) ? currentDb.data.logs.length : 0,
  }
}

function logMain(message) {
  try {
    const logPath = path.join(app.getPath('userData'), 'main.log')
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`, 'utf8')
  } catch {}
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildShellSpawnOptions(cwd) {
  const nextCwd = cwd && fs.existsSync(cwd) ? cwd : os.homedir()
  const env = {
    ...process.env,
    LANG: process.env.LANG || 'zh_CN.UTF-8',
    LC_ALL: process.env.LC_ALL || 'zh_CN.UTF-8',
    TERM: process.env.TERM || 'xterm-256color',
  }
  return { cwd: nextCwd, env }
}

function getLocalShellCommand() {
  if (process.platform === 'win32') return process.env.COMSPEC || 'cmd.exe'
  return process.env.SHELL || '/bin/zsh'
}

let zshDotDirCache = ''
function ensureAstraZshDotDir() {
  if (zshDotDirCache && fs.existsSync(zshDotDirCache)) return zshDotDirCache
  const dir = path.join(app.getPath('userData'), 'runtime', 'zsh-dotdir')
  fs.mkdirSync(dir, { recursive: true })
  const completionFile = path.join(dir, '.astrashell-completion.zsh')
  const completionUserFile = path.join(dir, '.astrashell-completion.user.zsh')
  fs.writeFileSync(completionFile, [
    'typeset -ga _astrashell_npm_primary',
    '_astrashell_npm_primary=(',
    '  run dev start build test lint preview',
    '  install i ci add remove rm uninstall update outdated',
    '  list ls exec create init doctor cache explain config pkg',
    '  publish version audit fund login logout whoami',
    ')',
    'typeset -ga _astrashell_npm_run',
    '_astrashell_npm_run=(dev build start test lint preview dist)',
    '',
    '_astrashell_npm_complete() {',
    '  local -a primary runWords',
    '  primary=(${_astrashell_npm_primary})',
    '  runWords=(${_astrashell_npm_run})',
    '  if (( CURRENT == 2 )); then',
    "    _describe 'npm command' primary",
    '    return',
    '  fi',
    "  if [[ \"${words[2]}\" == \"run\" && CURRENT == 3 ]]; then",
    "    _describe 'npm script' runWords",
    '    return',
    '  fi',
    "  if [[ \"${words[2]}\" == \"create\" && CURRENT == 3 ]]; then",
    "    _values 'initializer' 'vite@latest' 'next-app@latest' 'react-app@latest'",
    '    return',
    '  fi',
    '}',
    'compdef _astrashell_npm_complete npm',
    '',
  ].join('\n'), 'utf8')
  if (!fs.existsSync(completionUserFile)) {
    fs.writeFileSync(completionUserFile, [
      '# AstraShell custom completion library',
      '# Example:',
      '# _astrashell_npm_run+=(deploy release staging)',
      '',
    ].join('\n'), 'utf8')
  }
  fs.writeFileSync(path.join(dir, '.zshenv'), [
    'if [[ -f "$HOME/.zshenv" ]]; then',
    '  source "$HOME/.zshenv"',
    'fi',
    '',
  ].join('\n'), 'utf8')
  fs.writeFileSync(path.join(dir, '.zprofile'), [
    'if [[ -f "$HOME/.zprofile" ]]; then',
    '  source "$HOME/.zprofile"',
    'fi',
    '',
  ].join('\n'), 'utf8')
  fs.writeFileSync(path.join(dir, '.zshrc'), [
    'if [[ -f "$HOME/.zshrc" ]]; then',
    '  source "$HOME/.zshrc"',
    'fi',
    'autoload -Uz compinit 2>/dev/null',
    'if [[ -z "${_ASTRA_COMPINIT_DONE:-}" ]]; then',
    '  compinit -i 2>/dev/null',
    '  _ASTRA_COMPINIT_DONE=1',
    'fi',
    'if [[ -f "$ZDOTDIR/.astrashell-completion.zsh" ]]; then',
    '  source "$ZDOTDIR/.astrashell-completion.zsh"',
    'fi',
    'if [[ -f "$ZDOTDIR/.astrashell-completion.user.zsh" ]]; then',
    '  source "$ZDOTDIR/.astrashell-completion.user.zsh"',
    'fi',
    'unsetopt PROMPT_SP 2>/dev/null',
    "PROMPT_EOL_MARK=''",
    "PROMPT='%n@%m %1~ > '",
    "RPROMPT=''",
    '',
  ].join('\n'), 'utf8')
  fs.writeFileSync(path.join(dir, '.zlogin'), [
    'if [[ -f "$HOME/.zlogin" ]]; then',
    '  source "$HOME/.zlogin"',
    'fi',
    '',
  ].join('\n'), 'utf8')
  zshDotDirCache = dir
  return dir
}

function applyLocalShellRuntimeEnv(shellCmd, env) {
  if (process.platform === 'win32') return env
  const shellName = path.basename(String(shellCmd || '')).toLowerCase()
  if (shellName.includes('zsh')) {
    try {
      env.ZDOTDIR = ensureAstraZshDotDir()
    } catch {}
  } else if (shellName.includes('bash')) {
    env.PS1 = '\\u@\\h \\W > '
  }
  return env
}

function buildShellColorInitScript(shellCmd) {
  if (process.platform === 'win32') return ''
  const shellName = path.basename(String(shellCmd || '')).toLowerCase()
  if (!shellName.includes('zsh') && !shellName.includes('bash') && !shellName.endsWith('sh')) return ''

  const base = [
    'export TERM="${TERM:-xterm-256color}"',
    'export CLICOLOR=1',
    'export CLICOLOR_FORCE=1',
  ]

  if (shellName.includes('zsh')) {
    return [...base, "alias ll='ls -alF'"].join('; ')
  }

  return [...base, "alias ll='ls -alF'"] .join('; ')
}

function closeLocalShellSession(sessionId, reason = 'manual') {
  const session = localShellSessions.get(sessionId)
  if (!session) return false
  if (reason === 'reconnect' || reason === 'app-exit') session.silentClose = true
  try {
    session.proc?.write?.('exit\r')
  } catch {}
  try {
    session.proc?.kill?.()
  } catch {}
  localShellSessions.delete(sessionId)
  localInputBuffers.delete(sessionId)
  localOutputBuffers.delete(sessionId)
  flushResponseLogsForSession('local', sessionId)
  if (reason !== 'reconnect' && reason !== 'app-exit') {
    appendAuditLog({
      source: 'local',
      action: 'disconnect',
      target: session.target || sessionId,
      content: '用户手动断开',
    })
  }
  return true
}

async function closeAllLocalShellSessions(reason = 'app-exit') {
  const entries = [...localShellSessions.entries()]
  if (!entries.length) return
  logMain(`local cleanup start reason=${reason} count=${entries.length}`)
  localShellSessions.clear()
  localInputBuffers.clear()
  localOutputBuffers.clear()
  flushAllResponseLogs()
  await Promise.allSettled(entries.map(async ([sessionId, session]) => {
    session.silentClose = true
    try {
      session?.proc?.write?.('exit\r')
    } catch {}
    await wait(50)
    try {
      session?.proc?.kill?.()
    } catch {}
    appendAuditLog({
      source: 'local',
      action: 'disconnect',
      target: session?.target || sessionId,
      content: reason === 'app-exit' ? '应用退出，自动断开' : '会话关闭',
    })
  }))
  logMain(`local cleanup end reason=${reason}`)
}

async function closeAllSshSessions(reason = 'app-exit') {
  const entries = [...sshSessions.entries()]
  if (!entries.length) return
  logMain(`ssh cleanup start reason=${reason} count=${entries.length}`)
  sshSessions.clear()
  sshInputBuffers.clear()
  sshOutputBuffers.clear()
  flushAllResponseLogs()
  await Promise.allSettled(entries.map(async ([sessionId, session]) => {
    try {
      session?.stream?.end?.('exit\n')
    } catch (e) {
      logMain(`ssh cleanup stream end failed reason=${reason} session=${sessionId} error=${e?.message || e}`)
    }
    await wait(80)
    try {
      session?.conn?.end?.()
    } catch (e) {
      logMain(`ssh cleanup conn end failed reason=${reason} session=${sessionId} error=${e?.message || e}`)
    }
    appendAuditLog({
      source: 'ssh',
      action: 'disconnect',
      target: String(session?.target || `${session?.conn?.config?.username || 'user'}@${session?.conn?.config?.host || 'host'}:${Number(session?.conn?.config?.port || 22)}`),
      content: reason === 'app-exit' ? '应用退出，自动断开' : '会话关闭',
    })
  }))
  logMain(`ssh cleanup end reason=${reason}`)
}

async function closeAllSerialPorts(reason = 'app-exit') {
  const entries = [...serialPorts.entries()]
  if (!entries.length) return
  logMain(`serial cleanup start reason=${reason} count=${entries.length}`)
  await Promise.allSettled(entries.map(([key, port]) => new Promise((resolve) => {
    const finish = () => {
      serialPorts.delete(key)
      serialInputBuffers.delete(key)
      serialOutputBuffers.delete(key)
      flushResponseLogsForSession('serial', key)
      appendAuditLog({ source: 'serial', action: 'disconnect', target: String(key || ''), content: reason === 'app-exit' ? '应用退出，自动断开' : '串口已断开' })
      resolve(true)
    }
    try {
      if (!port) return finish()
      if (port.isOpen === false || typeof port.close !== 'function') {
        try {
          port.destroy?.()
        } catch {}
        return finish()
      }
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        finish()
      }
      const timer = setTimeout(() => {
        try {
          port.destroy?.()
        } catch {}
        done()
      }, 800)
      port.close(() => {
        clearTimeout(timer)
        done()
      })
    } catch (e) {
      logMain(`serial cleanup failed reason=${reason} path=${key} error=${e?.message || e}`)
      try {
        port?.destroy?.()
      } catch {}
      finish()
    }
  })))
  logMain(`serial cleanup end reason=${reason}`)
}

async function closeAllWindowsForInstall(reason = 'update-install') {
  const windows = BrowserWindow.getAllWindows()
  if (!windows.length) return
  logMain(`window cleanup start reason=${reason} count=${windows.length}`)
  windows.forEach((win) => {
    try {
      if (win.isDestroyed()) return
      win.hide()
      win.close()
    } catch (e) {
      logMain(`window close failed reason=${reason} error=${e?.message || e}`)
    }
  })
  await wait(150)
  BrowserWindow.getAllWindows().forEach((win) => {
    try {
      if (!win.isDestroyed()) win.destroy()
    } catch (e) {
      logMain(`window destroy failed reason=${reason} error=${e?.message || e}`)
    }
  })
  logMain(`window cleanup end reason=${reason}`)
}

function scheduleWindowsSelfKill(reason = 'update-install') {
  if (process.platform !== 'win32' || isDev) return
  const cmd = `ping -n 3 127.0.0.1 >nul && taskkill /F /T /PID ${process.pid} >nul 2>&1`
  try {
    const child = spawn(process.env.comspec || 'cmd.exe', ['/d', '/s', '/c', cmd], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref()
    logMain(`windows self kill scheduled reason=${reason} pid=${process.pid}`)
  } catch (e) {
    logMain(`windows self kill schedule failed reason=${reason} error=${e?.message || e}`)
  }
}

async function cleanupAppRuntimeForInstall(reason = 'update-install') {
  if (runtimeCleanupPromise) {
    logMain(`runtime cleanup reuse reason=${reason} activeReason=${runtimeCleanupReason}`)
    return runtimeCleanupPromise
  }
  runtimeCleanupReason = reason
  suppressWindowAllClosedQuit = true
  runtimeCleanupPromise = (async () => {
    logMain(`runtime cleanup start reason=${reason}`)
    await Promise.allSettled([
      closeAllSshSessions(reason),
      closeAllSerialPorts(reason),
      closeAllLocalShellSessions(reason),
    ])
    await closeAllWindowsForInstall(reason)
    logMain(`runtime cleanup end reason=${reason}`)
  })().finally(() => {
    runtimeCleanupPromise = null
    runtimeCleanupReason = ''
  })
  return runtimeCleanupPromise
}

function broadcastUpdateState() {
  broadcast('update:status', { ...updateState })
}

function normalizeUpdateError(err) {
  const message = String(err?.message || err || '未知错误')
  if (/code signature|did not pass validation|shipit/i.test(message)) {
    return `更新包签名校验失败：${macManualInstallTip}`
  }
  if (/status code 401|status code 403|unauthorized/i.test(message)) {
    return '更新源鉴权失败：请确认 GitHub release 可访问，或配置 GH_TOKEN。'
  }
  if (/status code 404|cannot find latest|not found/i.test(message)) {
    return '未找到可用更新元数据：请确认发布了带 latest*.yml 的新版本。'
  }
  return message
}

async function applyAutoUpdaterFeed() {
  const updater = await getAutoUpdater()
  activeUpdateProvider = 'github'
  updater.setFeedURL(githubReleaseProvider)
}

function setUpdateState(patch) {
  Object.assign(updateState, patch)
  broadcastUpdateState()
}

function normalizeVersion(versionLike) {
  return String(versionLike || '').trim().replace(/^v/i, '').split('-')[0]
}

function getPlatformAssetFileName(version) {
  const normalized = normalizeVersion(version)
  if (!normalized) return ''
  if (process.platform === 'win32') return `AstraShell-Setup-${normalized}.exe`
  if (process.platform === 'darwin') return `AstraShell-${normalized}-arm64.dmg`
  return `AstraShell-${normalized}-arm64.AppImage`
}

function getGitHubReleaseUrl(version) {
  const normalized = normalizeVersion(version)
  return normalized ? `https://github.com/getiid/AstraShell/releases/tag/v${normalized}` : ''
}

function getGitHubAssetUrl(version) {
  const normalized = normalizeVersion(version)
  const fileName = getPlatformAssetFileName(normalized)
  return normalized && fileName
    ? `https://github.com/getiid/AstraShell/releases/download/v${normalized}/${fileName}`
    : ''
}

async function checkForUpdatesNow() {
  if (isDev) return { ok: false, error: '开发模式不支持自动更新检查' }
  await initAutoUpdater()
  const updater = await getAutoUpdater()
  try {
    await applyAutoUpdaterFeed()
    await updater.checkForUpdates()
    return { ok: true }
  } catch (e) {
    const message = normalizeUpdateError(e)
    logMain(`update check github error: ${message}`)
    setUpdateState({
      status: 'error',
      message: `检查更新失败：${message}`,
      checking: false,
      source: 'github',
    })
    return { ok: false, error: message }
  }
}

async function initAutoUpdater() {
  if (updaterInitialized || isDev) return
  const updater = await getAutoUpdater()
  updaterInitialized = true
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  await applyAutoUpdaterFeed()

  updater.on('checking-for-update', () => {
    const source = activeUpdateProvider
    setUpdateState({
      status: 'checking',
      message: `正在检查更新（${getUpdateSourceLabel(source)}）...`,
      checking: true,
      downloading: false,
      progress: 0,
      source,
      downloadUrl: '',
      releaseUrl: '',
    })
  })

  updater.on('update-available', (info) => {
    const source = activeUpdateProvider
    const latestVersion = info?.version || ''
    const installHint = process.platform === 'darwin' && !getMacAutoInstallSupport().supported
      ? '，当前构建仅支持手动安装（请下载 DMG）'
      : ''
    const downloadUrl = getGitHubAssetUrl(latestVersion)
    const releaseUrl = getGitHubReleaseUrl(latestVersion)
    setUpdateState({
      status: 'available',
      message: `发现新版本：${latestVersion || '未知版本'}（${getUpdateSourceLabel(source)}）${installHint}`,
      latestVersion,
      hasUpdate: true,
      downloaded: false,
      checking: false,
      downloading: false,
      progress: 0,
      source,
      downloadUrl,
      releaseUrl,
    })
  })

  updater.on('update-not-available', () => {
    const source = activeUpdateProvider
    setUpdateState({
      status: 'idle',
      message: `当前已是最新版本（${app.getVersion()}，${getUpdateSourceLabel(source)}）`,
      latestVersion: app.getVersion(),
      hasUpdate: false,
      downloaded: false,
      checking: false,
      downloading: false,
      progress: 0,
      source,
      downloadUrl: '',
      releaseUrl: '',
    })
  })

  updater.on('download-progress', (progress) => {
    const source = activeUpdateProvider
    setUpdateState({
      status: 'downloading',
      message: `更新下载中（${getUpdateSourceLabel(source)}）：${Math.round(progress?.percent || 0)}%`,
      downloading: true,
      progress: Number(progress?.percent || 0),
      source,
    })
  })

  updater.on('update-downloaded', (info) => {
    const source = activeUpdateProvider
    setUpdateState({
      status: 'downloaded',
      message: `更新已下载完成：${info?.version || ''}（${getUpdateSourceLabel(source)}），可一键重启安装`,
      latestVersion: info?.version || updateState.latestVersion,
      hasUpdate: true,
      downloaded: true,
      checking: false,
      downloading: false,
      progress: 100,
      source,
    })
  })

  updater.on('error', (e) => {
    const message = normalizeUpdateError(e)
    const source = activeUpdateProvider
    setUpdateState({
      status: 'error',
      message: `更新异常（${getUpdateSourceLabel(source)}）：${message}`,
      checking: false,
      downloading: false,
      source,
    })
    logMain(`autoUpdater error [${source}]: ${message}`)
  })
}

function buildAppMenu() {
  const template = [
    {
      label: 'AstraShell',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: '文件',
      submenu: [
        { role: 'newWindow', label: '新窗口' },
        { role: 'close', label: '关闭窗口' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '会话',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1080,
    minHeight: 680,
    title: 'AstraShell',
    titleBarStyle: 'default',
    movable: true,
    backgroundColor: '#f3f4f6',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.once('ready-to-show', () => {
    logMain('window ready-to-show')
    win.show()
    win.focus()
  })

  win.webContents.on('did-fail-load', (_event, code, desc, url) => {
    logMain(`did-fail-load code=${code} desc=${desc} url=${url}`)
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    logMain(`render-process-gone reason=${details.reason} exitCode=${details.exitCode}`)
  })

  if (isDev) {
    win.loadURL('http://localhost:5173').catch((e) => logMain(`loadURL error: ${e.message}`))
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html')
    logMain(`loadFile ${indexPath}`)
    win.loadFile(indexPath).catch((e) => logMain(`loadFile error: ${e.message}`))
  }
}

app.whenReady().then(() => {
  try {
    buildAppMenu()
    initDb()
    logMain('initDb ok')
    startDbWatchTimer()
    broadcastUpdateState()
    createWindow()
    logMain('createWindow called')
    if (!isDev) {
      setTimeout(() => {
        checkForUpdatesNow().catch((e) => logMain(`auto check failed: ${e?.message || e}`))
      }, 4000)
    }
  } catch (e) {
    try {
      const p = path.join(app.getPath('userData'), 'fatal.log')
      fs.appendFileSync(p, `[${new Date().toISOString()}] ${e?.stack || e?.message || e}\n`, 'utf8')
    } catch {}
    dialog.showErrorBox('AstraShell 启动失败', String(e?.message || e))
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (suppressWindowAllClosedQuit) {
    logMain('window-all-closed suppressed during update install flow')
    return
  }
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (dbWatchTimer) {
    clearInterval(dbWatchTimer)
    dbWatchTimer = null
  }
  void closeAllSshSessions('before-quit')
  void closeAllSerialPorts('before-quit')
  void closeAllLocalShellSessions('before-quit')
})

ipcMain.handle('app:get-storage', async () => {
  const dbPath = resolveDbPath() || activeDbPath || ''
  return { ok: true, configured: !!dbPath, dbPath }
})

ipcMain.handle('app:get-storage-meta', async () => {
  refreshDbFromDisk('app:get-storage-meta', false)
  return { ok: true, ...getStorageMeta() }
})

ipcMain.handle('app:pick-storage-folder', async () => {
  const win = BrowserWindow.getFocusedWindow()
  const picked = await dialog.showOpenDialog(win, {
    title: '选择数据目录（用于自动拼接 astrashell.data.json）',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (picked.canceled || !picked.filePaths?.[0]) return { ok: false, error: '已取消' }
  return { ok: true, folder: picked.filePaths[0] }
})

ipcMain.handle('app:pick-storage-file', async () => {
  const win = BrowserWindow.getFocusedWindow()
  const currentPath = activeDbPath || resolveDbPath() || getStorageSuggestionPath()
  const defaultDir = getStorageDirFromPath(currentPath) || app.getPath('documents')
  const picked = await dialog.showOpenDialog(win, {
    title: '选择已有共享数据文件',
    defaultPath: defaultDir,
    properties: ['openFile'],
    filters: [{ name: 'AstraShell Data', extensions: ['json', 'db'] }],
  })
  if (picked.canceled || !picked.filePaths?.[0]) return { ok: false, error: '已取消' }
  return { ok: true, filePath: picked.filePaths[0] }
})

ipcMain.handle('app:pick-storage-save-file', async () => {
  const win = BrowserWindow.getFocusedWindow()
  const currentPath = activeDbPath || resolveDbPath() || getStorageSuggestionPath()
  const defaultPath = isStorageFilePath(currentPath)
    ? currentPath
    : path.join(getStorageDirFromPath(currentPath), DATA_FILE_NAME)
  const picked = await dialog.showSaveDialog(win, {
    title: '新建共享数据文件',
    defaultPath,
    filters: [{ name: 'AstraShell Data', extensions: ['json', 'db'] }],
  })
  if (picked.canceled || !picked.filePath) return { ok: false, error: '已取消' }
  return { ok: true, filePath: picked.filePath }
})

ipcMain.handle('app:set-storage-folder', async (_event, payload) => {
  const parsed = safeParse(setStorageFolderSchema, payload)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const nextDbPath = normalizeStoragePath(parsed.data.folder)
  if (!nextDbPath) return { ok: false, error: '路径无效' }
  const settings = readSettings()
  settings.dataPath = nextDbPath
  delete settings.dbPath
  writeSettings(settings)
  activeDbPath = nextDbPath
  db = null
  vaultKey = null
  return { ok: true, dbPath: nextDbPath, restartRequired: true }
})

ipcMain.handle('app:restart', async () => {
  setImmediate(() => {
    app.relaunch()
    app.exit(0)
  })
  return { ok: true }
})

ipcMain.handle('app:open-external', async (_event, payload) => {
  const url = String(payload?.url || '').trim()
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: '无效链接' }
  try {
    await shell.openExternal(url)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || '打开链接失败' }
  }
})

ipcMain.handle('clipboard:read', async () => {
  try {
    return { ok: true, text: clipboard.readText() }
  } catch (e) {
    return { ok: false, error: e?.message || '读取剪贴板失败' }
  }
})

ipcMain.handle('clipboard:write', async (_event, payload) => {
  try {
    clipboard.writeText(String(payload?.text || ''))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || '写入剪贴板失败' }
  }
})

ipcMain.handle('audit:list', async (_event, payload) => {
  try {
    refreshDbFromDisk('audit:list')
    const currentDb = requireDbReady()
    return { ok: true, items: listAuditLogsFromDb(currentDb, payload) }
  } catch (e) {
    return { ok: false, error: e?.message || '读取日志失败', items: [] }
  }
})

ipcMain.handle('audit:append', async (_event, payload) => {
  try {
    const row = appendAuditLog(payload)
    if (!row) return { ok: false, error: '写入日志失败' }
    return { ok: true, item: row }
  } catch (e) {
    return { ok: false, error: e?.message || '写入日志失败' }
  }
})

ipcMain.handle('audit:clear', async () => {
  try {
    refreshDbFromDisk('audit:clear', true)
    const currentDb = requireDbReady()
    currentDb.data.logs = []
    currentDb.save()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || '清空日志失败' }
  }
})

ipcMain.handle('update:get-state', async () => ({ ok: true, ...updateState }))

ipcMain.handle('update:check', async () => {
  return await checkForUpdatesNow()
})

ipcMain.handle('update:download', async () => {
  if (isDev) return { ok: false, error: '开发模式不支持下载更新' }
  if (process.platform === 'darwin' && !getMacAutoInstallSupport().supported) {
    return { ok: false, error: macManualInstallTip }
  }
  await initAutoUpdater()
  try {
    const updater = await getAutoUpdater()
    await updater.downloadUpdate()
    return { ok: true }
  } catch (e) {
    const message = normalizeUpdateError(e)
    setUpdateState({ status: 'error', message: `下载更新失败：${message}`, downloading: false })
    return { ok: false, error: message }
  }
})

ipcMain.handle('update:install', async () => {
  if (isDev) return { ok: false, error: '开发模式不支持安装更新' }
  if (process.platform === 'darwin' && !getMacAutoInstallSupport().supported) {
    return { ok: false, error: macManualInstallTip }
  }
  if (!updateState.downloaded) return { ok: false, error: '更新包未下载完成' }
  setUpdateState({
    status: 'installing',
    message: '正在关闭应用并安装更新...',
  })
  await cleanupAppRuntimeForInstall('auto-update-install')
  scheduleWindowsSelfKill('auto-update-install')
  const updater = await getAutoUpdater()
  setTimeout(() => updater.quitAndInstall(false, true), 500)
  return { ok: true }
})

ipcMain.handle('hosts:list', async () => {
  try {
    refreshDbFromDisk('hosts:list')
    const currentDb = requireDbReady()
    return { ok: true, items: currentDb.prepare('SELECT * FROM hosts ORDER BY updated_at DESC').all() }
  } catch (e) {
    return { ok: false, error: e?.message || '数据文件不可用', items: [] }
  }
})

ipcMain.handle('hosts:save', async (_event, payload) => {
  try {
    refreshDbFromDisk('hosts:save', true)
    const currentDb = requireDbReady()
    const now = Date.now()
    const id = payload.id || uuidv4()
    currentDb.prepare(`
    INSERT INTO hosts (id, name, host, port, username, auth_type, password, private_key_ref, tags, created_at, updated_at)
    VALUES (@id, @name, @host, @port, @username, @auth_type, @password, @private_key_ref, @tags, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,host=excluded.host,port=excluded.port,username=excluded.username,
      auth_type=excluded.auth_type,password=excluded.password,private_key_ref=excluded.private_key_ref,
      tags=excluded.tags,updated_at=excluded.updated_at
    `).run({
      id,
      name: payload.name || payload.host,
      host: payload.host,
      port: Number(payload.port || 22),
      username: payload.username,
      auth_type: payload.authType || 'password',
      password: payload.password || null,
      private_key_ref: payload.privateKeyRef || null,
      category: payload.category || '默认',
      tags: JSON.stringify(payload.tags || []),
      created_at: now,
      updated_at: now,
    })
    return { ok: true, id }
  } catch (e) {
    return { ok: false, error: e?.message || '保存主机失败' }
  }
})

ipcMain.handle('hosts:delete', async (_event, payload) => {
  try {
    refreshDbFromDisk('hosts:delete', true)
    const currentDb = requireDbReady()
    currentDb.prepare('DELETE FROM hosts WHERE id = ?').run(payload.id)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || '删除主机失败' }
  }
})

ipcMain.handle('snippets:get-state', async () => {
  try {
    refreshDbFromDisk('snippets:get-state', true)
    const currentDb = requireDbReady()
    const normalized = normalizeSnippetStateForRead({
      items: currentDb.data.snippets,
      snippet_meta: currentDb.data.snippet_meta,
    })
    const items = Array.isArray(currentDb.data.snippets)
      ? normalized.items
      : []
    const extraCategories = normalized.extraCategories
    return { ok: true, items, extraCategories }
  } catch (e) {
    return { ok: false, error: e?.message || '读取代码片段失败', items: [], extraCategories: [] }
  }
})

ipcMain.handle('snippets:set-state', async (_event, payload) => {
  try {
    refreshDbFromDisk('snippets:set-state', true)
    const currentDb = requireDbReady()
    const normalized = normalizeSnippetState(payload)
    currentDb.data.snippets = normalized.items
    currentDb.data.snippet_meta = {
      extra_categories: normalized.extraCategories,
      updated_at: normalized.updatedAt,
    }
    currentDb.save()
    return { ok: true, items: normalized.items, extraCategories: normalized.extraCategories }
  } catch (e) {
    return { ok: false, error: e?.message || '保存代码片段失败', items: [], extraCategories: [] }
  }
})

ipcMain.handle('vault:status', async () => {
  const dbPath = resolveDbPath()
  if (!dbPath) return { ok: true, configured: false, exists: false, initialized: false, unlocked: false }
  if (!storageFileExists(dbPath)) return { ok: true, configured: true, exists: false, initialized: false, unlocked: false }
  try {
    refreshDbFromDisk('vault:status', true)
    const currentDb = requireDbReady()
    const row = currentDb.prepare('SELECT id FROM vault_meta WHERE id = 1').get()
    const state = { ok: true, configured: true, exists: true, initialized: !!row, unlocked: !!vaultKey }
    logMain(`vault:status initialized=${state.initialized} unlocked=${state.unlocked}`)
    return state
  } catch (e) {
    const error = e?.message || '数据文件无法读取'
    logMain(`vault:status error=${error}`)
    return { ok: true, configured: true, exists: true, initialized: false, unlocked: false, error }
  }
})

ipcMain.handle('vault:set-master', async (_event, payload) => {
  try {
    refreshDbFromDisk('vault:set-master', true)
    const currentDb = requireDbReady({ allowCreate: true })
    const pwd = String(payload?.masterPassword || '')
    if (!pwd || pwd.length < 1) return { ok: false, error: '主密码不能为空' }

    const salt = crypto.randomBytes(16)
    const key = deriveKey(pwd, salt)
    const verifierHash = crypto.createHash('sha256').update(key).digest('base64')
    vaultKey = key
    currentDb.setEncryptionKey(vaultKey)
    currentDb.prepare('INSERT OR REPLACE INTO vault_meta (id, salt, verifier_hash, updated_at) VALUES (1, ?, ?, ?)').run(salt.toString('base64'), verifierHash, Date.now())
    currentDb.save()
    logMain('vault:set-master ok')
    return { ok: true }
  } catch (e) {
    logMain(`vault:set-master error: ${e?.message || e}`)
    return { ok: false, error: `初始化失败：${e?.message || e}` }
  }
})

ipcMain.handle('vault:unlock', async (_event, payload) => {
  try {
    refreshDbFromDisk('vault:unlock', true)
    const currentDb = requireDbReady()
    const pwd = String(payload?.masterPassword || '')
    if (!pwd) return { ok: false, error: '请输入主密码' }

    const meta = currentDb.prepare('SELECT * FROM vault_meta WHERE id = 1').get()
    if (!meta) return { ok: false, error: '密钥仓库未初始化' }

    const key = deriveKey(pwd, Buffer.from(meta.salt, 'base64'))
    if (crypto.createHash('sha256').update(key).digest('base64') !== meta.verifier_hash) return { ok: false, error: '主密码错误' }
    vaultKey = key
    currentDb.setEncryptionKey(vaultKey)
    if (currentDb.encryptedPayload && !currentDb.applyDecryptedPayload()) {
      return { ok: false, error: '数据文件解密失败，请确认当前使用的是同一份数据文件' }
    }
    currentDb.save()
    logMain('vault:unlock ok')
    return { ok: true }
  } catch (e) {
    logMain(`vault:unlock error: ${e?.message || e}`)
    return { ok: false, error: `解锁失败：${e?.message || e}` }
  }
})

ipcMain.handle('vault:reset', async () => {
  try {
    refreshDbFromDisk('vault:reset', true)
    const currentDb = requireDbReady()
    currentDb.data.vault_meta = null
    currentDb.data.vault_keys = []
    currentDb.setEncryptionKey(null)
    currentDb.save()
    vaultKey = null
    logMain('vault:reset ok')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: `重置失败：${e?.message || e}` }
  }
})

ipcMain.handle('vault:key-save', async (_event, payload) => {
  try {
    refreshDbFromDisk('vault:key-save', true)
    const currentDb = requireDbReady()
    if (!vaultKey) return { ok: false, error: '密钥仓库未解锁' }
    const sshpk = await getSshpk()
    const id = payload.id || uuidv4()
    const privateKeyText = String(payload.privateKey || '').trim()
    const publicKeyText = String(payload.publicKey || '').trim()
    const certificateText = String(payload.certificate || '').trim()
    if (!privateKeyText && !publicKeyText && !certificateText) {
      return { ok: false, error: '请至少填写私钥/公钥/证书中的一项' }
    }

    let resolvedType = payload.type || 'auto'
    let keyObj = null
    if (privateKeyText) {
      try {
        if (!payload.type || payload.type === 'auto') {
          try {
            keyObj = sshpk.parsePrivateKey(privateKeyText, 'putty')
            resolvedType = 'ppk'
          } catch {
            try {
              keyObj = sshpk.parsePrivateKey(privateKeyText, 'pem')
              resolvedType = 'pem'
            } catch {
              keyObj = sshpk.parsePrivateKey(privateKeyText, 'auto')
              resolvedType = 'openssh'
            }
          }
        } else {
          keyObj = sshpk.parsePrivateKey(privateKeyText, payload.type === 'ppk' ? 'putty' : payload.type)
        }
      } catch {
        return { ok: false, error: '无法识别私钥格式，请检查内容是否完整' }
      }
    } else if (!payload.type || payload.type === 'auto') {
      resolvedType = publicKeyText && certificateText ? 'bundle' : publicKeyText ? 'public' : 'certificate'
    }

    const enc = encryptText(JSON.stringify({
      privateKey: privateKeyText,
      publicKey: publicKeyText,
      certificate: certificateText,
    }), vaultKey)
    let fp = payload.fingerprint || null
    try {
      fp = keyObj?.toPublic().fingerprint('sha256').toString() || null
    } catch {}

    currentDb.prepare(`
    INSERT INTO vault_keys (id, name, type, fingerprint, encrypted_blob, created_at, updated_at)
    VALUES (@id,@name,@type,@fingerprint,@encrypted_blob,@created_at,@updated_at)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,type=excluded.type,fingerprint=excluded.fingerprint,encrypted_blob=excluded.encrypted_blob,updated_at=excluded.updated_at
    `).run({
      id,
      name: payload.name || '未命名密钥',
      type: resolvedType,
      fingerprint: fp,
      encrypted_blob: JSON.stringify(enc),
      created_at: Date.now(),
      updated_at: Date.now(),
    })
    return { ok: true, id, detectedType: resolvedType }
  } catch (e) {
    return { ok: false, error: e?.message || '保存密钥失败' }
  }
})

ipcMain.handle('vault:key-import-file', async () => {
  const sshpk = await getSshpk()
  const win = BrowserWindow.getFocusedWindow()
  const result = await dialog.showOpenDialog(win, {
    title: '选择私钥文件',
    properties: ['openFile'],
    filters: [{ name: 'Key Files', extensions: ['pem', 'key', 'ppk', '*'] }],
  })
  if (result.canceled || !result.filePaths?.[0]) return { ok: false, error: '已取消' }
  const filePath = result.filePaths[0]
  const content = fs.readFileSync(filePath, 'utf8')
  const lower = filePath.toLowerCase()
  const detectedType = lower.endsWith('.ppk') ? 'ppk' : lower.endsWith('.pem') ? 'pem' : 'openssh'

  if (detectedType === 'ppk') {
    try {
      const keyObj = sshpk.parsePrivateKey(content, 'putty')
      const converted = keyObj.toString('openssh')
      return { ok: true, content: converted, detectedType: 'openssh', filePath }
    } catch {
      return { ok: false, error: 'PPK 解析失败，请确认不是新版加密 PPK 或先用 PuTTYgen 转 OpenSSH', raw: content, detectedType }
    }
  }

  return { ok: true, content, detectedType, filePath }
})

ipcMain.handle('vault:key-list', async () => {
  try {
    refreshDbFromDisk('vault:key-list')
    const currentDb = requireDbReady()
    return { ok: true, items: currentDb.prepare('SELECT id, name, type, fingerprint, created_at, updated_at FROM vault_keys ORDER BY updated_at DESC').all() }
  } catch (e) {
    return { ok: false, error: e?.message || '读取密钥列表失败', items: [] }
  }
})

ipcMain.handle('vault:key-get', async (_event, payload) => {
  try {
    refreshDbFromDisk('vault:key-get')
    const currentDb = requireDbReady()
    if (!vaultKey) return { ok: false, error: '密钥仓库未解锁' }
    const row = currentDb.prepare('SELECT * FROM vault_keys WHERE id = ?').get(payload.id)
    if (!row) return { ok: false, error: '密钥不存在' }
    const raw = decryptText(JSON.parse(row.encrypted_blob), vaultKey)
    let parsed = { privateKey: '', publicKey: '', certificate: '' }
    try {
      const obj = JSON.parse(raw)
      if (obj && typeof obj === 'object') parsed = { ...parsed, ...obj }
      else parsed.privateKey = raw
    } catch {
      parsed.privateKey = raw
    }
    return { ok: true, item: { id: row.id, name: row.name, type: row.type, ...parsed } }
  } catch (e) {
    return { ok: false, error: e?.message || '读取密钥失败' }
  }
})

ipcMain.handle('sync:login', async () => {
  return { ok: true }
})
ipcMain.handle('sync:status', async () => {
  return { ok: true, account: null, queueCount: 0 }
})
ipcMain.handle('sync:queue', async () => ({ ok: true, items: [] }))
ipcMain.handle('sync:clear-queue', async () => {
  return { ok: true }
})
ipcMain.handle('sync:push-now', async () => {
  return { ok: true, pushed: 0 }
})

ipcMain.handle('serial:list', async () => {
  try {
    const SerialPort = await getSerialPortCtor()
    return (await SerialPort.list()).map((p) => ({
      path: p.path,
      manufacturer: p.manufacturer,
      serialNumber: p.serialNumber,
      vendorId: p.vendorId,
      productId: p.productId,
    }))
  } catch (e) {
    logMain(`serial:list unavailable: ${e?.message || e}`)
    return []
  }
})
ipcMain.handle('serial:open', async (_event, options) => {
  try {
    const SerialPort = await getSerialPortCtor()
    const key = options.path
    if (serialPorts.has(key)) return { ok: true }
    const port = new SerialPort({
      path: options.path,
      baudRate: Number(options.baudRate || 115200),
      dataBits: Number(options.dataBits || 8),
      stopBits: Number(options.stopBits || 1),
      parity: options.parity || 'none',
      rtscts: !!options.rtscts,
      dsrdtr: !!options.dsrdtr,
      xon: !!options.xon,
      xoff: !!options.xoff,
      autoOpen: true,
    })
    serialPorts.set(key, port)
    serialInputBuffers.set(key, '')
    serialOutputBuffers.set(key, '')
    port.on('data', (data) => {
      const text = data.toString('utf8')
      broadcast('serial:data', { path: key, data: text })
      logOutputLines(serialOutputBuffers, key, text, 'serial', key)
    })
    port.on('error', (err) => {
      const message = err?.message || '串口异常'
      appendAuditLog({ source: 'serial', action: 'error', target: key, content: message, level: 'error' })
      broadcast('serial:error', { path: key, error: message })
    })
    appendAuditLog({
      source: 'serial',
      action: 'connect',
      target: key,
      content: `连接成功（波特率 ${Number(options.baudRate || 115200)}，数据位 ${Number(options.dataBits || 8)}，停止位 ${Number(options.stopBits || 1)}，校验 ${options.parity || 'none'}）`,
    })
    return { ok: true }
  } catch (e) {
    const message = serialModuleLoadError || e?.message || '串口模块不可用'
    logMain(`serial:open failed: ${message}`)
    appendAuditLog({ source: 'serial', action: 'error', target: String(options?.path || ''), content: message, level: 'error' })
    return { ok: false, error: message }
  }
})
ipcMain.handle('serial:send', async (_event, payload) => {
  const port = serialPorts.get(payload.path)
  if (!port) return { ok: false, error: '串口未打开' }
  const textData = String(payload?.data || '')
  const data = payload.isHex ? Buffer.from(textData.replace(/\s+/g, ''), 'hex') : textData
  await new Promise((resolve, reject) => port.write(data, (err) => (err ? reject(err) : resolve(true))))
  const target = String(payload.path || '')
  if (payload.isHex) {
    appendAuditLog({ source: 'serial', action: 'command', target, content: textData })
  } else if (textData.includes('\n') || textData.includes('\r')) {
    logCommandLines(serialInputBuffers, target, textData, 'serial', target)
  } else if (textData.length > 1) {
    serialInputBuffers.set(target, '')
    appendAuditLog({ source: 'serial', action: 'command', target, content: textData })
  } else {
    extractCommandLines(serialInputBuffers, target, textData)
  }
  return { ok: true }
})

ipcMain.handle('serial:close', async (_event, payload) => {
  const key = String(payload?.path || '')
  const port = serialPorts.get(key)
  if (!port) return { ok: true }
  return await new Promise((resolve) => {
    const done = (ok, error = '') => {
      serialPorts.delete(key)
      serialInputBuffers.delete(key)
      serialOutputBuffers.delete(key)
      flushResponseLogsForSession('serial', key)
      if (ok) {
        appendAuditLog({ source: 'serial', action: 'disconnect', target: key, content: '手动断开' })
        resolve({ ok: true })
      } else {
        appendAuditLog({ source: 'serial', action: 'error', target: key, content: error, level: 'error' })
        resolve({ ok: false, error })
      }
    }
    try {
      if (port.isOpen === false || typeof port.close !== 'function') {
        try { port.destroy?.() } catch {}
        done(true)
        return
      }
      port.close((err) => {
        if (err) return done(false, err?.message || '关闭串口失败')
        done(true)
      })
    } catch (e) {
      done(false, e?.message || '关闭串口失败')
    }
  })
})

registerLocalIpc(ipcMain, {
  getLocalShellCommand,
  buildShellSpawnOptions,
  applyLocalShellRuntimeEnv,
  getNodePtySpawn,
  closeLocalShellSession,
  appendAuditLog,
  broadcast,
  logOutputLines,
  flushResponseLogsForSession,
  logCommandLines,
  localShellSessions,
  localInputBuffers,
  localOutputBuffers,
})

registerSshIpc(ipcMain, {
  createSSHClient,
  attachKeyboardHandler,
  connectConfigFromPayload,
  buildShellColorInitScript,
  appendAuditLog,
  broadcast,
  logOutputLines,
  flushResponseLogsForSession,
  logCommandLines,
  sshSessions,
  sshInputBuffers,
  sshOutputBuffers,
})

registerLocalFsIpc(ipcMain)

registerSftpIpc(ipcMain, {
  withSftp,
  broadcast,
})
