/// <reference types="vite/client" />

type SSHConfig = { host: string; port?: number; username: string; password?: string; privateKey?: string; passphrase?: string }
type DbEngine = 'MySQL' | 'MariaDB' | 'PostgreSQL' | 'SQL Server'
type DbState = 'connected' | 'idle' | 'offline'
type DbTableItem = { name: string; tableName?: string; schemaName?: string; rows: number; size: string; updatedAt: string }
type DbConnectionItem = {
  id: string
  name: string
  engine: DbEngine
  host: string
  port: number
  username: string
  password?: string
  database: string
  note: string
  state: DbState
  version: string
  latency: string
  databases: string[]
  schemas: string[]
  tables: DbTableItem[]
  lastError?: string
}

declare global {
  interface Window {
    lightterm: {
      appGetStorage: () => Promise<{ ok: boolean; configured?: boolean; dbPath?: string }>
      appGetStorageMeta: () => Promise<{ ok: boolean; configured?: boolean; dbPath?: string; exists?: boolean; size?: number; mtimeMs?: number; encrypted?: boolean; decryptState?: string; unlockRequired?: boolean; storageVersion?: number; fileId?: string; revision?: number; signature?: string; hosts?: number; dbConnections?: number; snippets?: number; vaultKeys?: number; quickTools?: number; itemCount?: number; logs?: number }>
      appRefreshStorageData: () => Promise<{ ok: boolean; changed?: boolean; configured?: boolean; dbPath?: string; exists?: boolean; size?: number; mtimeMs?: number; encrypted?: boolean; decryptState?: string; unlockRequired?: boolean; storageVersion?: number; fileId?: string; revision?: number; signature?: string; hosts?: number; dbConnections?: number; snippets?: number; vaultKeys?: number; quickTools?: number; itemCount?: number; logs?: number; error?: string }>
      appPickStorageFolder: () => Promise<{ ok: boolean; folder?: string; error?: string }>
      appPickStorageFile: () => Promise<{ ok: boolean; filePath?: string; error?: string }>
      appPickStorageSaveFile: () => Promise<{ ok: boolean; filePath?: string; error?: string }>
      appSetStorageFolder: (payload: { folder: string }) => Promise<{ ok: boolean; dbPath?: string; restartRequired?: boolean; error?: string }>
      appCreateBackup: () => Promise<{ ok: boolean; backupPath?: string; auditBackupPath?: string; count?: number; error?: string }>
      appListBackups: () => Promise<{ ok: boolean; items?: Array<{ name: string; path: string; size: number; mtimeMs: number }>; error?: string }>
      appRestoreBackup: (payload: { backupPath: string }) => Promise<{ ok: boolean; dbPath?: string; restartRequired?: boolean; error?: string }>
      appRestart: () => Promise<{ ok: boolean; error?: string }>
      appOpenExternal: (payload: { url: string }) => Promise<{ ok: boolean; error?: string }>
      appOpenBackupsFolder: () => Promise<{ ok: boolean; path?: string; error?: string }>
      clipboardRead: () => Promise<{ ok: boolean; text?: string; error?: string }>
      clipboardWrite: (payload: { text: string }) => Promise<{ ok: boolean; error?: string }>
      auditList: (payload?: { limit?: number; source?: string; keyword?: string }) => Promise<{ ok: boolean; items?: any[]; error?: string }>
      auditAppend: (payload: { source: string; action: string; target?: string; content?: string; level?: string }) => Promise<{ ok: boolean; item?: any; error?: string }>
      auditClear: () => Promise<{ ok: boolean; error?: string }>
      onAuditAppended: (handler: (data: any) => void) => void
      updateGetState: () => Promise<{ ok: boolean; status?: string; message?: string; currentVersion?: string; latestVersion?: string; source?: string; hasUpdate?: boolean; downloaded?: boolean; checking?: boolean; downloading?: boolean; progress?: number; downloadUrl?: string; releaseUrl?: string; error?: string }>
      updateCheck: () => Promise<{ ok: boolean; error?: string }>
      updateDownload: () => Promise<{ ok: boolean; error?: string }>
      updateInstall: () => Promise<{ ok: boolean; error?: string }>
      onUpdateStatus: (handler: (data: { status?: string; message?: string; currentVersion?: string; latestVersion?: string; source?: string; hasUpdate?: boolean; downloaded?: boolean; checking?: boolean; downloading?: boolean; progress?: number; downloadUrl?: string; releaseUrl?: string }) => void) => void
      onStorageDataChanged: (handler: (data: { changedAt?: number }) => void) => void

      hostsList: () => Promise<{ ok: boolean; items?: any[]; extraCategories?: string[]; error?: string }>
      hostsSave: (payload: any) => Promise<{ ok: boolean; id?: string; error?: string }>
      hostsDelete: (payload: { id: string }) => Promise<{ ok: boolean; error?: string }>
      hostsSetCategories: (payload: { extraCategories: string[] }) => Promise<{ ok: boolean; extraCategories?: string[]; error?: string }>
      snippetsGetState: () => Promise<{ ok: boolean; items?: any[]; extraCategories?: string[]; error?: string }>
      snippetsSetState: (payload: { items: any[]; extraCategories: string[] }) => Promise<{ ok: boolean; items?: any[]; extraCategories?: string[]; error?: string }>
      quicktoolsGetState: () => Promise<{ ok: boolean; items?: any[]; error?: string }>
      quicktoolsSetState: (payload: { items: any[] }) => Promise<{ ok: boolean; items?: any[]; error?: string }>
      dbListConnections: () => Promise<{ ok: boolean; items?: DbConnectionItem[]; error?: string }>
      dbSaveConnection: (payload: { id?: string; name: string; engine: DbEngine; host: string; port: number; username: string; password?: string; database?: string; note?: string }) => Promise<{ ok: boolean; id?: string; item?: DbConnectionItem; error?: string }>
      dbDeleteConnection: (payload: { id: string }) => Promise<{ ok: boolean; error?: string }>
      dbConnect: (payload: { id: string }) => Promise<{ ok: boolean; item?: DbConnectionItem; error?: string }>
      dbDisconnect: (payload: { id: string }) => Promise<{ ok: boolean; item?: DbConnectionItem; error?: string }>
      dbListDatabases: (payload: { id: string }) => Promise<{ ok: boolean; item?: DbConnectionItem; databases?: string[]; error?: string }>
      dbSelectDatabase: (payload: { id: string; database: string }) => Promise<{ ok: boolean; item?: DbConnectionItem; databases?: string[]; tables?: DbTableItem[]; schemas?: string[]; error?: string }>
      dbListTables: (payload: { id: string }) => Promise<{ ok: boolean; item?: DbConnectionItem; tables?: DbTableItem[]; schemas?: string[]; error?: string }>
      dbQuery: (payload: { id: string; sql: string }) => Promise<{ ok: boolean; item?: DbConnectionItem; columns?: string[]; rows?: Array<Record<string, unknown>>; summary?: string; error?: string }>
      dbExportQuery: (payload: { id?: string; name?: string; columns: string[]; rows: Array<Record<string, unknown>> }) => Promise<{ ok: boolean; filePath?: string; error?: string }>
      dbPreviewTable: (payload: { id: string; tableName: string; schemaName?: string; limit?: number }) => Promise<{ ok: boolean; item?: DbConnectionItem; sql?: string; columns?: string[]; rows?: Array<Record<string, unknown>>; summary?: string; error?: string }>

      vaultStatus: () => Promise<{ ok: boolean; configured?: boolean; exists?: boolean; initialized: boolean; unlocked: boolean; requiresPassword?: boolean; decryptFailed?: boolean; error?: string }>
      vaultSetMaster: (payload: { masterPassword: string }) => Promise<{ ok: boolean; error?: string }>
      vaultUnlock: (payload: { masterPassword: string }) => Promise<{ ok: boolean; error?: string }>
      vaultReset: () => Promise<{ ok: boolean; error?: string }>
      vaultKeyList: () => Promise<{ ok: boolean; items?: any[]; error?: string }>
      vaultKeySave: (payload: { id?: string; name: string; type?: string; fingerprint?: string; privateKey: string; publicKey?: string; certificate?: string }) => Promise<{ ok: boolean; id?: string; detectedType?: string; error?: string }>
      vaultKeyGet: (payload: { id: string }) => Promise<{ ok: boolean; item?: any; error?: string }>
      vaultKeyDelete: (payload: { id: string }) => Promise<{ ok: boolean; error?: string }>
      vaultKeyImportFile: () => Promise<{ ok: boolean; content?: string; detectedType?: string; filePath?: string; raw?: string; error?: string }>

      syncLogin: (payload: { provider?: string; userId?: string; token?: string }) => Promise<{ ok: boolean; error?: string }>
      syncGetConfig: () => Promise<{ ok: boolean; config?: { enabled: boolean; provider: 'folder' | 'http'; targetPath: string; baseUrl: string; token: string; password: string; autoPullOnStartup: boolean; autoPushOnChange: boolean; debounceMs: number }; error?: string }>
      syncSetConfig: (payload: { enabled: boolean; provider: 'folder' | 'http'; targetPath: string; baseUrl: string; token: string; password: string; autoPullOnStartup: boolean; autoPushOnChange: boolean; debounceMs: number }) => Promise<{ ok: boolean; config?: { enabled: boolean; provider: 'folder' | 'http'; targetPath: string; baseUrl: string; token: string; password: string; autoPullOnStartup: boolean; autoPushOnChange: boolean; debounceMs: number }; error?: string }>
      syncStatus: () => Promise<{ ok: boolean; config?: any; state?: any; local?: any; remote?: any; queueCount?: number; error?: string }>
      syncTestConnection: () => Promise<{ ok: boolean; provider?: string; targetPath?: string; remote?: any; error?: string }>
      syncPullNow: () => Promise<{ ok: boolean; changed?: boolean; pulled?: number; requiresUnlock?: boolean; message?: string; conflict?: boolean; error?: string }>
      syncQueue: () => Promise<{ ok: boolean; items?: any[] }>
      syncClearQueue: () => Promise<{ ok: boolean }>
      syncPushNow: () => Promise<{ ok: boolean; pushed?: number; message?: string; conflict?: boolean; error?: string }>
      syncRetryFailed: () => Promise<{ ok: boolean; pushed?: number; message?: string; conflict?: boolean; error?: string }>
      onSyncStatus: (handler: (data: { ok: boolean; config?: any; state?: any; local?: any; remote?: any; queueCount?: number; error?: string }) => void) => void

      listSerialPorts: () => Promise<any[]>
      openSerial: (options: {
        path: string
        baudRate?: number
        dataBits?: number
        stopBits?: number
        parity?: 'none' | 'even' | 'odd'
        rtscts?: boolean
        dsrdtr?: boolean
        xon?: boolean
        xoff?: boolean
      }) => Promise<{ ok: boolean; error?: string }>
      closeSerial: (payload: { path: string }) => Promise<{ ok: boolean; error?: string }>
      sendSerial: (payload: { path: string; data: string; isHex?: boolean }) => Promise<{ ok: boolean; error?: string }>
      onSerialData: (handler: (data: { path: string; data: string }) => void) => void
      onSerialError: (handler: (data: { path: string; error: string }) => void) => void

      localConnect: (payload: { sessionId: string; cwd?: string; cols?: number; rows?: number; shellType?: 'auto' | 'cmd' | 'powershell'; elevated?: boolean }) => Promise<{ ok: boolean; shell?: string; cwd?: string; warning?: string; error?: string }>
      localWrite: (payload: { sessionId: string; data: string }) => Promise<{ ok: boolean; error?: string }>
      localResize: (payload: { sessionId: string; cols: number; rows: number }) => Promise<{ ok: boolean; error?: string }>
      localDisconnect: (payload: { sessionId: string }) => Promise<{ ok: boolean; error?: string }>
      onLocalData: (handler: (data: { sessionId: string; data: string; dataBase64?: string }) => void) => void
      onLocalClose: (handler: (data: { sessionId: string; code?: number; signal?: string }) => void) => void
      onLocalError: (handler: (data: { sessionId: string; error: string }) => void) => void

      sshTest: (config: SSHConfig) => Promise<{ ok: boolean; error?: string }>
      sshList: () => Promise<{ ok: boolean; items?: Array<{ sessionId: string; target?: string }>; error?: string }>
      sshConnect: (config: SSHConfig & { sessionId: string; displayName?: string }) => Promise<{ ok: boolean; error?: string }>
      sshExecScript: (payload: SSHConfig & { script: string; timeoutMs?: number }) => Promise<{ ok: boolean; code?: number; stdout?: string; stderr?: string; error?: string }>
      sshMetrics: (payload: { sessionId: string }) => Promise<{ ok: boolean; supported?: boolean; metrics?: { cpuPercent?: number | null; memoryPercent?: number | null; diskPercent?: number | null; memoryUsedKb?: number; memoryTotalKb?: number; diskUsedKb?: number; diskTotalKb?: number; rxBytesPerSec?: number; txBytesPerSec?: number } | null; error?: string }>
      sshWrite: (payload: { sessionId: string; data: string }) => Promise<{ ok: boolean; error?: string }>
      sshResize: (payload: { sessionId: string; cols: number; rows: number }) => Promise<{ ok: boolean; error?: string }>
      sshDisconnect: (payload: { sessionId: string }) => Promise<{ ok: boolean; error?: string }>
      onSshData: (handler: (data: { sessionId: string; data: string; dataBase64?: string }) => void) => void
      onSshClose: (handler: (data: { sessionId: string }) => void) => void
      onSshError: (handler: (data: { sessionId: string; error: string }) => void) => void

      onSftpProgress: (handler: (data: { type: 'upload' | 'download'; percent: number; transferred?: number; total?: number; done?: boolean }) => void) => void
      localfsList: (payload: { localPath?: string }) => Promise<{ ok: boolean; error?: string; path?: string; items?: any[] }>
      sftpList: (payload: SSHConfig & { remotePath?: string }) => Promise<{ ok: boolean; error?: string; items?: any[] }>
      sftpUpload: (payload: SSHConfig & { remoteDir?: string; localFile?: string; conflictPolicy?: 'overwrite' | 'resume' | 'skip' | 'rename'; resume?: boolean; remoteFileName?: string }) => Promise<{ ok: boolean; error?: string; localFile?: string; remoteFile?: string; skipped?: boolean; resumedFrom?: number }>
      sftpDownload: (payload: SSHConfig & { remoteFile: string; conflictPolicy?: 'overwrite' | 'resume' | 'skip' | 'rename'; resume?: boolean }) => Promise<{ ok: boolean; error?: string; filePath?: string; skipped?: boolean; resumedFrom?: number }>
      sftpDownloadToLocal: (payload: SSHConfig & { remoteFile: string; localDir: string; filename?: string; conflictPolicy?: 'overwrite' | 'resume' | 'skip' | 'rename'; resume?: boolean }) => Promise<{ ok: boolean; error?: string; filePath?: string; skipped?: boolean; resumedFrom?: number }>
      sftpMkdir: (payload: SSHConfig & { remoteDir: string }) => Promise<{ ok: boolean; error?: string }>
      sftpRename: (payload: SSHConfig & { oldPath: string; newPath: string }) => Promise<{ ok: boolean; error?: string }>
      sftpDelete: (payload: SSHConfig & { remoteFile: string }) => Promise<{ ok: boolean; error?: string }>
    }
  }
}

export {}
