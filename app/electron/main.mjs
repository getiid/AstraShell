import { app, BrowserWindow, ipcMain, dialog, Menu, clipboard, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { v4 as uuidv4 } from 'uuid'
import { safeParse, setStorageFolderSchema, syncSetConfigSchema } from './ipc/schemas.mjs'
import { registerDatabaseIpc } from './ipc/database.mjs'
import { registerLocalFsIpc } from './ipc/localfs.mjs'
import { registerLocalIpc } from './ipc/local.mjs'
import { registerSftpIpc } from './ipc/sftp.mjs'
import { registerSshIpc } from './ipc/ssh.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDev = !app.isPackaged
const isFolderSyncSmokeMode = process.env.ASTRASHELL_SMOKE_FOLDER_SYNC === '1'
const smokeUserDataDir = String(process.env.ASTRASHELL_SMOKE_USER_DATA_DIR || '').trim()
if (isFolderSyncSmokeMode && smokeUserDataDir) {
  try {
    fs.mkdirSync(smokeUserDataDir, { recursive: true })
    app.setPath('userData', smokeUserDataDir)
  } catch {}
}
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
const SYNC_STATE_FILE_NAME = 'astrashell.sync.json'
const DEFAULT_SYNC_DEBOUNCE_MS = 1500
let syncPushTimer = null

const localAuditLogPath = () => path.join(app.getPath('userData'), 'audit.local.json')
let localAuditLogs = []

function loadLocalAuditLogs() {
  try {
    const p = localAuditLogPath()
    if (!fs.existsSync(p)) {
      localAuditLogs = []
      return
    }
    const raw = fs.readFileSync(p, 'utf8')
    const parsed = JSON.parse(raw)
    localAuditLogs = Array.isArray(parsed) ? parsed.slice(0, MAX_AUDIT_LOGS) : []
  } catch {
    localAuditLogs = []
  }
}

function saveLocalAuditLogs() {
  try {
    const p = localAuditLogPath()
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(localAuditLogs.slice(0, MAX_AUDIT_LOGS), null, 2), 'utf8')
  } catch {}
}
const macManualInstallTip = '当前构建未使用 Developer ID 签名，无法一键安装更新。请从 GitHub Release 下载 DMG 手动覆盖安装。'
const githubReleaseProvider = {
  provider: 'github',
  owner: 'getiid',
  repo: 'AstraShell',
  releaseType: 'release',
}

process.on('uncaughtException', (error) => {
  const message = String(error?.message || error || '')
  if (/Cannot resize a pty that has already exited/i.test(message)) {
    logMain(`ignored uncaughtException: ${message}`)
    return
  }
  logMain(`uncaughtException: ${message}`)
})

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

function appendAuditLog(payload = {}) {
  try {
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
    localAuditLogs.unshift(row)
    if (localAuditLogs.length > MAX_AUDIT_LOGS) localAuditLogs = localAuditLogs.slice(0, MAX_AUDIT_LOGS)
    saveLocalAuditLogs()
    broadcast('audit:appended', row)
    return row
  } catch (e) {
    logMain(`appendAuditLog failed: ${e?.message || e}`)
    return null
  }
}

function listAuditLogsFromDb(_currentDb, payload = {}) {
  const limitRaw = Number(payload?.limit || 300)
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 300, 1), MAX_AUDIT_LOGS)
  const source = String(payload?.source || '').trim()
  const keyword = String(payload?.keyword || '').trim().toLowerCase()
  let rows = [...localAuditLogs].map((row) => {
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
  const lines = Array.isArray(state.lines) ? state.lines : []
  const content = lines.join('\n').trim().slice(0, 12000)
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
    }
    responseLogBuffers.set(key, state)
  }
  if (String(target || '').trim()) state.target = String(target || '').trim()
  state.lines.push(String(line || ''))
  const totalChars = state.lines.reduce((sum, item) => sum + String(item || '').length, 0)
  if (state.lines.length > 240 || totalChars > 12000) {
    flushResponseLogBuffer(key)
  }
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

function getDefaultDbPath() {
  return path.join(app.getPath('userData'), 'data', DATA_FILE_NAME)
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
  return getDefaultDbPath()
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
  return getDefaultDbPath()
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

function getFileSignatureByPath(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return ''
  try {
    const stat = fs.statSync(filePath)
    const size = Number(stat?.size || 0)
    const mtimeMs = Number(stat?.mtimeMs || 0)
    const raw = fs.readFileSync(filePath, 'utf8')
    const hash = crypto.createHash('sha1').update(raw).digest('hex')
    return `${size}:${Math.trunc(mtimeMs)}:${hash}`
  } catch {
    return ''
  }
}

function getSyncStatePath() {
  return path.join(app.getPath('userData'), SYNC_STATE_FILE_NAME)
}

function createDefaultSyncState() {
  return {
    deviceId: uuidv4(),
    running: false,
    lastDirection: 'idle',
    lastPushAt: 0,
    lastPullAt: 0,
    lastPushedRevision: 0,
    lastPulledRevision: 0,
    lastRemoteRevision: 0,
    lastError: '',
    lastSuccessMessage: '',
    remoteMeta: null,
    queue: [],
    updatedAt: 0,
  }
}

function readSyncState() {
  try {
    const p = getSyncStatePath()
    if (!fs.existsSync(p)) return createDefaultSyncState()
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'))
    return {
      ...createDefaultSyncState(),
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
      queue: Array.isArray(parsed?.queue) ? parsed.queue : [],
    }
  } catch {
    return createDefaultSyncState()
  }
}

function writeSyncState(next) {
  try {
    const p = getSyncStatePath()
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf8')
  } catch {}
}

function updateSyncState(mutator) {
  const state = readSyncState()
  mutator(state)
  state.updatedAt = Date.now()
  writeSyncState(state)
  return state
}

function normalizeSyncPathForCompare(inputPath) {
  return normalizeStoragePath(inputPath).replace(/\\/g, '/').toLowerCase()
}

function getSyncConfig() {
  const raw = readSettings()?.sync || {}
  return {
    enabled: !!raw.enabled,
    provider: raw.provider === 'http' ? 'http' : 'folder',
    targetPath: normalizeStoragePath(String(raw.targetPath || '').trim()),
    baseUrl: String(raw.baseUrl || '').trim().replace(/\/+$/, ''),
    token: String(raw.token || '').trim(),
    password: String(raw.password || ''),
    autoPullOnStartup: raw.autoPullOnStartup !== false,
    autoPushOnChange: raw.autoPushOnChange !== false,
    debounceMs: Math.max(300, Math.min(60000, Number(raw.debounceMs || DEFAULT_SYNC_DEBOUNCE_MS))),
  }
}

function getFileSnapshotMeta(filePath) {
  const normalizedPath = normalizeStoragePath(filePath)
  if (!normalizedPath) return { path: '', exists: false }
  const parsed = readJsonFile(normalizedPath)
  const stat = fs.existsSync(normalizedPath) ? fs.statSync(normalizedPath) : null
  const summary = parsed?.sync_meta?.summary && typeof parsed.sync_meta.summary === 'object'
    ? parsed.sync_meta.summary
    : null
  const hosts = Number(summary?.hosts || (Array.isArray(parsed?.hosts) ? parsed.hosts.length : 0))
  const dbConnections = Number(summary?.dbConnections || (Array.isArray(parsed?.db_connections) ? parsed.db_connections.length : 0))
  const snippets = Number(summary?.snippets || (Array.isArray(parsed?.snippets) ? parsed.snippets.length : 0))
  const vaultKeys = Number(summary?.vaultKeys || (Array.isArray(parsed?.vault_keys) ? parsed.vault_keys.length : 0))
  const quickTools = Number(summary?.quickTools || (Array.isArray(parsed?.quick_tools) ? parsed.quick_tools.length : 0))
  return {
    path: normalizedPath,
    exists: !!stat,
    size: Number(stat?.size || 0),
    mtimeMs: Number(stat?.mtimeMs || 0),
    encrypted: !!parsed?.encrypted_payload,
    storageVersion: Number(parsed?.storage_version || 1),
    fileId: String(parsed?.file_id || ''),
    revision: Number(parsed?.revision || 0),
    signature: getFileSignatureByPath(normalizedPath),
    hosts,
    dbConnections,
    snippets,
    vaultKeys,
    quickTools,
    itemCount: hosts + dbConnections + snippets + vaultKeys + quickTools,
  }
}

function parseSyncRemoteMeta(input, fallback = {}) {
  const meta = input?.meta && typeof input.meta === 'object' ? input.meta : input
  const summary = meta?.summary && typeof meta.summary === 'object' ? meta.summary : fallback.summary || {}
  const hosts = Number(meta?.hosts || summary?.hosts || fallback.hosts || 0)
  const dbConnections = Number(meta?.dbConnections || summary?.dbConnections || fallback.dbConnections || 0)
  const snippets = Number(meta?.snippets || summary?.snippets || fallback.snippets || 0)
  const vaultKeys = Number(meta?.vaultKeys || summary?.vaultKeys || fallback.vaultKeys || 0)
  const quickTools = Number(meta?.quickTools || summary?.quickTools || fallback.quickTools || 0)
  return {
    path: String(meta?.path || fallback.path || ''),
    exists: meta?.exists !== false,
    size: Number(meta?.size || fallback.size || 0),
    mtimeMs: Number(meta?.mtimeMs || meta?.updatedAt || fallback.mtimeMs || 0),
    encrypted: !!(meta?.encrypted ?? fallback.encrypted),
    storageVersion: Number(meta?.storageVersion || meta?.storage_version || fallback.storageVersion || 1),
    fileId: String(meta?.fileId || meta?.file_id || fallback.fileId || ''),
    revision: Number(meta?.revision || fallback.revision || 0),
    signature: String(meta?.signature || fallback.signature || ''),
    hosts,
    dbConnections,
    snippets,
    vaultKeys,
    quickTools,
    itemCount: Number(meta?.itemCount || summary?.itemCount || fallback.itemCount || (hosts + dbConnections + snippets + vaultKeys + quickTools)),
  }
}

function shouldSkipSyncPullByRevision(localMeta, remoteMeta) {
  const localRevision = Number(localMeta?.revision || 0)
  const remoteRevision = Number(remoteMeta?.revision || 0)
  const localItemCount = Number(localMeta?.itemCount || 0)
  const remoteItemCount = Number(remoteMeta?.itemCount || 0)

  if (!localMeta?.exists) return false
  if (localItemCount <= 0 && remoteItemCount > 0) return false
  return remoteRevision <= localRevision
}

function withSyncAuthHeaders(config, extraHeaders = {}) {
  const headers = { ...extraHeaders }
  if (config.token) headers.Authorization = `Bearer ${config.token}`
  return headers
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    const raw = await response.text()
    const data = raw ? (() => {
      try { return JSON.parse(raw) } catch { return null }
    })() : null
    if (!response.ok) {
      return { ok: false, status: response.status, error: data?.error || `${response.status} ${response.statusText}` }
    }
    if (data && typeof data === 'object') return data
    return { ok: true }
  } catch (e) {
    if (e?.name === 'AbortError') return { ok: false, error: '请求超时' }
    return { ok: false, error: e?.message || '网络请求失败' }
  } finally {
    clearTimeout(timer)
  }
}

async function httpSyncGetMeta(config) {
  if (!config.baseUrl) return { ok: false, error: '请先配置同步服务地址' }
  return fetchJsonWithTimeout(`${config.baseUrl}/meta`, {
    method: 'GET',
    headers: withSyncAuthHeaders(config, { Accept: 'application/json' }),
  })
}

async function httpSyncDownload(config) {
  if (!config.baseUrl) return { ok: false, error: '请先配置同步服务地址' }
  return fetchJsonWithTimeout(`${config.baseUrl}/download`, {
    method: 'GET',
    headers: withSyncAuthHeaders(config, { Accept: 'application/json' }),
  }, 20000)
}

async function httpSyncUpload(config, payload) {
  if (!config.baseUrl) return { ok: false, error: '请先配置同步服务地址' }
  return fetchJsonWithTimeout(`${config.baseUrl}/upload`, {
    method: 'PUT',
    headers: withSyncAuthHeaders(config, { Accept: 'application/json', 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  }, 20000)
}

function getCachedRemoteMeta(config = getSyncConfig(), state = readSyncState()) {
  if (config.provider === 'folder') return getFileSnapshotMeta(config.targetPath)
  return state.remoteMeta || null
}

function broadcastSyncStatus(extra = {}) {
  const config = getSyncConfig()
  const state = readSyncState()
  const payload = {
    ok: true,
    config,
    state,
    queueCount: state.queue.length,
    local: getStorageMeta(),
    remote: getCachedRemoteMeta(config, state),
    ...extra,
  }
  broadcast('sync:status', payload)
  return payload
}

function replaceSyncQueue(queue) {
  updateSyncState((state) => {
    state.queue = Array.isArray(queue) ? queue : []
  })
  broadcastSyncStatus()
}

function upsertPendingPushTask(reason = 'local-change') {
  const localMeta = getStorageMeta()
  const config = getSyncConfig()
  const targetPath = config.provider === 'http' ? config.baseUrl : config.targetPath
  updateSyncState((state) => {
    const now = Date.now()
    const previous = state.queue.find((item) => item.type === 'push') || null
    state.queue = [{
      id: previous?.id || `sync-push-${now.toString(36)}`,
      type: 'push',
      reason,
      createdAt: previous?.createdAt || now,
      lastAttemptAt: previous?.lastAttemptAt || 0,
      attempts: previous?.attempts || 0,
      baseRevision: Number(localMeta?.revision || 0),
      targetPath,
      error: previous?.error || '',
    }]
  })
  broadcastSyncStatus()
}

function markPendingPushAttempt(errorMessage = '') {
  updateSyncState((state) => {
    state.queue = (Array.isArray(state.queue) ? state.queue : []).map((item) => item.type === 'push'
      ? {
        ...item,
        lastAttemptAt: Date.now(),
        attempts: Number(item.attempts || 0) + 1,
        error: errorMessage,
      }
      : item)
  })
}

function clearPendingPushTask() {
  updateSyncState((state) => {
    state.queue = (Array.isArray(state.queue) ? state.queue : []).filter((item) => item.type !== 'push')
  })
  broadcastSyncStatus()
}

function setSyncSuccess(direction, message, extra = {}) {
  updateSyncState((state) => {
    state.running = false
    state.lastDirection = direction
    state.lastError = ''
    state.lastSuccessMessage = message
    Object.assign(state, extra)
  })
  broadcastSyncStatus()
}

function setSyncError(direction, message, extra = {}) {
  updateSyncState((state) => {
    state.running = false
    state.lastDirection = direction
    state.lastError = message
    Object.assign(state, extra)
  })
  broadcastSyncStatus()
}

function setSyncRunning(direction) {
  updateSyncState((state) => {
    state.running = true
    state.lastDirection = direction
  })
  broadcastSyncStatus()
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function copyFileAtomic(sourcePath, targetPath) {
  ensureParentDir(targetPath)
  const tmpPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`,
  )
  fs.copyFileSync(sourcePath, tmpPath)
  fs.renameSync(tmpPath, targetPath)
}

function scheduleAutoSyncPush(reason = 'local-change') {
  const config = getSyncConfig()
  if (!config.enabled || !config.autoPushOnChange) return
  const validated = validateSyncTargetPath(config)
  if (!validated.ok) return
  const localPath = resolveDbPath() || activeDbPath
  if (!localPath) return
  upsertPendingPushTask(reason)
  if (syncPushTimer) clearTimeout(syncPushTimer)
  syncPushTimer = setTimeout(() => {
    syncPushTimer = null
    void performSyncPush({ manual: false, reason: 'auto-push' })
  }, config.debounceMs)
}

function cancelAutoSyncPushTimer() {
  if (!syncPushTimer) return
  clearTimeout(syncPushTimer)
  syncPushTimer = null
}

function validateSyncTargetPath(config = getSyncConfig()) {
  if (config.provider === 'http') {
    if (!/^https?:\/\//i.test(String(config.baseUrl || ''))) {
      return { ok: false, error: '请配置有效的同步服务地址（http/https）' }
    }
    return { ok: true, provider: 'http', baseUrl: config.baseUrl }
  }

  const targetPath = normalizeStoragePath(config.targetPath)
  if (!targetPath) return { ok: false, error: '请先配置同步目标路径' }
  const localPath = normalizeStoragePath(resolveDbPath() || activeDbPath)
  if (localPath && normalizeSyncPathForCompare(localPath) === normalizeSyncPathForCompare(targetPath)) {
    return { ok: false, error: '同步目标不能与本地数据文件相同' }
  }
  return { ok: true, provider: 'folder', targetPath }
}

async function testSyncConnection() {
  const config = getSyncConfig()
  const validated = validateSyncTargetPath(config)
  if (!validated.ok) return { ok: false, error: validated.error }
  if (validated.provider === 'http') {
    const res = await httpSyncGetMeta(config)
    if (!res?.ok) return { ok: false, error: res?.error || '同步服务不可用' }
    const remoteMeta = parseSyncRemoteMeta(res, { path: config.baseUrl })
    updateSyncState((state) => {
      state.remoteMeta = remoteMeta
      state.lastRemoteRevision = Number(remoteMeta.revision || 0)
      state.lastError = ''
    })
    broadcastSyncStatus()
    return { ok: true, provider: config.provider, targetPath: config.baseUrl, remote: remoteMeta }
  }
  try {
    ensureParentDir(validated.targetPath)
    const remoteMeta = getFileSnapshotMeta(validated.targetPath)
    if (remoteMeta.exists) {
      const raw = fs.readFileSync(validated.targetPath, 'utf8')
      extractSyncSnapshotContent(raw, config.password)
    }
    updateSyncState((state) => {
      state.remoteMeta = remoteMeta
      state.lastRemoteRevision = Number(remoteMeta.revision || 0)
      state.lastError = ''
    })
    broadcastSyncStatus()
    return {
      ok: true,
      provider: config.provider,
      targetPath: validated.targetPath,
      remote: remoteMeta,
    }
  } catch (e) {
    return { ok: false, error: e?.message || '无法访问同步目录' }
  }
}

function writeTextAtomic(targetPath, content) {
  ensureParentDir(targetPath)
  const tmpPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`,
  )
  fs.writeFileSync(tmpPath, String(content || ''), 'utf8')
  fs.renameSync(tmpPath, targetPath)
}

async function performSyncPull(options = {}) {
  const validated = validateSyncTargetPath(getSyncConfig())
  if (!validated.ok) return { ok: false, error: validated.error }
  const localPath = resolveDbPath() || activeDbPath
  if (!localPath) return { ok: false, error: '未配置本地数据文件路径' }

  try {
    setSyncRunning('pull')
    let remoteMeta = null
    let remoteContent = ''
    if (validated.provider === 'http') {
      const metaRes = await httpSyncGetMeta(getSyncConfig())
      if (!metaRes?.ok) {
        const message = metaRes?.error || '读取远端同步元信息失败'
        setSyncError('pull', message)
        return { ok: false, error: message }
      }
      remoteMeta = parseSyncRemoteMeta(metaRes, { path: getSyncConfig().baseUrl })
      if (!remoteMeta.exists) {
        setSyncSuccess('pull', '同步服务暂无可下载的数据快照', {
          remoteMeta,
          lastRemoteRevision: Number(remoteMeta.revision || 0),
        })
        return { ok: true, changed: false, pulled: 0, message: '同步服务暂无可下载的数据快照' }
      }
    } else {
      remoteMeta = getFileSnapshotMeta(validated.targetPath)
    }

    if (!remoteMeta.exists) {
      setSyncSuccess('pull', '同步目录暂无可下载的数据快照')
      return { ok: true, changed: false, pulled: 0, message: '同步目录暂无可下载的数据快照' }
    }

    const localMeta = getFileSnapshotMeta(localPath)
    if (shouldSkipSyncPullByRevision(localMeta, remoteMeta)) {
      setSyncSuccess('pull', '远端数据未领先，本地保持不变', {
        lastPullAt: Date.now(),
        lastRemoteRevision: Number(remoteMeta.revision || 0),
      })
      return { ok: true, changed: false, pulled: 0, message: '远端数据未领先，本地保持不变' }
    }

    if (validated.provider === 'http') {
      const downloadRes = await httpSyncDownload(getSyncConfig())
      if (!downloadRes?.ok) {
        const message = downloadRes?.error || '下载远端同步快照失败'
        setSyncError('pull', message, { remoteMeta })
        return { ok: false, error: message }
      }
      remoteContent = typeof downloadRes.content === 'string'
        ? downloadRes.content
        : typeof downloadRes.contentBase64 === 'string'
          ? Buffer.from(downloadRes.contentBase64, 'base64').toString('utf8')
          : ''
      if (!remoteContent) {
        const message = '同步服务返回的下载内容为空'
        setSyncError('pull', message, { remoteMeta })
        return { ok: false, error: message }
      }
      const plainContent = extractSyncSnapshotContent(remoteContent, getSyncConfig().password)
      writeTextAtomic(localPath, plainContent)
    } else {
      const remoteContent = fs.readFileSync(validated.targetPath, 'utf8')
      const plainContent = extractSyncSnapshotContent(remoteContent, getSyncConfig().password)
      writeTextAtomic(localPath, plainContent)
    }
    db = null
    initDb()
    refreshDbFromDisk('sync:pull-now', true)
    updateSyncState((state) => {
      state.lastPullAt = Date.now()
      state.lastPulledRevision = Number(remoteMeta.revision || 0)
      state.lastRemoteRevision = Number(remoteMeta.revision || 0)
      state.remoteMeta = remoteMeta
    })
    const successMessage = `已下载远端数据 rev.${remoteMeta.revision || 0}`
    broadcast('storage:data-changed', {
      changedAt: Date.now(),
      pulled: true,
      source: options.reason || 'sync',
    })
    setSyncSuccess('pull', successMessage)
    return {
      ok: true,
      changed: true,
      pulled: 1,
      message: successMessage,
    }
  } catch (e) {
    const message = e?.message || '下载同步数据失败'
    setSyncError('pull', message)
    return { ok: false, error: message }
  }
}

async function performSyncPush(options = {}) {
  const config = getSyncConfig()
  const validated = validateSyncTargetPath(config)
  if (!validated.ok) return { ok: false, error: validated.error }
  const localPath = resolveDbPath() || activeDbPath
  if (!localPath || !fs.existsSync(localPath)) return { ok: false, error: '本地数据文件不存在' }

  try {
    setSyncRunning('push')
    const localMeta = getFileSnapshotMeta(localPath)
    let remoteMeta = validated.provider === 'folder' ? getFileSnapshotMeta(validated.targetPath) : null
    if (validated.provider === 'http') {
      const metaRes = await httpSyncGetMeta(config)
      if (metaRes?.ok) remoteMeta = parseSyncRemoteMeta(metaRes, { path: config.baseUrl })
      else if (metaRes?.error && !/404/.test(String(metaRes.error))) {
        const message = metaRes.error || '读取远端同步元信息失败'
        markPendingPushAttempt(message)
        setSyncError('push', message)
        return { ok: false, error: message }
      }
    }

    if (
      remoteMeta?.exists
      && Number(remoteMeta.revision || 0) > Number(localMeta.revision || 0)
      && remoteMeta.signature !== localMeta.signature
    ) {
      const message = `远端已更新到 rev.${remoteMeta.revision || 0}，请先下载后再上传`
      markPendingPushAttempt(message)
      setSyncError('push', message, {
        lastRemoteRevision: Number(remoteMeta.revision || 0),
      })
      return { ok: false, conflict: true, error: message }
    }

    if (validated.provider === 'http') {
      const content = buildSyncSnapshotContent(fs.readFileSync(localPath, 'utf8'), config.password)
      const pushRes = await httpSyncUpload(config, {
        fileId: localMeta.fileId,
        revision: localMeta.revision,
        baseRevision: Math.max(
          Number(readSyncState().lastPushedRevision || 0),
          Number(readSyncState().lastPulledRevision || 0),
        ),
        signature: localMeta.signature,
        storageVersion: localMeta.storageVersion,
        content,
      })
      if (!pushRes?.ok) {
        const message = pushRes?.error || '上传同步数据失败'
        markPendingPushAttempt(message)
        setSyncError('push', message, { remoteMeta })
        return { ok: false, error: message }
      }
      remoteMeta = parseSyncRemoteMeta(pushRes, {
        path: config.baseUrl,
        revision: Number(pushRes?.revision || localMeta.revision || 0),
        fileId: String(pushRes?.fileId || localMeta.fileId || ''),
        signature: String(pushRes?.signature || localMeta.signature || ''),
        storageVersion: Number(pushRes?.storageVersion || localMeta.storageVersion || 1),
      })
    } else {
      const remoteContent = buildSyncSnapshotContent(fs.readFileSync(localPath, 'utf8'), config.password)
      writeTextAtomic(validated.targetPath, remoteContent)
      remoteMeta = getFileSnapshotMeta(validated.targetPath)
    }
    updateSyncState((state) => {
      state.lastPushAt = Date.now()
      state.lastPushedRevision = Number(localMeta.revision || 0)
      state.lastRemoteRevision = Number(localMeta.revision || 0)
      state.remoteMeta = remoteMeta
    })
    clearPendingPushTask()
    setSyncSuccess('push', `已上传本地数据 rev.${localMeta.revision || 0}`)
    return { ok: true, pushed: 1, message: `已上传本地数据 rev.${localMeta.revision || 0}` }
  } catch (e) {
    const message = e?.message || '上传同步数据失败'
    markPendingPushAttempt(message)
    setSyncError('push', message)
    return { ok: false, error: message }
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

function normalizeHostMeta(rawMeta) {
  return {
    extra_categories: parseExtraCategories(rawMeta?.extra_categories ?? rawMeta?.extraCategories ?? []),
    updated_at: Number(rawMeta?.updated_at || rawMeta?.updatedAt || 0),
  }
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
      const reminderDateRaw = String(item?.reminderDate ?? item?.reminder_date ?? '').trim()
      const reminderDate = /^\d{4}-\d{2}-\d{2}$/.test(reminderDateRaw) ? reminderDateRaw : ''
      const lastRunAtRaw = Number(item?.lastRunAt ?? item?.last_run_at ?? 0)
      const lastRunAt = Number.isFinite(lastRunAtRaw) && lastRunAtRaw > 0 ? lastRunAtRaw : 0
      const lastRunStatusRaw = String(item?.lastRunStatus ?? item?.last_run_status ?? 'idle').trim().toLowerCase()
      const lastRunStatus = ['success', 'error', 'running'].includes(lastRunStatusRaw) ? lastRunStatusRaw : 'idle'
      return {
        id: String(item?.id || item?.snippetId || uuidv4()),
        name,
        category: String(item?.category || item?.group || '部署').trim() || '部署',
        hostId: String(item?.hostId ?? item?.host_id ?? '').trim(),
        description: String(item?.description || item?.desc || '').trim(),
        commands,
        reminderDate,
        lastRunAt,
        lastRunStatus,
        lastRunOutput: String(item?.lastRunOutput ?? item?.last_run_output ?? ''),
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
    this.encryptedPayload = null
    this.decryptState = 'plain'
    this.data = {
      app: 'AstraShell',
      schema_version: 1,
      file_id: uuidv4(),
      revision: 0,
      storage_version: 2,
      hosts: [],
      host_meta: { extra_categories: [], updated_at: 0 },
      db_connections: [],
      snippets: [],
      snippet_meta: { extra_categories: [], updated_at: 0 },
      vault_meta: null,
      vault_keys: [],
      quick_tools: [],
      notes: '',
    }
    this.load()
  }

  setEncryptionKey(key) {
    this.encryptedPayload = null
    this.decryptState = 'plain'
  }

  clearDecryptedData() {
    this.data.hosts = []
    this.data.host_meta = { extra_categories: [], updated_at: 0 }
    this.data.db_connections = []
    this.data.snippets = []
    this.data.snippet_meta = { extra_categories: [], updated_at: 0 }
    this.data.vault_keys = []
    this.data.quick_tools = []
    this.data.notes = ''
  }

  getFileSignature() {
    return getFileSignatureByPath(this.filePath)
  }

  shouldEncryptOnSave() {
    return false
  }

  applyDecryptedPayload() {
    this.encryptedPayload = null
    this.decryptState = 'plain'
    return false
  }

  load() {
    if (!fs.existsSync(this.filePath)) {
      this.lastFileSignature = ''
      this.encryptedPayload = null
      this.decryptState = 'plain'
      return
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8')
      const parsed = JSON.parse(raw)
      this.data = { ...this.data, ...parsed }
      this.data.host_meta = normalizeHostMeta(this.data.host_meta)
      this.data.db_connections = Array.isArray(this.data.db_connections) ? this.data.db_connections : []
      this.data.snippet_meta = mergeSnippetMeta(null, this.data.snippet_meta)
      this.data.file_id = String(this.data.file_id || uuidv4())
      this.data.revision = Number(this.data.revision || 0)
      this.data.vault_meta = null
      delete this.data.encrypted_payload
      delete this.data.sync_meta
      this.encryptedPayload = null
      this.decryptState = 'plain'
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

    // 低频共享文件模式：保存前做版本冲突检测，避免旧视图覆盖新数据
    const diskParsed = readJsonFile(this.filePath)
    const diskRevision = Number(diskParsed?.revision || 0)
    const memoryRevision = Number(this.data?.revision || 0)
    if (diskParsed && diskRevision > memoryRevision) {
      const err = new Error(`共享文件已被其他设备更新，请先刷新后再保存（disk=${diskRevision}, local=${memoryRevision}）`)
      err.code = 'DATA_CONFLICT'
      throw err
    }

    // 保存前合并（仅低冲突字段）
    let mergedData = { ...this.data }
    try {
      if (diskParsed && typeof diskParsed === 'object') {
        let diskData = {
          app: String(diskParsed.app || 'AstraShell'),
          schema_version: Number(diskParsed.schema_version || 1),
          file_id: String(diskParsed.file_id || this.data.file_id || uuidv4()),
          revision: Number(diskParsed.revision || 0),
          hosts: Array.isArray(diskParsed.hosts) ? diskParsed.hosts : [],
          host_meta: normalizeHostMeta(diskParsed.host_meta),
          db_connections: Array.isArray(diskParsed.db_connections) ? diskParsed.db_connections : [],
          snippets: Array.isArray(diskParsed.snippets) ? diskParsed.snippets : [],
          snippet_meta: diskParsed.snippet_meta && typeof diskParsed.snippet_meta === 'object'
            ? diskParsed.snippet_meta
            : { extra_categories: [], updated_at: 0 },
          vault_meta: diskParsed.vault_meta || null,
          vault_keys: Array.isArray(diskParsed.vault_keys) ? diskParsed.vault_keys : [],
          quick_tools: Array.isArray(diskParsed.quick_tools) ? diskParsed.quick_tools : [],
          notes: String(diskParsed.notes || ''),
          storage_version: Number(diskParsed.storage_version || 2),
        }

        mergedData = mergeDbData(diskData, mergedData)
        mergedData.file_id = String(this.data.file_id || diskData.file_id || uuidv4())
      }
    } catch {}

    this.data = { ...this.data, ...mergedData }

    const persist = { ...this.data }
    persist.app = 'AstraShell'
    persist.schema_version = 1
    persist.file_id = String(this.data.file_id || uuidv4())
    persist.revision = Number(this.data.revision || 0) + 1
    this.data.revision = persist.revision
    persist.storage_version = 2
    persist.updated_at = Date.now()
    persist.vault_meta = null
    delete persist.sync_meta
    delete persist.encrypted_payload
    this.encryptedPayload = null
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(persist, null, 2), 'utf8')
      fs.renameSync(tmpPath, this.filePath)
      this.lastFileSignature = this.getFileSignature()

      // 自动备份：每次成功写入共享数据后留存最近 20 份
      try {
        const backupDir = path.join(app.getPath('userData'), 'backups')
        fs.mkdirSync(backupDir, { recursive: true })
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
        const backupPath = path.join(backupDir, `autosave.r${persist.revision}.${stamp}.bak.json`)
        fs.copyFileSync(this.filePath, backupPath)
        const old = fs.readdirSync(backupDir)
          .filter((n) => /^autosave\..*\.bak\.json$/i.test(n))
          .map((name) => ({ name, path: path.join(backupDir, name), mtimeMs: Number(fs.statSync(path.join(backupDir, name)).mtimeMs || 0) }))
          .sort((a, b) => b.mtimeMs - a.mtimeMs)
        for (const item of old.slice(20)) {
          try { fs.unlinkSync(item.path) } catch {}
        }
      } catch {}
      scheduleAutoSyncPush('local-save')
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

function getDbConnectionUpdatedAt(row) {
  return Number(row?.updated_at || row?.updatedAt || row?.created_at || row?.createdAt || 0)
}

function getAuditUpdatedAt(row) {
  return Number(row?.ts || row?.updatedAt || row?.updated_at || 0)
}

function getQuickToolUpdatedAt(row) {
  return Number(row?.updatedAt || row?.updated_at || row?.createdAt || row?.created_at || 0)
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
  const base = normalizeHostMeta(baseMeta)
  const incoming = normalizeHostMeta(incomingMeta)
  const mergedCategories = [...new Set([
    ...base.extra_categories,
    ...incoming.extra_categories,
  ].map((v) => String(v || '').trim()).filter(Boolean))]
  return {
    extra_categories: mergedCategories,
    updated_at: Math.max(base.updated_at, incoming.updated_at),
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
    app: 'AstraShell',
    schema_version: 1,
    file_id: String(incomingData?.file_id || baseData?.file_id || uuidv4()),
    revision: Math.max(Number(baseData?.revision || 0), Number(incomingData?.revision || 0)),
    storage_version: Math.max(Number(baseData?.storage_version || 1), Number(incomingData?.storage_version || 1), 2),
    hosts: mergeRowsById(baseData?.hosts, incomingData?.hosts, getHostUpdatedAt),
    host_meta: mergeSnippetMeta(baseData?.host_meta, incomingData?.host_meta),
    db_connections: mergeRowsById(baseData?.db_connections, incomingData?.db_connections, getDbConnectionUpdatedAt),
    snippets: mergeRowsById(baseData?.snippets, incomingData?.snippets, getSnippetUpdatedAt),
    snippet_meta: mergeSnippetMeta(baseData?.snippet_meta, incomingData?.snippet_meta),
    vault_meta: null,
    vault_keys: mergeRowsById(baseData?.vault_keys, incomingData?.vault_keys, getVaultKeyUpdatedAt),
    quick_tools: mergeRowsById(baseData?.quick_tools, incomingData?.quick_tools, getQuickToolUpdatedAt),
    notes: String(incomingData?.notes || baseData?.notes || ''),
    logs: [],
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

function buildSyncSnapshotContent(plainContent, password) {
  const raw = String(plainContent || '')
  if (!password) return raw
  const parsed = JSON.parse(raw)
  const summary = {
    hosts: Array.isArray(parsed?.hosts) ? parsed.hosts.length : 0,
    dbConnections: Array.isArray(parsed?.db_connections) ? parsed.db_connections.length : 0,
    snippets: Array.isArray(parsed?.snippets) ? parsed.snippets.length : 0,
    vaultKeys: Array.isArray(parsed?.vault_keys) ? parsed.vault_keys.length : 0,
    quickTools: Array.isArray(parsed?.quick_tools) ? parsed.quick_tools.length : 0,
  }
  const salt = crypto.randomBytes(16)
  const key = deriveKey(password, salt)
  const encryptedPayload = encryptText(raw, key)
  const verifierHash = crypto.createHash('sha256').update(key).digest('base64')
  return JSON.stringify({
    app: String(parsed?.app || 'AstraShell'),
    schema_version: Number(parsed?.schema_version || 1),
    storage_version: Number(parsed?.storage_version || 2),
    file_id: String(parsed?.file_id || uuidv4()),
    revision: Number(parsed?.revision || 0),
    updated_at: Number(parsed?.updated_at || Date.now()),
    sync_meta: {
      encrypted: true,
      salt: salt.toString('base64'),
      verifier_hash: verifierHash,
      summary: {
        ...summary,
        itemCount: summary.hosts + summary.dbConnections + summary.snippets + summary.vaultKeys + summary.quickTools,
      },
    },
    encrypted_payload: encryptedPayload,
  }, null, 2)
}

function extractSyncSnapshotContent(rawContent, password) {
  const raw = String(rawContent || '')
  const parsed = JSON.parse(raw)
  if (!parsed?.encrypted_payload || typeof parsed.encrypted_payload !== 'object') return raw
  const meta = parsed?.sync_meta && typeof parsed.sync_meta === 'object'
    ? parsed.sync_meta
    : parsed?.vault_meta && typeof parsed.vault_meta === 'object'
      ? parsed.vault_meta
      : null
  if (!meta?.salt || !meta?.verifier_hash) throw new Error('远端数据库文件已加密，但缺少加密元数据')
  if (!password) throw new Error('远端数据库文件已加密，请先输入数据库密码')
  const key = deriveKey(password, Buffer.from(String(meta.salt), 'base64'))
  const verifierHash = crypto.createHash('sha256').update(key).digest('base64')
  if (verifierHash !== String(meta.verifier_hash || '')) {
    throw new Error('数据库密码错误，无法解锁远端数据库文件')
  }
  return decryptText(parsed.encrypted_payload, key)
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
  return new JsonDB(filePath)
}

function reconcileVaultStateWithDb(currentDb) {
  return { requiresUnlock: false, decryptFailed: false }
}

function requireDbReady({ allowCreate = false } = {}) {
  const dbPath = resolveDbPath()
  if (!dbPath) throw new Error('请先选择数据文件')
  if (!allowCreate && !storageFileExists(dbPath)) {
    throw new Error('数据文件不存在，请重新选择或先初始化')
  }
  activeDbPath = dbPath
  if (!db || db.filePath !== dbPath) db = openDbAtPath(dbPath, { migrateLegacy: true })
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
    reconcileVaultStateWithDb(db)
    if (!fs.existsSync(dbPath) && !db.encryptedPayload) {
      db.save()
    }
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
      category TEXT DEFAULT '默认',
      auth_type TEXT DEFAULT 'password',
      password TEXT,
      private_key_ref TEXT,
      purchase_date TEXT,
      expiry_date TEXT,
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

  ensureHostsTableColumns(db)
}

function ensureHostsTableColumns(currentDb) {
  if (!currentDb) return
  try {
    const columns = currentDb.prepare('PRAGMA table_info(hosts)').all()
    const names = new Set(columns.map((item) => String(item?.name || '').toLowerCase()))
    if (!names.has('category')) currentDb.exec(`ALTER TABLE hosts ADD COLUMN category TEXT DEFAULT '默认'`)
    if (!names.has('purchase_date')) currentDb.exec(`ALTER TABLE hosts ADD COLUMN purchase_date TEXT`)
    if (!names.has('expiry_date')) currentDb.exec(`ALTER TABLE hosts ADD COLUMN expiry_date TEXT`)
  } catch (e) {
    logMain(`ensureHostsTableColumns failed error=${e?.message || e}`)
  }
}

function mapHostRowForRenderer(row) {
  if (!row || typeof row !== 'object') return row
  return {
    ...row,
    category: String(row.category || '默认'),
    purchaseDate: String(row.purchaseDate || row.purchase_date || ''),
    expiryDate: String(row.expiryDate || row.expiry_date || ''),
  }
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
    reconcileVaultStateWithDb(currentDb)
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
    encrypted: false,
    decryptState: 'plain',
    unlockRequired: false,
    storageVersion: Number(currentDb?.data?.storage_version || 1),
    fileId: String(currentDb?.data?.file_id || ''),
    revision: Number(currentDb?.data?.revision || 0),
    signature: String(currentDb?.lastFileSignature || ''),
    hosts: Array.isArray(currentDb?.data?.hosts) ? currentDb.data.hosts.length : 0,
    dbConnections: Array.isArray(currentDb?.data?.db_connections) ? currentDb.data.db_connections.length : 0,
    snippets: Array.isArray(currentDb?.data?.snippets) ? currentDb.data.snippets.length : 0,
    vaultKeys: Array.isArray(currentDb?.data?.vault_keys) ? currentDb.data.vault_keys.length : 0,
    quickTools: Array.isArray(currentDb?.data?.quick_tools) ? currentDb.data.quick_tools.length : 0,
    itemCount:
      (Array.isArray(currentDb?.data?.hosts) ? currentDb.data.hosts.length : 0)
      + (Array.isArray(currentDb?.data?.db_connections) ? currentDb.data.db_connections.length : 0)
      + (Array.isArray(currentDb?.data?.snippets) ? currentDb.data.snippets.length : 0)
      + (Array.isArray(currentDb?.data?.vault_keys) ? currentDb.data.vault_keys.length : 0)
      + (Array.isArray(currentDb?.data?.quick_tools) ? currentDb.data.quick_tools.length : 0),
    logs: Array.isArray(localAuditLogs) ? localAuditLogs.length : 0,
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

function writeFolderSyncSmokeReport(report) {
  const reportPath = String(process.env.ASTRASHELL_SMOKE_REPORT_PATH || '').trim()
  if (!reportPath) return
  try {
    ensureParentDir(reportPath)
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
  } catch {}
}

function removeSmokeFile(filePath) {
  if (!filePath) return
  try {
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true })
  } catch {}
}

function prepareFolderSyncSmokeMode() {
  const localPath = normalizeStoragePath(process.env.ASTRASHELL_DATA_PATH || process.env.LIGHTTERM_DB_PATH)
  const remotePath = normalizeStoragePath(process.env.ASTRASHELL_SMOKE_REMOTE_PATH || '')
  if (!localPath) throw new Error('folder smoke 缺少本地数据文件路径（ASTRASHELL_DATA_PATH）')
  if (!remotePath) throw new Error('folder smoke 缺少同步目标路径（ASTRASHELL_SMOKE_REMOTE_PATH）')

  removeSmokeFile(localPath)
  removeSmokeFile(remotePath)
  removeSmokeFile(getSettingsPath())
  removeSmokeFile(getSyncStatePath())
  removeSmokeFile(localAuditLogPath())

  writeSettings({
    sync: {
      enabled: true,
      provider: 'folder',
      targetPath: remotePath,
      baseUrl: '',
      token: '',
      autoPullOnStartup: false,
      autoPushOnChange: true,
      debounceMs: 400,
    },
  })
}

async function waitForCondition(checker, { timeoutMs = 6000, intervalMs = 120, description = '等待条件完成' } = {}) {
  const startedAt = Date.now()
  while (Date.now() - startedAt <= timeoutMs) {
    try {
      if (await checker()) return
    } catch {}
    await wait(intervalMs)
  }
  throw new Error(`${description}超时（${timeoutMs}ms）`)
}

async function runFolderSyncSmokeTest() {
  const localPath = normalizeStoragePath(resolveDbPath() || activeDbPath)
  const remotePath = normalizeStoragePath(getSyncConfig().targetPath || process.env.ASTRASHELL_SMOKE_REMOTE_PATH || '')
  const startedAt = Date.now()
  const steps = []
  const finish = (ok, extra = {}) => {
    const report = {
      mode: 'folder-sync',
      ok,
      startedAt,
      finishedAt: Date.now(),
      userDataPath: app.getPath('userData'),
      localPath,
      remotePath,
      steps,
      ...extra,
    }
    writeFolderSyncSmokeReport(report)
    const output = JSON.stringify({
      ok: report.ok,
      localPath: report.localPath,
      remotePath: report.remotePath,
      steps: report.steps,
      error: report.error || '',
      revisions: report.revisions || {},
      finalStatus: report.finalStatus || {},
    })
    console.log(`[folder-sync-smoke] ${output}`)
    return report
  }

  try {
    if (!localPath) throw new Error('未解析到本地数据文件路径')
    if (!remotePath) throw new Error('未解析到同步目标路径')

    const currentDb = requireDbReady({ allowCreate: true })
    const seedItem = {
      id: `smoke-seed-${Date.now().toString(36)}`,
      category: 'smoke',
      label: 'folder-seed',
      cmd: 'echo seed',
      updatedAt: Date.now(),
    }
    currentDb.data.quick_tools = [seedItem]
    currentDb.save()
    const localAfterSeed = readJsonFile(localPath)
    if (!localAfterSeed) throw new Error('本地初始化写入失败')
    steps.push({
      name: 'seed-local',
      ok: true,
      revision: Number(localAfterSeed.revision || 0),
      quickTools: Array.isArray(localAfterSeed.quick_tools) ? localAfterSeed.quick_tools.length : 0,
    })

    const connectRes = await testSyncConnection()
    if (!connectRes?.ok) throw new Error(connectRes?.error || 'folder 连接测试失败')
    steps.push({
      name: 'test-connection',
      ok: true,
      targetPath: connectRes.targetPath,
      remoteExists: !!connectRes?.remote?.exists,
    })

    const pushRes = await performSyncPush({ manual: true, reason: 'smoke-manual-push' })
    if (!pushRes?.ok) throw new Error(pushRes?.error || '首次上传失败')
    const remoteAfterPush = readJsonFile(remotePath)
    if (!remoteAfterPush) throw new Error('首次上传后远端文件不存在')
    if (Number(remoteAfterPush.revision || 0) !== Number(localAfterSeed.revision || 0)) {
      throw new Error(`首次上传 revision 不一致（local=${localAfterSeed.revision || 0}, remote=${remoteAfterPush.revision || 0}）`)
    }
    steps.push({
      name: 'manual-push',
      ok: true,
      revision: Number(remoteAfterPush.revision || 0),
      quickTools: Array.isArray(remoteAfterPush.quick_tools) ? remoteAfterPush.quick_tools.length : 0,
    })

    const autoPushItem = {
      id: `smoke-auto-${Date.now().toString(36)}`,
      category: 'smoke',
      label: 'folder-auto',
      cmd: 'echo auto',
      updatedAt: Date.now(),
    }
    currentDb.data.quick_tools = [...(Array.isArray(currentDb.data.quick_tools) ? currentDb.data.quick_tools : []), autoPushItem]
    currentDb.save()
    const localAfterAutoSave = readJsonFile(localPath)
    if (!localAfterAutoSave) throw new Error('自动上传前本地写入失败')
    await waitForCondition(() => {
      const remote = readJsonFile(remotePath)
      return (
        Number(remote?.revision || 0) >= Number(localAfterAutoSave.revision || 0)
        && Array.isArray(remote?.quick_tools)
        && remote.quick_tools.some((item) => item?.id === autoPushItem.id)
      )
    }, { timeoutMs: 8000, description: '等待 folder 自动上传完成' })
    const remoteAfterAutoPush = readJsonFile(remotePath)
    steps.push({
      name: 'auto-push',
      ok: true,
      revision: Number(remoteAfterAutoPush?.revision || 0),
      quickTools: Array.isArray(remoteAfterAutoPush?.quick_tools) ? remoteAfterAutoPush.quick_tools.length : 0,
    })

    const remotePullItem = {
      id: `smoke-pull-${Date.now().toString(36)}`,
      category: 'smoke',
      label: 'folder-pull',
      cmd: 'echo pull',
      updatedAt: Date.now(),
    }
    const remoteEdited = {
      ...remoteAfterAutoPush,
      revision: Number(remoteAfterAutoPush?.revision || 0) + 3,
      updated_at: Date.now(),
      quick_tools: [...(Array.isArray(remoteAfterAutoPush?.quick_tools) ? remoteAfterAutoPush.quick_tools : []), remotePullItem],
    }
    writeTextAtomic(remotePath, JSON.stringify(remoteEdited, null, 2))
    steps.push({
      name: 'remote-edit',
      ok: true,
      revision: Number(remoteEdited.revision || 0),
      quickTools: Array.isArray(remoteEdited.quick_tools) ? remoteEdited.quick_tools.length : 0,
    })

    const pullRes = await performSyncPull({ reason: 'smoke-manual-pull' })
    if (!pullRes?.ok) throw new Error(pullRes?.error || '手动下载失败')
    const localAfterPull = readJsonFile(localPath)
    if (!localAfterPull) throw new Error('下载后本地文件不存在')
    if (Number(localAfterPull.revision || 0) !== Number(remoteEdited.revision || 0)) {
      throw new Error(`下载后 revision 不一致（local=${localAfterPull.revision || 0}, remote=${remoteEdited.revision || 0}）`)
    }
    if (!Array.isArray(localAfterPull.quick_tools) || !localAfterPull.quick_tools.some((item) => item?.id === remotePullItem.id)) {
      throw new Error('下载后未拿到远端新增 quick tool')
    }
    steps.push({
      name: 'manual-pull',
      ok: true,
      revision: Number(localAfterPull.revision || 0),
      quickTools: Array.isArray(localAfterPull.quick_tools) ? localAfterPull.quick_tools.length : 0,
    })

    const status = broadcastSyncStatus()
    return finish(true, {
      revisions: {
        localAfterSeed: Number(localAfterSeed.revision || 0),
        remoteAfterPush: Number(remoteAfterPush.revision || 0),
        localAfterAutoSave: Number(localAfterAutoSave.revision || 0),
        remoteAfterAutoPush: Number(remoteAfterAutoPush?.revision || 0),
        remoteEdited: Number(remoteEdited.revision || 0),
        localAfterPull: Number(localAfterPull.revision || 0),
      },
      finalStatus: {
        queueCount: Number(status?.queueCount || 0),
        lastDirection: String(status?.state?.lastDirection || ''),
        lastError: String(status?.state?.lastError || ''),
        lastSuccessMessage: String(status?.state?.lastSuccessMessage || ''),
      },
    })
  } catch (e) {
    steps.push({
      name: 'failed',
      ok: false,
      error: e?.message || 'folder smoke 执行失败',
    })
    return finish(false, {
      error: e?.message || 'folder smoke 执行失败',
      stack: e?.stack || '',
    })
  } finally {
    cancelAutoSyncPushTimer()
  }
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
    if (session?.mode === 'pty') {
      try {
        session?.proc?.kill?.()
      } catch (e) {
        logMain(`ssh cleanup pty kill failed reason=${reason} session=${sessionId} error=${e?.message || e}`)
      }
    } else {
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

app.whenReady().then(async () => {
  try {
    if (isFolderSyncSmokeMode) prepareFolderSyncSmokeMode()
    if (!isFolderSyncSmokeMode) buildAppMenu()
    loadLocalAuditLogs()
    initDb()
    logMain('initDb ok')
    if (isFolderSyncSmokeMode) {
      const report = await runFolderSyncSmokeTest()
      app.exit(report.ok ? 0 : 1)
      return
    }
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
    if (isFolderSyncSmokeMode) {
      writeFolderSyncSmokeReport({
        mode: 'folder-sync',
        ok: false,
        startedAt: Date.now(),
        finishedAt: Date.now(),
        userDataPath: app.getPath('userData'),
        error: String(e?.message || e || 'folder smoke 启动失败'),
        stack: e?.stack || '',
        steps: [],
      })
      console.error(`[folder-sync-smoke] ${e?.stack || e?.message || e}`)
      app.exit(1)
      return
    }
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

ipcMain.handle('app:refresh-storage-data', async () => {
  const changed = refreshDbFromDisk('app:refresh-storage-data', true)
  if (changed) broadcast('storage:data-changed', { changedAt: Date.now(), manual: true })
  return { ok: true, changed, ...getStorageMeta() }
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

ipcMain.handle('app:create-backup', async () => {
  try {
    const dbPath = resolveDbPath() || activeDbPath
    if (!dbPath || !fs.existsSync(dbPath)) return { ok: false, error: '共享数据文件不存在，无法备份' }
    const backupDir = path.join(app.getPath('userData'), 'backups')
    fs.mkdirSync(backupDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
    const sharedBackup = path.join(backupDir, `astrashell.data.${stamp}.bak.json`)
    fs.copyFileSync(dbPath, sharedBackup)

    const localAudit = localAuditLogPath()
    let localAuditBackup = ''
    if (fs.existsSync(localAudit)) {
      localAuditBackup = path.join(backupDir, `audit.local.${stamp}.bak.json`)
      fs.copyFileSync(localAudit, localAuditBackup)
    }

    const backups = fs.readdirSync(backupDir)
      .filter((n) => /\.bak\.json$/i.test(n))
      .map((name) => ({ name, path: path.join(backupDir, name), mtimeMs: Number(fs.statSync(path.join(backupDir, name)).mtimeMs || 0) }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)

    return { ok: true, backupPath: sharedBackup, auditBackupPath: localAuditBackup, count: backups.length }
  } catch (e) {
    return { ok: false, error: e?.message || '创建备份失败' }
  }
})

ipcMain.handle('app:list-backups', async () => {
  try {
    const backupDir = path.join(app.getPath('userData'), 'backups')
    if (!fs.existsSync(backupDir)) return { ok: true, items: [] }
    const items = fs.readdirSync(backupDir)
      .filter((n) => /\.bak\.json$/i.test(n))
      .map((name) => {
        const full = path.join(backupDir, name)
        const st = fs.statSync(full)
        return { name, path: full, size: Number(st.size || 0), mtimeMs: Number(st.mtimeMs || 0) }
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
    return { ok: true, items }
  } catch (e) {
    return { ok: false, error: e?.message || '读取备份列表失败' }
  }
})

ipcMain.handle('app:restore-backup', async (_event, payload) => {
  try {
    const backupPath = String(payload?.backupPath || '').trim()
    if (!backupPath || !fs.existsSync(backupPath)) return { ok: false, error: '备份文件不存在' }
    const dbPath = resolveDbPath() || activeDbPath
    if (!dbPath) return { ok: false, error: '未配置共享数据文件路径' }

    const dir = path.dirname(dbPath)
    fs.mkdirSync(dir, { recursive: true })
    const tmp = path.join(dir, `.${path.basename(dbPath)}.restore.${process.pid}.${Date.now()}.tmp`)
    fs.copyFileSync(backupPath, tmp)
    fs.renameSync(tmp, dbPath)

    db = null
    initDb()
    refreshDbFromDisk('restore-backup', true)
    broadcast('storage:data-changed', { changedAt: Date.now(), restored: true })
    return { ok: true, dbPath, restartRequired: false }
  } catch (e) {
    return { ok: false, error: e?.message || '恢复备份失败' }
  }
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

ipcMain.handle('app:open-backups-folder', async () => {
  try {
    const backupDir = path.join(app.getPath('userData'), 'backups')
    fs.mkdirSync(backupDir, { recursive: true })
    const err = await shell.openPath(backupDir)
    if (err) return { ok: false, error: String(err || '打开备份目录失败') }
    return { ok: true, path: backupDir }
  } catch (e) {
    return { ok: false, error: e?.message || '打开备份目录失败' }
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
    localAuditLogs = []
    saveLocalAuditLogs()
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
    const items = currentDb.prepare('SELECT * FROM hosts ORDER BY updated_at DESC').all().map(mapHostRowForRenderer)
    const extraCategories = normalizeHostMeta(currentDb.data.host_meta).extra_categories
    return { ok: true, items, extraCategories }
  } catch (e) {
    return { ok: false, error: e?.message || '数据文件不可用', items: [], extraCategories: [] }
  }
})

ipcMain.handle('hosts:save', async (_event, payload) => {
  try {
    refreshDbFromDisk('hosts:save', true)
    const currentDb = requireDbReady()
    const now = Date.now()
    const id = payload.id || uuidv4()
    const purchaseDate = String(payload.purchaseDate || payload.purchase_date || '').trim()
    const expiryDate = String(payload.expiryDate || payload.expiry_date || '').trim()
    currentDb.prepare(`
    INSERT INTO hosts (id, name, host, port, username, category, auth_type, password, private_key_ref, purchase_date, expiry_date, tags, created_at, updated_at)
    VALUES (@id, @name, @host, @port, @username, @category, @auth_type, @password, @private_key_ref, @purchase_date, @expiry_date, @tags, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,host=excluded.host,port=excluded.port,username=excluded.username,
      category=excluded.category,auth_type=excluded.auth_type,password=excluded.password,private_key_ref=excluded.private_key_ref,
      purchase_date=excluded.purchase_date,expiry_date=excluded.expiry_date,
      tags=excluded.tags,updated_at=excluded.updated_at
    `).run({
      id,
      name: payload.name || payload.host,
      host: payload.host,
      port: Number(payload.port || 22),
      username: payload.username,
      category: payload.category || '默认',
      auth_type: payload.authType || 'password',
      password: payload.password || null,
      private_key_ref: payload.privateKeyRef || null,
      purchase_date: purchaseDate || null,
      expiry_date: expiryDate || null,
      purchaseDate: purchaseDate || '',
      expiryDate: expiryDate || '',
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

ipcMain.handle('hosts:set-categories', async (_event, payload) => {
  try {
    refreshDbFromDisk('hosts:set-categories', true)
    const currentDb = requireDbReady()
    currentDb.data.host_meta = {
      extra_categories: parseExtraCategories(payload?.extraCategories ?? payload?.extra_categories ?? []),
      updated_at: Date.now(),
    }
    currentDb.save()
    return { ok: true, extraCategories: currentDb.data.host_meta.extra_categories }
  } catch (e) {
    return { ok: false, error: e?.message || '保存主机分类失败', extraCategories: [] }
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

ipcMain.handle('quicktools:get-state', async () => {
  try {
    refreshDbFromDisk('quicktools:get-state', true)
    const currentDb = requireDbReady()
    const items = Array.isArray(currentDb.data.quick_tools) ? currentDb.data.quick_tools : []
    return { ok: true, items }
  } catch (e) {
    return { ok: false, error: e?.message || '读取快捷工具失败', items: [] }
  }
})

ipcMain.handle('quicktools:set-state', async (_event, payload) => {
  try {
    refreshDbFromDisk('quicktools:set-state', true)
    const currentDb = requireDbReady()
    const items = Array.isArray(payload?.items)
      ? payload.items
        .map((row) => ({
          id: String(row?.id || uuidv4()),
          category: String(row?.category || '未分类'),
          label: String(row?.label || '').trim(),
          cmd: String(row?.cmd || '').trim(),
          updatedAt: Number(row?.updatedAt || Date.now()),
        }))
        .filter((row) => row.label && row.cmd)
      : []
    currentDb.data.quick_tools = items
    currentDb.save()
    return { ok: true, items }
  } catch (e) {
    return { ok: false, error: e?.message || '保存快捷工具失败', items: [] }
  }
})

ipcMain.handle('vault:status', async () => {
  const dbPath = resolveDbPath()
  if (!dbPath) return { ok: true, configured: false, exists: false, initialized: true, unlocked: true, requiresPassword: false }
  if (!storageFileExists(dbPath)) return { ok: true, configured: true, exists: false, initialized: true, unlocked: true, requiresPassword: false }
  try {
    refreshDbFromDisk('vault:status', true)
    const state = {
      ok: true,
      configured: true,
      exists: true,
      initialized: true,
      unlocked: true,
      requiresPassword: false,
      decryptFailed: false,
    }
    logMain(`vault:status initialized=${state.initialized} unlocked=${state.unlocked}`)
    return state
  } catch (e) {
    const error = e?.message || '数据文件无法读取'
    logMain(`vault:status error=${error}`)
    return { ok: true, configured: true, exists: true, initialized: false, unlocked: false, error }
  }
})

ipcMain.handle('vault:set-master', async () => {
  return { ok: true, message: '当前版本本地数据库固定为明文模式，无需设置主密码' }
})

ipcMain.handle('vault:unlock', async () => {
  return { ok: true, message: '当前版本本地数据库固定为明文模式，无需解锁' }
})

ipcMain.handle('vault:reset', async () => {
  try {
    refreshDbFromDisk('vault:reset', true)
    const currentDb = requireDbReady()
    currentDb.data.vault_meta = null
    currentDb.data.vault_keys = []
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

    let fp = payload.fingerprint || null
    try {
      fp = keyObj?.toPublic().fingerprint('sha256').toString() || null
    } catch {}

    const row = {
      id,
      name: payload.name || '未命名密钥',
      type: resolvedType,
      fingerprint: fp,
      created_at: Date.now(),
      updated_at: Date.now(),
    }
    const idx = currentDb.data.vault_keys.findIndex((item) => item.id === id)
    const next = {
      ...currentDb.data.vault_keys[idx],
      ...row,
      encrypted_blob: null,
      privateKey: privateKeyText,
      publicKey: publicKeyText,
      certificate: certificateText,
    }
    if (idx >= 0) currentDb.data.vault_keys[idx] = next
    else currentDb.data.vault_keys.push(next)
    currentDb.save()
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
    const row = currentDb.prepare('SELECT * FROM vault_keys WHERE id = ?').get(payload.id)
    if (!row) return { ok: false, error: '密钥不存在' }
    return {
      ok: true,
      item: {
        id: row.id,
        name: row.name,
        type: row.type,
        privateKey: String(row.privateKey || ''),
        publicKey: String(row.publicKey || ''),
        certificate: String(row.certificate || ''),
      },
    }
  } catch (e) {
    return { ok: false, error: e?.message || '读取密钥失败' }
  }
})

ipcMain.handle('vault:key-delete', async (_event, payload) => {
  try {
    refreshDbFromDisk('vault:key-delete', true)
    const currentDb = requireDbReady()
    const targetId = String(payload?.id || '').trim()
    if (!targetId) return { ok: false, error: '密钥 ID 不能为空' }
    const result = currentDb.prepare('DELETE FROM vault_keys WHERE id = ?').run(targetId)
    if (!result?.changes) return { ok: false, error: '密钥不存在' }
    currentDb.save()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || '删除密钥失败' }
  }
})

ipcMain.handle('sync:login', async () => ({ ok: true }))
ipcMain.handle('sync:get-config', async () => ({ ok: true, config: getSyncConfig() }))
ipcMain.handle('sync:set-config', async (_event, payload) => {
  const parsed = safeParse(syncSetConfigSchema, payload)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const nextConfig = {
    ...parsed.data,
    provider: parsed.data.provider === 'http' ? 'http' : 'folder',
    targetPath: normalizeStoragePath(parsed.data.targetPath),
    baseUrl: String(parsed.data.baseUrl || '').trim().replace(/\/+$/, ''),
    token: String(parsed.data.token || '').trim(),
    password: String(parsed.data.password || ''),
  }
  if (nextConfig.enabled && !nextConfig.password) {
    return { ok: false, error: '请先设置同步数据库密码' }
  }
  const localPath = normalizeStoragePath(resolveDbPath() || activeDbPath)
  if (
    nextConfig.provider === 'folder'
    && localPath
    && nextConfig.targetPath
    && normalizeSyncPathForCompare(localPath) === normalizeSyncPathForCompare(nextConfig.targetPath)
  ) {
    return { ok: false, error: '同步目标不能与本地数据文件相同' }
  }
  const settings = readSettings()
  settings.sync = nextConfig
  writeSettings(settings)
  updateSyncState((state) => {
    state.remoteMeta = null
    state.lastRemoteRevision = 0
    state.lastError = ''
    state.lastSuccessMessage = ''
    state.queue = []
  })
  if (!nextConfig.enabled) cancelAutoSyncPushTimer()
  broadcastSyncStatus()
  return { ok: true, config: getSyncConfig() }
})
ipcMain.handle('sync:status', async () => broadcastSyncStatus())
ipcMain.handle('sync:test-connection', async () => testSyncConnection())
ipcMain.handle('sync:pull-now', async () => {
  const result = performSyncPull({ reason: 'manual-pull' })
  broadcastSyncStatus()
  return result
})
ipcMain.handle('sync:queue', async () => ({ ok: true, items: readSyncState().queue || [] }))
ipcMain.handle('sync:clear-queue', async () => {
  cancelAutoSyncPushTimer()
  replaceSyncQueue([])
  updateSyncState((state) => {
    state.lastError = ''
  })
  broadcastSyncStatus()
  return { ok: true }
})
ipcMain.handle('sync:push-now', async () => {
  cancelAutoSyncPushTimer()
  const result = performSyncPush({ manual: true, reason: 'manual-push' })
  broadcastSyncStatus()
  return result
})
ipcMain.handle('sync:retry-failed', async () => {
  cancelAutoSyncPushTimer()
  const queue = readSyncState().queue || []
  const hasPushTask = queue.some((item) => item.type === 'push')
  if (!hasPushTask) return { ok: true, pushed: 0, message: '当前没有待重试的同步任务' }
  const result = performSyncPush({ manual: true, reason: 'retry-failed' })
  broadcastSyncStatus()
  return result
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
  getNodePtySpawn,
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

registerDatabaseIpc(ipcMain, {
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
})
