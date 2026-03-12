import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import crypto from 'node:crypto'
import { v4 as uuidv4 } from 'uuid'
import { Client as SSHClient } from 'ssh2'
import { SerialPort } from 'serialport'
import sshpk from 'sshpk'

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

function resolveDbPath() {
  const envPath = process.env.LIGHTTERM_DB_PATH
  if (envPath) return envPath
  const s = readSettings()
  if (s.dbPath) return s.dbPath
  return path.join(app.getPath('userData'), 'lightterm.db')
}

class JsonDB {
  constructor(filePath) {
    this.filePath = filePath
    this.data = {
      hosts: [],
      vault_meta: null,
      vault_keys: [],
      sync_account: null,
      sync_queue: [],
    }
    this.load()
  }

  load() {
    if (!fs.existsSync(this.filePath)) return
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8')
      const parsed = JSON.parse(raw)
      this.data = { ...this.data, ...parsed }
    } catch {}
  }

  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8')
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
        if (s.startsWith('SELECT * FROM SYNC_QUEUE ORDER BY CREATED_AT DESC')) {
          return [...self.data.sync_queue].sort((a, b) => (b.created_at || 0) - (a.created_at || 0)).slice(0, 100)
        }
        if (s.startsWith('SELECT * FROM SYNC_QUEUE ORDER BY CREATED_AT ASC')) {
          return [...self.data.sync_queue].sort((a, b) => (a.created_at || 0) - (b.created_at || 0)).slice(0, 200)
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
        if (s.startsWith('SELECT PROVIDER, USER_ID, UPDATED_AT FROM SYNC_ACCOUNT')) return self.data.sync_account || undefined
        if (s.startsWith('SELECT COUNT(*) AS C FROM SYNC_QUEUE')) return { c: self.data.sync_queue.length }
        return undefined
      },
      run(...args) {
        if (s.startsWith('INSERT INTO SYNC_QUEUE')) {
          const [id, entity, entity_id, op, payload, created_at] = args
          self.data.sync_queue.push({ id, entity, entity_id, op, payload, created_at })
          self.save()
          return
        }
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
        if (s.startsWith('INSERT OR REPLACE INTO SYNC_ACCOUNT')) {
          const [provider, user_id, token, updated_at] = args
          self.data.sync_account = { id: 1, provider, user_id, token, updated_at }
          self.save()
          return
        }
        if (s.startsWith('DELETE FROM SYNC_QUEUE')) {
          self.data.sync_queue = []
          self.save()
          return
        }
      },
    }
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
  }
}

async function withSftp(payload, handler) {
  return await new Promise((resolve) => {
    const conn = new SSHClient()
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
  })
}

function initDb() {
  const dbPath = resolveDbPath()
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    db = new JsonDB(dbPath)
    db.save()
  } catch (e) {
    const fallback = path.join(app.getPath('userData'), 'lightterm.db')
    fs.mkdirSync(path.dirname(fallback), { recursive: true })
    db = new JsonDB(fallback)
    db.save()
    const settings = readSettings()
    delete settings.dbPath
    writeSettings(settings)
  }

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

    CREATE TABLE IF NOT EXISTS sync_account (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      provider TEXT,
      user_id TEXT,
      token TEXT,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY,
      entity TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      op TEXT NOT NULL,
      payload TEXT,
      created_at INTEGER
    );
  `)
}

function enqueueSync(entity, entityId, op, payload) {
  db.prepare('INSERT INTO sync_queue (id, entity, entity_id, op, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    uuidv4(),
    entity,
    entityId,
    op,
    JSON.stringify(payload || {}),
    Date.now(),
  )
}

function logMain(message) {
  try {
    const logPath = path.join(app.getPath('userData'), 'main.log')
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`, 'utf8')
  } catch {}
}

function buildAppMenu() {
  const template = [
    {
      label: 'LightTerm',
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
    title: 'LightTerm',
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
    createWindow()
    logMain('createWindow called')
  } catch (e) {
    try {
      const p = path.join(app.getPath('userData'), 'fatal.log')
      fs.appendFileSync(p, `[${new Date().toISOString()}] ${e?.stack || e?.message || e}\n`, 'utf8')
    } catch {}
    dialog.showErrorBox('LightTerm 启动失败', String(e?.message || e))
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('app:get-storage', async () => {
  const dbPath = resolveDbPath()
  return { ok: true, dbPath }
})

ipcMain.handle('app:pick-storage-folder', async () => {
  const win = BrowserWindow.getFocusedWindow()
  const picked = await dialog.showOpenDialog(win, {
    title: '选择数据库目录（可选 iCloud/共享文件夹）',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (picked.canceled || !picked.filePaths?.[0]) return { ok: false, error: '已取消' }
  return { ok: true, folder: picked.filePaths[0] }
})

ipcMain.handle('app:set-storage-folder', async (_event, payload) => {
  if (!payload?.folder) return { ok: false, error: '缺少目录' }
  const nextDbPath = path.join(payload.folder, 'lightterm.db')
  const settings = readSettings()
  settings.dbPath = nextDbPath
  writeSettings(settings)
  return { ok: true, dbPath: nextDbPath, restartRequired: true }
})

ipcMain.handle('hosts:list', async () => ({ ok: true, items: db.prepare('SELECT * FROM hosts ORDER BY updated_at DESC').all() }))

ipcMain.handle('hosts:save', async (_event, payload) => {
  const now = Date.now()
  const id = payload.id || uuidv4()
  db.prepare(`
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
    tags: JSON.stringify(payload.tags || []),
    created_at: now,
    updated_at: now,
  })
  enqueueSync('hosts', id, 'upsert', payload)
  return { ok: true, id }
})

ipcMain.handle('hosts:delete', async (_event, payload) => {
  db.prepare('DELETE FROM hosts WHERE id = ?').run(payload.id)
  enqueueSync('hosts', payload.id, 'delete', { id: payload.id })
  return { ok: true }
})

ipcMain.handle('vault:status', async () => {
  const row = db.prepare('SELECT id FROM vault_meta WHERE id = 1').get()
  const state = { ok: true, initialized: !!row, unlocked: !!vaultKey }
  logMain(`vault:status initialized=${state.initialized} unlocked=${state.unlocked}`)
  return state
})

ipcMain.handle('vault:set-master', async (_event, payload) => {
  try {
    const pwd = String(payload?.masterPassword || '')
    if (!pwd || pwd.length < 1) return { ok: false, error: '主密码不能为空' }

    const salt = crypto.randomBytes(16)
    const key = deriveKey(pwd, salt)
    const verifierHash = crypto.createHash('sha256').update(key).digest('base64')
    db.prepare('INSERT OR REPLACE INTO vault_meta (id, salt, verifier_hash, updated_at) VALUES (1, ?, ?, ?)').run(salt.toString('base64'), verifierHash, Date.now())
    vaultKey = key
    logMain('vault:set-master ok')
    return { ok: true }
  } catch (e) {
    logMain(`vault:set-master error: ${e?.message || e}`)
    return { ok: false, error: `初始化失败：${e?.message || e}` }
  }
})

ipcMain.handle('vault:unlock', async (_event, payload) => {
  try {
    const pwd = String(payload?.masterPassword || '')
    if (!pwd) return { ok: false, error: '请输入主密码' }

    const meta = db.prepare('SELECT * FROM vault_meta WHERE id = 1').get()
    if (!meta) return { ok: false, error: '密钥仓库未初始化' }

    const key = deriveKey(pwd, Buffer.from(meta.salt, 'base64'))
    if (crypto.createHash('sha256').update(key).digest('base64') !== meta.verifier_hash) return { ok: false, error: '主密码错误' }
    vaultKey = key
    logMain('vault:unlock ok')
    return { ok: true }
  } catch (e) {
    logMain(`vault:unlock error: ${e?.message || e}`)
    return { ok: false, error: `解锁失败：${e?.message || e}` }
  }
})

ipcMain.handle('vault:reset', async () => {
  try {
    db.data.vault_meta = null
    db.data.vault_keys = []
    db.save()
    vaultKey = null
    logMain('vault:reset ok')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: `重置失败：${e?.message || e}` }
  }
})

ipcMain.handle('vault:key-save', async (_event, payload) => {
  if (!vaultKey) return { ok: false, error: '密钥仓库未解锁' }
  const id = payload.id || uuidv4()

  let resolvedType = payload.type || 'auto'
  let keyObj = null
  try {
    if (!payload.type || payload.type === 'auto') {
      try {
        keyObj = sshpk.parsePrivateKey(payload.privateKey, 'putty')
        resolvedType = 'ppk'
      } catch {
        try {
          keyObj = sshpk.parsePrivateKey(payload.privateKey, 'pem')
          resolvedType = 'pem'
        } catch {
          keyObj = sshpk.parsePrivateKey(payload.privateKey, 'auto')
          resolvedType = 'openssh'
        }
      }
    } else {
      keyObj = sshpk.parsePrivateKey(payload.privateKey, payload.type === 'ppk' ? 'putty' : payload.type)
    }
  } catch {
    return { ok: false, error: '无法识别私钥格式，请检查内容是否完整' }
  }

  const enc = encryptText(JSON.stringify({
    privateKey: payload.privateKey || '',
    publicKey: payload.publicKey || '',
    certificate: payload.certificate || '',
  }), vaultKey)
  let fp = payload.fingerprint || null
  try {
    fp = keyObj?.toPublic().fingerprint('sha256').toString() || null
  } catch {}

  db.prepare(`
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
  enqueueSync('vault_keys', id, 'upsert', { id, name: payload.name, type: resolvedType })
  return { ok: true, id, detectedType: resolvedType }
})

ipcMain.handle('vault:key-import-file', async () => {
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

ipcMain.handle('vault:key-list', async () => ({ ok: true, items: db.prepare('SELECT id, name, type, fingerprint, created_at, updated_at FROM vault_keys ORDER BY updated_at DESC').all() }))

ipcMain.handle('vault:key-get', async (_event, payload) => {
  if (!vaultKey) return { ok: false, error: '密钥仓库未解锁' }
  const row = db.prepare('SELECT * FROM vault_keys WHERE id = ?').get(payload.id)
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
})

ipcMain.handle('sync:login', async (_event, payload) => {
  db.prepare('INSERT OR REPLACE INTO sync_account (id, provider, user_id, token, updated_at) VALUES (1, ?, ?, ?, ?)').run(payload.provider || 'custom', payload.userId || 'local-user', payload.token || '', Date.now())
  return { ok: true }
})
ipcMain.handle('sync:status', async () => {
  const account = db.prepare('SELECT provider, user_id, updated_at FROM sync_account WHERE id=1').get()
  const queueCount = db.prepare('SELECT COUNT(*) as c FROM sync_queue').get()?.c || 0
  return { ok: true, account: account || null, queueCount }
})
ipcMain.handle('sync:queue', async () => ({ ok: true, items: db.prepare('SELECT * FROM sync_queue ORDER BY created_at DESC LIMIT 100').all() }))
ipcMain.handle('sync:clear-queue', async () => {
  db.prepare('DELETE FROM sync_queue').run()
  return { ok: true }
})
ipcMain.handle('sync:push-now', async () => {
  const items = db.prepare('SELECT * FROM sync_queue ORDER BY created_at ASC LIMIT 200').all()
  // TODO: 对接真实云端 API。当前为本地模拟“已上传成功”。
  db.prepare('DELETE FROM sync_queue').run()
  return { ok: true, pushed: items.length }
})

ipcMain.handle('serial:list', async () => (await SerialPort.list()).map((p) => ({ path: p.path, manufacturer: p.manufacturer, serialNumber: p.serialNumber, vendorId: p.vendorId, productId: p.productId })))
ipcMain.handle('serial:open', async (_event, options) => {
  const key = options.path
  if (serialPorts.has(key)) return { ok: true }
  const port = new SerialPort({ path: options.path, baudRate: Number(options.baudRate || 115200), dataBits: Number(options.dataBits || 8), stopBits: Number(options.stopBits || 1), parity: options.parity || 'none', autoOpen: true })
  serialPorts.set(key, port)
  port.on('data', (data) => broadcast('serial:data', { path: key, data: data.toString('utf8') }))
  port.on('error', (err) => broadcast('serial:error', { path: key, error: err.message }))
  return { ok: true }
})
ipcMain.handle('serial:send', async (_event, payload) => {
  const port = serialPorts.get(payload.path)
  if (!port) return { ok: false, error: '串口未打开' }
  const data = payload.isHex ? Buffer.from(payload.data.replace(/\s+/g, ''), 'hex') : payload.data
  await new Promise((resolve, reject) => port.write(data, (err) => (err ? reject(err) : resolve(true))))
  return { ok: true }
})

ipcMain.handle('ssh:test', async (_event, config) => await new Promise((resolve) => {
  const conn = new SSHClient()
  conn.on('ready', () => { conn.end(); resolve({ ok: true }) }).on('error', (err) => resolve({ ok: false, error: err.message })).connect(connectConfigFromPayload(config))
}))

ipcMain.handle('ssh:connect', async (_event, payload) => await new Promise((resolve) => {
  const sessionId = payload.sessionId
  if (!sessionId) return resolve({ ok: false, error: '缺少 sessionId' })
  if (sshSessions.has(sessionId)) return resolve({ ok: true })
  const conn = new SSHClient()
  conn.on('ready', () => {
    conn.shell({ term: 'xterm-256color', cols: 120, rows: 30 }, (err, stream) => {
      if (err) return resolve({ ok: false, error: err.message })
      sshSessions.set(sessionId, { conn, stream })
      stream.on('data', (chunk) => broadcast('ssh:data', { sessionId, data: chunk.toString('utf8') }))
      stream.on('close', () => { broadcast('ssh:close', { sessionId }); sshSessions.delete(sessionId); conn.end() })
      resolve({ ok: true })
    })
  }).on('error', (err) => { broadcast('ssh:error', { sessionId, error: err.message }); resolve({ ok: false, error: err.message }) }).connect(connectConfigFromPayload(payload))
}))

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

ipcMain.handle('localfs:list', async (_event, payload) => {
  const localPath = payload?.localPath || os.homedir()
  try {
    const items = fs.readdirSync(localPath, { withFileTypes: true }).map((d) => ({
      name: d.name,
      isDir: d.isDirectory(),
      path: path.join(localPath, d.name),
    }))
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
        mtime: item.attrs?.mtime,
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
