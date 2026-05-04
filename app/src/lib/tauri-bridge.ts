import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

type EventHandler = (data: any) => void

const MISSING_COMMAND_RE = /not found|unknown command|invalid args/i
const APP_VERSION = '0.3.16'

function formatError(error: unknown) {
  if (error instanceof Error) return error.message || String(error)
  return String(error || '未知错误')
}

function isMissingCommandError(error: unknown) {
  return MISSING_COMMAND_RE.test(formatError(error))
}

async function safeInvoke<T>(command: string, args?: Record<string, unknown>, fallback?: () => T | Promise<T>): Promise<T> {
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    if (fallback && isMissingCommandError(error)) return await fallback()
    throw error
  }
}

function ok<T extends Record<string, unknown>>(payload?: T) {
  return { ok: true, ...(payload || {}) }
}

function fail(error: unknown) {
  return { ok: false, error: formatError(error) }
}

async function safeListen(event: string, handler: EventHandler, mapPayload?: (payload: any) => any) {
  try {
    return await listen(event, (message) => handler(mapPayload ? mapPayload(message.payload) : message.payload))
  } catch {
    return () => {}
  }
}

function normalizeSshConfig(config: any) {
  return {
    host: String(config?.host || ''),
    port: Number(config?.port || 22),
    username: String(config?.username || ''),
    auth_type: config?.privateKey ? 'key' : (config?.password ? 'password' : 'interactive'),
    password: config?.password,
    private_key: config?.privateKey,
    passphrase: config?.passphrase,
  }
}

function decodeSerialPayload(payload: any) {
  if (!payload?.isHex) {
    return Array.from(new TextEncoder().encode(String(payload?.data || '')))
  }
  const compact = String(payload?.data || '').replace(/\s+/g, '')
  if (!compact) return []
  const normalized = compact.length % 2 === 0 ? compact : `0${compact}`
  const bytes: number[] = []
  for (let i = 0; i < normalized.length; i += 2) {
    const value = Number.parseInt(normalized.slice(i, i + 2), 16)
    if (Number.isNaN(value)) {
      throw new Error('HEX 数据格式无效')
    }
    bytes.push(value)
  }
  return bytes
}

function buildSftpSessionId(payload: any) {
  return String(payload?.sessionId || `${payload?.username || ''}@${payload?.host || ''}:${payload?.port || 22}`)
}

async function ensureSftpSession(payload: any) {
  const sessionId = buildSftpSessionId(payload)
  const result = await safeInvoke('sftp_connect', {
    sessionId,
    config: normalizeSshConfig(payload),
  })
  return { sessionId, result }
}

async function clipboardReadFallback() {
  if (!navigator?.clipboard?.readText) return ok({ text: '' })
  try {
    return ok({ text: await navigator.clipboard.readText() })
  } catch (error) {
    return fail(error)
  }
}

async function clipboardWriteFallback(payload: { text: string }) {
  if (!navigator?.clipboard?.writeText) return fail('当前环境不支持剪贴板写入')
  try {
    await navigator.clipboard.writeText(String(payload?.text || ''))
    return ok()
  } catch (error) {
    return fail(error)
  }
}

export const lightterm = {
  appGetStorage: () => safeInvoke('app_get_storage', undefined, async () => ok({ configured: false, dbPath: '' })).catch(fail),
  appGetStorageMeta: () => safeInvoke('app_get_storage_meta', undefined, async () => ok({ configured: false, dbPath: '' })).catch(fail),
  appRefreshStorageData: () => safeInvoke('app_refresh_storage_data', undefined, async () => ok({ changed: false, configured: false, dbPath: '' })).catch(fail),
  appPickStorageFolder: () => safeInvoke('app_pick_storage_folder', undefined, async () => fail('Tauri 版本暂未实现存储目录选择')).catch(fail),
  appPickStorageFile: () => safeInvoke('app_pick_storage_file', undefined, async () => fail('Tauri 版本暂未实现数据文件选择')).catch(fail),
  appPickStorageSaveFile: () => safeInvoke('app_pick_storage_save_file', undefined, async () => fail('Tauri 版本暂未实现目标文件选择')).catch(fail),
  appSetStorageFolder: (payload: any) => safeInvoke('app_set_storage_folder', { payload }, async () => fail('Tauri 版本暂未实现数据目录切换')).catch(fail),
  appCreateBackup: () => safeInvoke('app_create_backup', undefined, async () => fail('Tauri 版本暂未实现数据备份')).catch(fail),
  appListBackups: () => safeInvoke('app_list_backups', undefined, async () => ok({ items: [] })).catch(fail),
  appRestoreBackup: (payload: any) => safeInvoke('app_restore_backup', { payload }, async () => fail('Tauri 版本暂未实现备份恢复')).catch(fail),
  appRestart: () => safeInvoke('app_restart', undefined, async () => fail('Tauri 版本暂未实现应用重启')).catch(fail),
  appOpenExternal: (payload: any) => safeInvoke('app_open_external', { payload }, async () => fail('Tauri 版本暂未实现外部链接打开')).catch(fail),
  appOpenBackupsFolder: () => safeInvoke('app_open_backups_folder', undefined, async () => fail('Tauri 版本暂未实现备份目录打开')).catch(fail),

  clipboardRead: () => safeInvoke('clipboard_read', undefined, clipboardReadFallback).catch(fail),
  clipboardWrite: (payload: any) => safeInvoke('clipboard_write', { payload }, () => clipboardWriteFallback(payload)).catch(fail),

  auditList: (payload: any) => safeInvoke('audit_list', { payload }, async () => ok({ items: [] })).catch(fail),
  auditAppend: (payload: any) => safeInvoke('audit_append', { payload }, async () => ok({ item: { ...payload, id: `audit-${Date.now()}`, ts: Date.now() } })).catch(fail),
  auditClear: () => safeInvoke('audit_clear', undefined, async () => ok()).catch(fail),
  onAuditAppended: (handler: EventHandler) => safeListen('audit:appended', handler),

  updateGetState: () => safeInvoke('update_get_state', undefined, async () => ok({
    status: 'idle',
    currentVersion: APP_VERSION,
    hasUpdate: false,
    downloaded: false,
    checking: false,
    downloading: false,
    progress: 0,
  })).catch(fail),
  updateCheck: () => safeInvoke('update_check', undefined, async () => fail('Tauri 版本暂未实现自动更新')).catch(fail),
  updateDownload: () => safeInvoke('update_download', undefined, async () => fail('Tauri 版本暂未实现自动更新')).catch(fail),
  updateInstall: () => safeInvoke('update_install', undefined, async () => fail('Tauri 版本暂未实现自动更新')).catch(fail),
  onUpdateStatus: (handler: EventHandler) => safeListen('update:status', handler),
  onStorageDataChanged: (handler: EventHandler) => safeListen('storage:data-changed', handler),

  hostsList: () => safeInvoke('hosts_list', undefined, async () => ok({ items: [], extraCategories: [] })).catch(fail),
  hostsSave: (payload: any) => safeInvoke('hosts_save', { payload }, async () => fail('Tauri 版本暂未实现主机保存')).catch(fail),
  hostsDelete: (payload: any) => safeInvoke('hosts_delete', { payload }, async () => fail('Tauri 版本暂未实现主机删除')).catch(fail),
  hostsSetCategories: (payload: any) => safeInvoke('hosts_set_categories', { payload }, async () => ok({ extraCategories: payload?.extraCategories || [] })).catch(fail),

  snippetsGetState: () => safeInvoke('snippets_get_state', undefined, async () => ok({ items: [], extraCategories: [] })).catch(fail),
  snippetsSetState: (payload: any) => safeInvoke('snippets_set_state', { payload }, async () => ok({ items: payload?.items || [], extraCategories: payload?.extraCategories || [] })).catch(fail),
  quicktoolsGetState: () => safeInvoke('quicktools_get_state', undefined, async () => ok({ items: [] })).catch(fail),
  quicktoolsSetState: (payload: any) => safeInvoke('quicktools_set_state', { payload }, async () => ok({ items: payload?.items || [] })).catch(fail),

  vaultStatus: () => safeInvoke('vault_status', undefined, async () => ok({ configured: false, exists: false, initialized: false, unlocked: true, requiresPassword: false, decryptFailed: false })).catch(fail),
  vaultSetMaster: (payload: any) => safeInvoke('vault_set_master', { payload }, async () => fail('Tauri 版本暂未实现密钥仓库')).catch(fail),
  vaultUnlock: (payload: any) => safeInvoke('vault_unlock', { payload }, async () => fail('Tauri 版本暂未实现密钥仓库')).catch(fail),
  vaultReset: () => safeInvoke('vault_reset', undefined, async () => fail('Tauri 版本暂未实现密钥仓库')).catch(fail),
  vaultKeyList: () => safeInvoke('vault_key_list', undefined, async () => ok({ items: [] })).catch(fail),
  vaultKeySave: (payload: any) => safeInvoke('vault_key_save', { payload }, async () => fail('Tauri 版本暂未实现密钥保存')).catch(fail),
  vaultKeyGet: (payload: any) => safeInvoke('vault_key_get', { payload }, async () => fail('Tauri 版本暂未实现密钥读取')).catch(fail),
  vaultKeyDelete: (payload: any) => safeInvoke('vault_key_delete', { payload }, async () => fail('Tauri 版本暂未实现密钥删除')).catch(fail),
  vaultKeyImportFile: () => safeInvoke('vault_key_import_file', undefined, async () => fail('Tauri 版本暂未实现密钥导入')).catch(fail),

  syncLogin: () => Promise.resolve(ok()),
  syncGetConfig: () => Promise.resolve(ok({
    config: {
      enabled: false,
      provider: 'folder',
      targetPath: '',
      baseUrl: '',
      token: '',
      password: '',
      autoPullOnStartup: false,
      autoPushOnChange: false,
      debounceMs: 800,
    },
  })),
  syncSetConfig: (payload: any) => Promise.resolve(ok({ config: payload })),
  syncStatus: () => Promise.resolve(ok({
    config: {
      enabled: false,
      provider: 'folder',
      targetPath: '',
      baseUrl: '',
      token: '',
      password: '',
      autoPullOnStartup: false,
      autoPushOnChange: false,
      debounceMs: 800,
    },
    queueCount: 0,
    state: {
      status: 'disabled',
      unsupported: true,
      lastSuccessMessage: 'Tauri 版本暂未实现同步，请改用本地数据文件切换',
    },
  })),
  syncTestConnection: () => Promise.resolve(fail('Sync not available in Tauri version')),
  syncPullNow: () => Promise.resolve(fail('Sync not available in Tauri version')),
  syncQueue: () => Promise.resolve(ok({ items: [] })),
  syncClearQueue: () => Promise.resolve(ok()),
  syncPushNow: () => Promise.resolve(fail('Sync not available in Tauri version')),
  syncRetryFailed: () => Promise.resolve(ok({ pushed: 0, message: 'No queued jobs' })),
  onSyncStatus: () => Promise.resolve(() => {}),

  listSerialPorts: async () => {
    try {
      const items = await safeInvoke<any[]>('serial_list_ports', undefined, async () => [])
      return (items || []).map((item) => ({
        path: item?.port_name || item?.path || '',
        type: item?.port_type || item?.type || 'unknown',
      }))
    } catch {
      return []
    }
  },
  openSerial: (options: any) => safeInvoke('serial_connect', {
    sessionId: String(options?.path || options?.id || ''),
    config: {
      port: String(options?.path || ''),
      baud_rate: Number(options?.baudRate || 9600),
      data_bits: String(options?.dataBits || 8),
      stop_bits: String(options?.stopBits || 1),
      parity: String(options?.parity || 'none'),
      flow_control: options?.rtscts ? 'hardware' : (options?.xon || options?.xoff ? 'software' : 'none'),
    },
  }, async () => fail('Tauri 版本暂未实现串口连接')).then(() => ok()).catch(fail),
  closeSerial: (payload: any) => safeInvoke('serial_disconnect', { sessionId: String(payload?.path || '') }, async () => ok()).then(() => ok()).catch(fail),
  sendSerial: async (payload: any) => {
    try {
      await safeInvoke('serial_write', {
        sessionId: String(payload?.path || ''),
        data: decodeSerialPayload(payload),
      }, async () => fail('Tauri 版本暂未实现串口发送'))
      return ok()
    } catch (error) {
      return fail(error)
    }
  },
  onSerialData: (handler: EventHandler) => safeListen('serial:data', handler, (payload) => ({
    path: payload?.id || payload?.path || '',
    data: payload?.data || '',
  })),
  onSerialError: (handler: EventHandler) => safeListen('serial:error', handler, (payload) => ({
    path: payload?.id || payload?.path || '',
    error: payload?.error || '串口错误',
  })),

  localConnect: () => Promise.resolve(fail('本地终端已从 Tauri 版本移除')),
  localWrite: () => Promise.resolve(fail('本地终端已从 Tauri 版本移除')),
  localResize: () => Promise.resolve(fail('本地终端已从 Tauri 版本移除')),
  localDisconnect: () => Promise.resolve(ok()),
  onLocalData: () => Promise.resolve(() => {}),
  onLocalClose: () => Promise.resolve(() => {}),
  onLocalError: () => Promise.resolve(() => {}),

  sshTest: (config: any) => safeInvoke('ssh_test', {
    config: {
      host: String(config?.host || ''),
      port: Number(config?.port || 22),
      username: String(config?.username || ''),
      auth_type: config?.privateKey ? 'key' : (config?.password ? 'password' : 'interactive'),
      password: config?.password,
      private_key: config?.privateKey,
      passphrase: config?.passphrase,
    },
  }, async () => fail('Tauri 版本暂未实现 SSH 探测')).then(() => ok()).catch(fail),
  sshList: async () => {
    try {
      const items = await safeInvoke<any[]>('ssh_list_sessions')
      return ok({
        items: (items || []).map((item) => ({
          sessionId: String(item?.id || ''),
          target: `${item?.config?.username || ''}@${item?.config?.host || ''}:${item?.config?.port || 22}`,
        })),
      })
    } catch (error) {
      return fail(error)
    }
  },
  sshConnect: async (config: any) => {
    try {
      await safeInvoke('ssh_connect', {
        sessionId: String(config?.sessionId || ''),
        config: {
          host: String(config?.host || ''),
          port: Number(config?.port || 22),
          username: String(config?.username || ''),
          auth_type: config?.privateKey ? 'key' : (config?.password ? 'password' : 'interactive'),
          password: config?.password,
          private_key: config?.privateKey,
          passphrase: config?.passphrase,
        },
      })
      return ok()
    } catch (error) {
      return fail(error)
    }
  },
  sshExecScript: (payload: any) => safeInvoke('ssh_exec_script', { payload }, async () => fail('Tauri 版本暂未实现 SSH 脚本执行')).catch(fail),
  sshMetrics: async (payload: any) => {
    try {
      const result = await safeInvoke<any>('ssh_metrics', { payload: { session_id: String(payload?.sessionId || '') } }, async () => ({ supported: false, metrics: null }))
      return ok(result)
    } catch (error) {
      return fail(error)
    }
  },
  sshWrite: (payload: any) => safeInvoke('ssh_write', { sessionId: String(payload?.sessionId || ''), data: String(payload?.data || '') }).then(() => ok()).catch(fail),
  sshResize: (payload: any) => safeInvoke('ssh_resize', {
    sessionId: String(payload?.sessionId || ''),
    cols: Number(payload?.cols || 80),
    rows: Number(payload?.rows || 24),
  }).then(() => ok()).catch(fail),
  sshDisconnect: (payload: any) => safeInvoke('ssh_disconnect', { sessionId: String(payload?.sessionId || '') }).then(() => ok()).catch(fail),
  onSshData: (handler: EventHandler) => safeListen('ssh:data', handler, (payload) => ({
    sessionId: payload?.id || payload?.sessionId || '',
    data: payload?.data || '',
  })),
  onSshClose: (handler: EventHandler) => safeListen('ssh:close', handler, (payload) => ({
    sessionId: payload?.id || payload?.sessionId || '',
    reason: payload?.reason,
  })),
  onSshError: (handler: EventHandler) => safeListen('ssh:error', handler, (payload) => ({
    sessionId: payload?.id || payload?.sessionId || '',
    error: payload?.error || 'SSH 错误',
  })),

  onSftpProgress: (handler: EventHandler) => safeListen('sftp:progress', handler),
  localfsList: (payload: any) => safeInvoke('localfs_list', { payload: { local_path: payload?.localPath || '' } }, async () => fail('Tauri 版本暂未实现本地目录读取')).catch(fail),
  sftpConnect: async (config: any) => {
    try {
      const { result } = await ensureSftpSession(config)
      return ok({ sessionId: result })
    } catch (error) {
      return fail(error)
    }
  },
  sftpDisconnect: (payload: any) => safeInvoke('sftp_disconnect', { sessionId: String(payload?.sessionId || '') }, async () => ok()).catch(fail),
  sftpList: async (payload: any) => {
    try {
      const { sessionId } = await ensureSftpSession(payload)
      const items = await safeInvoke<any[]>('sftp_list_dir', {
        sessionId,
        path: payload?.remotePath || '.',
      }, async () => [])
      return ok({ items })
    } catch (error) {
      return fail(error)
    }
  },
  sftpUpload: async (payload: any) => {
    try {
      const { sessionId } = await ensureSftpSession(payload)
      const result = await safeInvoke<any>('sftp_upload', {
        sessionId,
        localPath: String(payload?.localFile || ''),
        remotePath: String(payload?.remoteDir || ''),
      })
      return result?.ok ? result : ok(result)
    } catch (error) {
      return fail(error)
    }
  },
  sftpDownload: async (payload: any) => {
    try {
      const { sessionId } = await ensureSftpSession(payload)
      const result = await safeInvoke<any>('sftp_download', {
        sessionId,
        remotePath: String(payload?.remoteFile || ''),
        localPath: '',
      })
      return result?.ok ? result : ok(result)
    } catch (error) {
      return fail(error)
    }
  },
  sftpDownloadToLocal: async (payload: any) => {
    try {
      const { sessionId } = await ensureSftpSession(payload)
      const result = await safeInvoke<any>('sftp_download', {
        sessionId,
        remotePath: String(payload?.remoteFile || ''),
        localPath: String(payload?.localDir || ''),
      })
      return result?.ok ? result : ok(result)
    } catch (error) {
      return fail(error)
    }
  },
  sftpDelete: async (payload: any) => {
    try {
      const { sessionId } = await ensureSftpSession(payload)
      const result = await safeInvoke<any>('sftp_delete', {
        sessionId,
        path: String(payload?.remoteFile || payload?.path || ''),
      })
      return result?.ok ? result : ok(result)
    } catch (error) {
      return fail(error)
    }
  },
  sftpMkdir: async (payload: any) => {
    try {
      const { sessionId } = await ensureSftpSession(payload)
      const result = await safeInvoke<any>('sftp_mkdir', {
        sessionId,
        path: String(payload?.remoteDir || payload?.path || ''),
      })
      return result?.ok ? result : ok(result)
    } catch (error) {
      return fail(error)
    }
  },
  sftpRename: async (payload: any) => {
    try {
      const { sessionId } = await ensureSftpSession(payload)
      const result = await safeInvoke<any>('sftp_rename', {
        sessionId,
        oldPath: String(payload?.oldPath || ''),
        newPath: String(payload?.newPath || ''),
      })
      return result?.ok ? result : ok(result)
    } catch (error) {
      return fail(error)
    }
  },

  getSystemInfo: () => invoke('get_system_info'),
  getAppDataDir: () => invoke('get_app_data_dir'),
  showItemInFolder: (path: string) => invoke('show_item_in_folder', { path }),
}

if (typeof window !== 'undefined') {
  ;(window as any).lightterm = lightterm
}
