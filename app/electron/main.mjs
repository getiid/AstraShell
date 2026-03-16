import { app, BrowserWindow, ipcMain, dialog, Menu, clipboard, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { v4 as uuidv4 } from 'uuid'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDev = !app.isPackaged
try {
  const p = path.join(app.getPath('userData'), 'bootstrap.log')
  fs.appendFileSync(p, `[${new Date().toISOString()}] main loaded isDev=${isDev}\n`, 'utf8')
} catch {}
const serialPorts = new Map()
const sshSessions = new Map()
let db
let vaultKey = null
let SerialPortCtor = null
let SSHClientCtor = null
let sshpkModule = null
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
const macManualInstallTip = '当前构建未使用 Developer ID 签名，无法一键安装更新。请从 GitHub Release 下载 DMG 手动覆盖安装。'
const githubReleaseProvider = {
  provider: 'github',
  owner: 'getiid',
  repo: 'AstraShell',
  releaseType: 'release',
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
    }
    this.load()
  }

  setEncryptionKey(key) {
    this.encryptionKey = key || null
  }

  getFileSignature() {
    if (!fs.existsSync(this.filePath)) return ''
    try {
      const raw = fs.readFileSync(this.filePath)
      const hash = crypto.createHash('sha1').update(raw).digest('hex')
      return `${raw.length}:${hash}`
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
      }), this.encryptionKey)
      this.encryptedPayload = encryptedPayload
      persist.hosts = []
      persist.snippets = []
      persist.snippet_meta = { extra_categories: [], updated_at: 0 }
      persist.vault_keys = []
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
  }, 1800)
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

async function closeAllSshSessions(reason = 'app-exit') {
  const entries = [...sshSessions.entries()]
  if (!entries.length) return
  logMain(`ssh cleanup start reason=${reason} count=${entries.length}`)
  sshSessions.clear()
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
})

ipcMain.handle('app:get-storage', async () => {
  const dbPath = resolveDbPath() || activeDbPath || ''
  return { ok: true, configured: !!dbPath, dbPath }
})

ipcMain.handle('app:get-storage-meta', async () => {
  refreshDbFromDisk('app:get-storage-meta', true)
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
  if (!payload?.folder) return { ok: false, error: '缺少路径' }
  const nextDbPath = normalizeStoragePath(payload.folder)
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
      autoOpen: true,
    })
    serialPorts.set(key, port)
    port.on('data', (data) => broadcast('serial:data', { path: key, data: data.toString('utf8') }))
    port.on('error', (err) => broadcast('serial:error', { path: key, error: err.message }))
    return { ok: true }
  } catch (e) {
    const message = serialModuleLoadError || e?.message || '串口模块不可用'
    logMain(`serial:open failed: ${message}`)
    return { ok: false, error: message }
  }
})
ipcMain.handle('serial:send', async (_event, payload) => {
  const port = serialPorts.get(payload.path)
  if (!port) return { ok: false, error: '串口未打开' }
  const data = payload.isHex ? Buffer.from(payload.data.replace(/\s+/g, ''), 'hex') : payload.data
  await new Promise((resolve, reject) => port.write(data, (err) => (err ? reject(err) : resolve(true))))
  return { ok: true }
})

ipcMain.handle('ssh:test', async (_event, config) => {
  const conn = await createSSHClient()
  return await new Promise((resolve) => {
    attachKeyboardHandler(conn, config.password)
    conn.on('ready', () => { conn.end(); resolve({ ok: true }) }).on('error', (err) => resolve({ ok: false, error: err.message })).connect(connectConfigFromPayload(config))
  })
})

ipcMain.handle('ssh:connect', async (_event, payload) => {
  const sessionId = payload.sessionId
  if (!sessionId) return { ok: false, error: '缺少 sessionId' }
  const existing = sshSessions.get(sessionId)
  if (existing) {
    try { existing.stream.end('exit\n') } catch {}
    try { existing.conn.end() } catch {}
    sshSessions.delete(sessionId)
  }
  const conn = await createSSHClient()
  attachKeyboardHandler(conn, payload.password)
  return await new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    conn.on('ready', () => {
      conn.shell({ term: 'xterm-256color', cols: 120, rows: 30 }, (err, stream) => {
        if (err) return finish({ ok: false, error: err.message })
        sshSessions.set(sessionId, { conn, stream })
        stream.on('data', (chunk) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          broadcast('ssh:data', {
            sessionId,
            data: buffer.toString('utf8'),
            dataBase64: buffer.toString('base64'),
          })
        })
        stream.on('close', () => {
          broadcast('ssh:close', { sessionId })
          const active = sshSessions.get(sessionId)
          if (active?.conn === conn) {
            sshSessions.delete(sessionId)
          }
          conn.end()
        })
        finish({ ok: true })
      })
    }).on('error', (err) => { broadcast('ssh:error', { sessionId, error: err.message }); finish({ ok: false, error: err.message }) }).connect(connectConfigFromPayload(payload))
  })
})

ipcMain.handle('ssh:write', async (_event, payload) => {
  const session = sshSessions.get(payload.sessionId)
  if (!session) return { ok: false, error: 'SSH 会话不存在' }
  session.stream.write(payload.data)
  return { ok: true }
})
ipcMain.handle('ssh:resize', async (_event, payload) => {
  const session = sshSessions.get(payload.sessionId)
  if (!session) return { ok: false, error: 'SSH 会话不存在' }
  session.stream.setWindow(payload.rows || 30, payload.cols || 120, 0, 0)
  return { ok: true }
})
ipcMain.handle('ssh:disconnect', async (_event, payload) => {
  const session = sshSessions.get(payload.sessionId)
  if (!session) return { ok: true }
  session.stream.end('exit\n'); session.conn.end(); sshSessions.delete(payload.sessionId)
  return { ok: true }
})

const listWindowsDriveRoots = () => {
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

ipcMain.handle('localfs:list', async (_event, payload) => {
  const requestedPath = typeof payload?.localPath === 'string' ? payload.localPath.trim() : ''
  if (process.platform === 'win32' && !requestedPath) {
    return { ok: true, path: '', items: listWindowsDriveRoots() }
  }
  const localPath = requestedPath || os.homedir()
  try {
    const items = fs.readdirSync(localPath, { withFileTypes: true }).map((d) => {
      const fullPath = path.join(localPath, d.name)
      let stat = null
      try {
        stat = fs.statSync(fullPath)
      } catch {
        stat = null
      }
      return {
        name: d.name,
        isDir: d.isDirectory(),
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

ipcMain.handle('sftp:list', async (_event, payload) => withSftp(payload, async (sftp) => {
  const remotePath = payload.remotePath || '.'
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
}))

ipcMain.handle('sftp:download', async (_event, payload) => withSftp(payload, async (sftp) => {
  const win = BrowserWindow.getFocusedWindow()
  const save = await dialog.showSaveDialog(win, { title: '保存文件到本地', defaultPath: path.basename(payload.remoteFile || 'download.bin') })
  if (save.canceled || !save.filePath) return { ok: false, error: '已取消' }

  return await new Promise((resolve) => {
    sftp.fastGet(
      payload.remoteFile,
      save.filePath,
      {
        step: (totalTransferred, _chunk, total) => {
          const percent = total > 0 ? Math.min(100, Math.floor((totalTransferred / total) * 100)) : 0
          broadcast('sftp:progress', { type: 'download', percent, transferred: totalTransferred, total })
        },
      },
      (err) => {
        if (err) return resolve({ ok: false, error: err.message })
        broadcast('sftp:progress', { type: 'download', percent: 100, done: true })
        resolve({ ok: true, filePath: save.filePath })
      },
    )
  })
}))

ipcMain.handle('sftp:download-to-local', async (_event, payload) => withSftp(payload, async (sftp) => {
  const filename = payload.filename || path.basename(payload.remoteFile || 'download.bin')
  const localFile = path.join(payload.localDir || app.getPath('downloads'), filename)
  return await new Promise((resolve) => {
    sftp.fastGet(
      payload.remoteFile,
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
}))

ipcMain.handle('sftp:mkdir', async (_event, payload) => withSftp(payload, async (sftp) => {
  return await new Promise((resolve) => {
    sftp.mkdir(payload.remoteDir, {}, (err) => {
      if (err) return resolve({ ok: false, error: err.message })
      resolve({ ok: true })
    })
  })
}))

ipcMain.handle('sftp:rename', async (_event, payload) => withSftp(payload, async (sftp) => {
  return await new Promise((resolve) => {
    sftp.rename(payload.oldPath, payload.newPath, (err) => {
      if (err) return resolve({ ok: false, error: err.message })
      resolve({ ok: true })
    })
  })
}))

ipcMain.handle('sftp:delete', async (_event, payload) => withSftp(payload, async (sftp) => {
  return await new Promise((resolve) => {
    sftp.unlink(payload.remoteFile, (err) => {
      if (!err) return resolve({ ok: true })
      sftp.rmdir(payload.remoteFile, (err2) => {
        if (err2) return resolve({ ok: false, error: err2.message })
        resolve({ ok: true })
      })
    })
  })
}))

ipcMain.handle('sftp:upload', async (_event, payload) => withSftp(payload, async (sftp) => {
  let localFile = payload.localFile
  if (!localFile) {
    const win = BrowserWindow.getFocusedWindow()
    const pick = await dialog.showOpenDialog(win, { title: '选择本地文件上传', properties: ['openFile'] })
    if (pick.canceled || !pick.filePaths?.[0]) return { ok: false, error: '已取消' }
    localFile = pick.filePaths[0]
  }
  const remoteFile = `${payload.remoteDir || '.'}/${path.basename(localFile)}`

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
}))
