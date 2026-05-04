use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

const STORAGE_FILE_NAME: &str = "astrashell.data.json";
const APP_SETTINGS_FILE_NAME: &str = "astrashell.settings.json";
const STORAGE_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct AppStore {
    version: u32,
    file_id: String,
    revision: u64,
    updated_at: u64,
    hosts: Vec<HostItem>,
    host_categories: Vec<String>,
    snippets: SnippetState,
    quicktools: QuicktoolsState,
    vault: VaultState,
    audit_logs: Vec<AuditLogItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct AppSettings {
    storage_path: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct VaultRuntimeState {
    unlocked: bool,
    key: Option<Vec<u8>>,
}

pub type VaultRuntime = Arc<Mutex<VaultRuntimeState>>;

pub fn default_vault_runtime_state() -> VaultRuntimeState {
    VaultRuntimeState::default()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct SnippetState {
    items: Vec<SnippetItem>,
    extra_categories: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct QuicktoolsState {
    items: Vec<QuicktoolItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct VaultState {
    requires_password: bool,
    initialized: bool,
    salt: String,
    password_hash: String,
    encrypted_keys: String,
    keys: Vec<VaultKeyItem>,
}

impl Default for VaultState {
    fn default() -> Self {
        Self {
            requires_password: true,
            initialized: false,
            salt: String::new(),
            password_hash: String::new(),
            encrypted_keys: String::new(),
            keys: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostItem {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub category: String,
    #[serde(rename = "auth_type")]
    pub auth_type: String,
    #[serde(rename = "private_key_ref")]
    pub private_key_ref: String,
    #[serde(rename = "purchaseDate")]
    pub purchase_date: String,
    #[serde(rename = "expiryDate")]
    pub expiry_date: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HostSavePayload {
    pub id: Option<String>,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub category: String,
    #[serde(rename = "authType", alias = "auth_type", default)]
    pub auth_type: String,
    #[serde(rename = "privateKeyRef", alias = "private_key_ref", default)]
    pub private_key_ref: Option<String>,
    #[serde(rename = "purchaseDate", alias = "purchase_date", default)]
    pub purchase_date: String,
    #[serde(rename = "expiryDate", alias = "expiry_date", default)]
    pub expiry_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostsListResponse {
    pub ok: bool,
    pub items: Vec<HostItem>,
    #[serde(rename = "extraCategories")]
    pub extra_categories: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenericOkResponse {
    pub ok: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditLogItem {
    pub id: String,
    pub ts: u64,
    pub source: String,
    pub action: String,
    pub target: String,
    pub content: String,
    pub level: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AuditListPayload {
    pub limit: Option<usize>,
    pub source: Option<String>,
    pub keyword: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditAppendPayload {
    pub source: String,
    pub action: String,
    pub target: Option<String>,
    pub content: Option<String>,
    pub level: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditListResponse {
    pub ok: bool,
    pub items: Vec<AuditLogItem>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditAppendResponse {
    pub ok: bool,
    pub item: AuditLogItem,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostsSaveResponse {
    pub ok: bool,
    pub id: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdPayload {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetCategoriesPayload {
    #[serde(rename = "extraCategories")]
    pub extra_categories: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoriesResponse {
    pub ok: bool,
    #[serde(rename = "extraCategories")]
    pub extra_categories: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnippetItem {
    pub id: String,
    pub name: String,
    pub category: String,
    #[serde(rename = "hostId")]
    pub host_id: String,
    pub description: String,
    pub commands: String,
    #[serde(rename = "reminderDate")]
    pub reminder_date: String,
    #[serde(rename = "lastRunAt")]
    pub last_run_at: u64,
    #[serde(rename = "lastRunStatus")]
    pub last_run_status: String,
    #[serde(rename = "lastRunOutput")]
    pub last_run_output: String,
    #[serde(rename = "createdAt")]
    pub created_at: u64,
    #[serde(rename = "updatedAt")]
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnippetStatePayload {
    pub items: Vec<SnippetItem>,
    #[serde(rename = "extraCategories")]
    pub extra_categories: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnippetStateResponse {
    pub ok: bool,
    pub items: Vec<SnippetItem>,
    #[serde(rename = "extraCategories")]
    pub extra_categories: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuicktoolItem {
    pub id: String,
    pub category: String,
    pub label: String,
    pub cmd: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuicktoolsPayload {
    pub items: Vec<QuicktoolItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuicktoolsResponse {
    pub ok: bool,
    pub items: Vec<QuicktoolItem>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultStatusResponse {
    pub ok: bool,
    pub configured: bool,
    pub exists: bool,
    pub initialized: bool,
    pub unlocked: bool,
    #[serde(rename = "requiresPassword")]
    pub requires_password: bool,
    #[serde(rename = "decryptFailed")]
    pub decrypt_failed: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultKeyItem {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub key_type: String,
    pub fingerprint: String,
    #[serde(rename = "privateKey")]
    pub private_key: String,
    #[serde(rename = "publicKey")]
    pub public_key: String,
    pub certificate: String,
    #[serde(rename = "updated_at")]
    pub updated_at: u64,
    #[serde(rename = "created_at")]
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VaultKeySavePayload {
    pub id: Option<String>,
    pub name: String,
    #[serde(rename = "type", default)]
    pub key_type: String,
    #[serde(rename = "privateKey", default)]
    pub private_key: String,
    #[serde(rename = "publicKey", default)]
    pub public_key: String,
    #[serde(default)]
    pub certificate: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultKeyListResponse {
    pub ok: bool,
    pub items: Vec<VaultKeyItem>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultKeyGetResponse {
    pub ok: bool,
    pub item: Option<VaultKeyItem>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultKeySaveResponse {
    pub ok: bool,
    pub id: String,
    #[serde(rename = "detectedType")]
    pub detected_type: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppStorageResponse {
    pub ok: bool,
    pub configured: bool,
    #[serde(rename = "dbPath")]
    pub db_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoragePathResponse {
    pub ok: bool,
    pub folder: Option<String>,
    #[serde(rename = "filePath")]
    pub file_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetStorageFolderPayload {
    pub folder: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetStorageFolderResponse {
    pub ok: bool,
    #[serde(rename = "dbPath")]
    pub db_path: String,
    #[serde(rename = "restartRequired")]
    pub restart_required: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupItem {
    pub name: String,
    pub path: String,
    pub size: u64,
    #[serde(rename = "mtimeMs")]
    pub mtime_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupListResponse {
    pub ok: bool,
    pub items: Vec<BackupItem>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateBackupResponse {
    pub ok: bool,
    #[serde(rename = "backupPath")]
    pub backup_path: Option<String>,
    pub count: Option<usize>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreBackupPayload {
    #[serde(rename = "backupPath")]
    pub backup_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreBackupResponse {
    pub ok: bool,
    #[serde(rename = "dbPath")]
    pub db_path: Option<String>,
    #[serde(rename = "restartRequired")]
    pub restart_required: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenBackupsFolderResponse {
    pub ok: bool,
    pub path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultMasterPayload {
    #[serde(rename = "masterPassword")]
    pub master_password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultImportFileResponse {
    pub ok: bool,
    pub content: Option<String>,
    #[serde(rename = "detectedType")]
    pub detected_type: Option<String>,
    #[serde(rename = "filePath")]
    pub file_path: Option<String>,
    pub raw: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppStorageMetaResponse {
    pub ok: bool,
    pub configured: bool,
    #[serde(rename = "dbPath")]
    pub db_path: String,
    pub exists: bool,
    pub size: u64,
    #[serde(rename = "mtimeMs")]
    pub mtime_ms: u64,
    #[serde(rename = "storageVersion")]
    pub storage_version: u32,
    #[serde(rename = "fileId")]
    pub file_id: String,
    pub revision: u64,
    pub signature: String,
    pub hosts: usize,
    pub snippets: usize,
    #[serde(rename = "vaultKeys")]
    pub vault_keys: usize,
    #[serde(rename = "quickTools")]
    pub quick_tools: usize,
    pub logs: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppRefreshStorageResponse {
    pub ok: bool,
    pub changed: bool,
    pub configured: bool,
    #[serde(rename = "dbPath")]
    pub db_path: String,
    pub exists: bool,
    pub size: u64,
    #[serde(rename = "mtimeMs")]
    pub mtime_ms: u64,
    #[serde(rename = "storageVersion")]
    pub storage_version: u32,
    #[serde(rename = "fileId")]
    pub file_id: String,
    pub revision: u64,
    pub signature: String,
    pub hosts: usize,
    pub snippets: usize,
    #[serde(rename = "vaultKeys")]
    pub vault_keys: usize,
    #[serde(rename = "quickTools")]
    pub quick_tools: usize,
    pub logs: usize,
    pub error: Option<String>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn storage_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法读取应用数据目录: {}", e))?;
    Ok(dir)
}

fn settings_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(storage_dir(app)?.join(APP_SETTINGS_FILE_NAME))
}

fn read_settings(app: &AppHandle) -> Result<AppSettings, String> {
    let path = settings_file(app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("无法读取应用设置: {}", e))?;
    serde_json::from_str(&raw).map_err(|e| format!("无法解析应用设置: {}", e))
}

fn write_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_file(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("无法创建设置目录: {}", e))?;
    }
    let raw = serde_json::to_string_pretty(settings).map_err(|e| format!("无法序列化应用设置: {}", e))?;
    fs::write(path, raw).map_err(|e| format!("无法写入应用设置: {}", e))
}

fn normalize_storage_path(raw: &str) -> PathBuf {
    let trimmed = raw.trim();
    if trimmed.ends_with(".json") || trimmed.ends_with(".db") {
        PathBuf::from(trimmed)
    } else {
        PathBuf::from(trimmed).join(STORAGE_FILE_NAME)
    }
}

fn storage_file(app: &AppHandle) -> Result<PathBuf, String> {
    let settings = read_settings(app)?;
    if let Some(path) = settings.storage_path {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }
    Ok(storage_dir(app)?.join(STORAGE_FILE_NAME))
}

fn backups_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(storage_dir(app)?.join("backups"))
}

fn default_store() -> AppStore {
    AppStore {
        version: STORAGE_VERSION,
        file_id: Uuid::new_v4().to_string(),
        revision: 0,
        updated_at: now_ms(),
        hosts: Vec::new(),
        host_categories: Vec::new(),
        snippets: SnippetState::default(),
        quicktools: QuicktoolsState::default(),
        vault: VaultState::default(),
        audit_logs: Vec::new(),
    }
}

fn ensure_store(app: &AppHandle) -> Result<(PathBuf, AppStore), String> {
    let path = storage_file(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("无法创建数据目录: {}", e))?;
    }
    if !path.exists() {
        let store = default_store();
        persist_store(&path, &store)?;
        return Ok((path, store));
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("无法读取数据文件: {}", e))?;
    let mut store: AppStore = serde_json::from_str(&raw).map_err(|e| format!("无法解析数据文件: {}", e))?;
    if store.version == 0 {
        store.version = STORAGE_VERSION;
    }
    if store.file_id.trim().is_empty() {
        store.file_id = Uuid::new_v4().to_string();
    }
    if !store.vault.requires_password
        && store.vault.salt.trim().is_empty()
        && store.vault.password_hash.trim().is_empty()
        && store.vault.encrypted_keys.trim().is_empty()
    {
        store.vault.requires_password = true;
        store.vault.initialized = false;
    }
    if store.vault.requires_password && store.vault.initialized && store.vault.encrypted_keys.is_empty() {
        store.vault.initialized = false;
    }
    Ok((path, store))
}

fn persist_store(path: &PathBuf, store: &AppStore) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(store).map_err(|e| format!("无法序列化数据文件: {}", e))?;
    fs::write(path, raw).map_err(|e| format!("无法写入数据文件: {}", e))
}

fn save_store(app: &AppHandle, mut store: AppStore) -> Result<AppStore, String> {
    let path = storage_file(app)?;
    store.version = STORAGE_VERSION;
    store.revision += 1;
    store.updated_at = now_ms();
    persist_store(&path, &store)?;
    Ok(store)
}

fn random_bytes_12() -> [u8; 12] {
    let digest = Sha256::digest(format!("{}-{}", Uuid::new_v4(), now_ms()).as_bytes());
    let mut out = [0u8; 12];
    out.copy_from_slice(&digest[..12]);
    out
}

fn derive_vault_key(password: &str, salt: &str) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(salt.as_bytes());
    hasher.update(password.as_bytes());
    hasher.finalize().to_vec()
}

fn derive_password_hash(password: &str, salt: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"vault-check");
    hasher.update(salt.as_bytes());
    hasher.update(password.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn encrypt_vault_keys(keys: &[VaultKeyItem], key: &[u8]) -> Result<String, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| format!("创建加密器失败: {}", e))?;
    let nonce_bytes = random_bytes_12();
    let nonce = Nonce::from_slice(&nonce_bytes);
    let plaintext = serde_json::to_vec(keys).map_err(|e| format!("无法序列化密钥: {}", e))?;
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_ref())
        .map_err(|e| format!("密钥加密失败: {}", e))?;
    Ok(format!(
        "{}:{}",
        BASE64.encode(nonce_bytes),
        BASE64.encode(ciphertext)
    ))
}

fn decrypt_vault_keys(blob: &str, key: &[u8]) -> Result<Vec<VaultKeyItem>, String> {
    if blob.trim().is_empty() {
        return Ok(Vec::new());
    }
    let (nonce_b64, cipher_b64) = blob
        .split_once(':')
        .ok_or("密钥数据格式无效")?;
    let nonce_bytes = BASE64.decode(nonce_b64).map_err(|e| format!("解码密钥 nonce 失败: {}", e))?;
    let cipher_bytes = BASE64.decode(cipher_b64).map_err(|e| format!("解码密钥数据失败: {}", e))?;
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| format!("创建解密器失败: {}", e))?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&nonce_bytes), cipher_bytes.as_ref())
        .map_err(|_| "主密码错误或密钥数据已损坏".to_string())?;
    serde_json::from_slice(&plaintext).map_err(|e| format!("无法解析解密后的密钥数据: {}", e))
}

fn vault_keys_from_store(store: &AppStore, runtime: &VaultRuntimeState) -> Result<Vec<VaultKeyItem>, String> {
    if !store.vault.requires_password {
        return Ok(store.vault.keys.clone());
    }
    let key = runtime
        .key
        .as_ref()
        .ok_or("请先解锁密钥仓库")?;
    decrypt_vault_keys(&store.vault.encrypted_keys, key)
}

fn write_vault_keys_to_store(store: &mut AppStore, runtime: &VaultRuntimeState, keys: Vec<VaultKeyItem>) -> Result<(), String> {
    if !store.vault.requires_password {
        store.vault.keys = keys;
        return Ok(());
    }
    let key = runtime
        .key
        .as_ref()
        .ok_or("请先解锁密钥仓库")?;
    store.vault.encrypted_keys = encrypt_vault_keys(&keys, key)?;
    store.vault.keys.clear();
    Ok(())
}

fn store_signature(store: &AppStore) -> Result<String, String> {
    let raw = serde_json::to_vec(store).map_err(|e| format!("无法计算数据签名: {}", e))?;
    let digest = Sha256::digest(raw);
    Ok(format!("sha256:{:x}", digest))
}

fn detect_key_type(payload: &VaultKeySavePayload) -> String {
    if !payload.key_type.trim().is_empty() && payload.key_type != "auto" {
        return payload.key_type.clone();
    }
    let private_key = payload.private_key.trim();
    if private_key.contains("BEGIN OPENSSH PRIVATE KEY") {
        return "openssh".to_string();
    }
    if private_key.contains("BEGIN RSA PRIVATE KEY") || private_key.contains("BEGIN PRIVATE KEY") {
        return "pem".to_string();
    }
    if private_key.starts_with("PuTTY-User-Key-File-") {
        return "ppk".to_string();
    }
    if !payload.certificate.trim().is_empty() {
        return "certificate".to_string();
    }
    if !payload.public_key.trim().is_empty() && payload.private_key.trim().is_empty() {
        return "public".to_string();
    }
    "bundle".to_string()
}

fn fingerprint_of(payload: &VaultKeySavePayload) -> String {
    let source = if !payload.public_key.trim().is_empty() {
        payload.public_key.trim().as_bytes().to_vec()
    } else if !payload.private_key.trim().is_empty() {
        payload.private_key.trim().as_bytes().to_vec()
    } else {
        payload.certificate.trim().as_bytes().to_vec()
    };
    let digest = Sha256::digest(source);
    format!("{:x}", digest)[..16].to_string()
}

fn build_storage_meta(path: &PathBuf, store: &AppStore) -> Result<AppStorageMetaResponse, String> {
    let metadata = fs::metadata(path).map_err(|e| format!("无法读取数据文件元信息: {}", e))?;
    let mtime_ms = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    Ok(AppStorageMetaResponse {
        ok: true,
        configured: true,
        db_path: path.to_string_lossy().to_string(),
        exists: path.exists(),
        size: metadata.len(),
        mtime_ms,
        storage_version: store.version,
        file_id: store.file_id.clone(),
        revision: store.revision,
        signature: store_signature(store)?,
        hosts: store.hosts.len(),
        snippets: store.snippets.items.len(),
        vault_keys: store.vault.keys.len(),
        quick_tools: store.quicktools.items.len(),
        logs: store.audit_logs.len(),
    })
}

#[tauri::command]
pub async fn app_get_storage(app: AppHandle) -> Result<AppStorageResponse, String> {
    let (path, _) = ensure_store(&app)?;
    Ok(AppStorageResponse {
        ok: true,
        configured: true,
        db_path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn app_get_storage_meta(app: AppHandle) -> Result<AppStorageMetaResponse, String> {
    let (path, store) = ensure_store(&app)?;
    build_storage_meta(&path, &store)
}

#[tauri::command]
pub async fn app_refresh_storage_data(app: AppHandle) -> Result<AppRefreshStorageResponse, String> {
    let (path, store) = ensure_store(&app)?;
    let meta = build_storage_meta(&path, &store)?;
    Ok(AppRefreshStorageResponse {
        ok: true,
        changed: false,
        configured: meta.configured,
        db_path: meta.db_path,
        exists: meta.exists,
        size: meta.size,
        mtime_ms: meta.mtime_ms,
        storage_version: meta.storage_version,
        file_id: meta.file_id,
        revision: meta.revision,
        signature: meta.signature,
        hosts: meta.hosts,
        snippets: meta.snippets,
        vault_keys: meta.vault_keys,
        quick_tools: meta.quick_tools,
        logs: meta.logs,
        error: None,
    })
}

#[tauri::command]
pub async fn app_pick_storage_folder(app: AppHandle) -> Result<StoragePathResponse, String> {
    let folder = app.dialog().file().blocking_pick_folder();
    let ok = folder.is_some();
    Ok(StoragePathResponse {
        ok,
        folder: folder.map(|value| value.to_string()),
        file_path: None,
        error: if ok { None } else { Some("已取消".to_string()) },
    })
}

#[tauri::command]
pub async fn app_pick_storage_file(app: AppHandle) -> Result<StoragePathResponse, String> {
    let file_path = app.dialog().file().blocking_pick_file();
    let ok = file_path.is_some();
    Ok(StoragePathResponse {
        ok,
        folder: None,
        file_path: file_path.map(|value| value.to_string()),
        error: if ok { None } else { Some("已取消".to_string()) },
    })
}

#[tauri::command]
pub async fn app_pick_storage_save_file(app: AppHandle) -> Result<StoragePathResponse, String> {
    let file_path = app
        .dialog()
        .file()
        .set_file_name(STORAGE_FILE_NAME)
        .blocking_save_file();
    let ok = file_path.is_some();
    Ok(StoragePathResponse {
        ok,
        folder: None,
        file_path: file_path.map(|value| value.to_string()),
        error: if ok { None } else { Some("已取消".to_string()) },
    })
}

#[tauri::command]
pub async fn app_set_storage_folder(app: AppHandle, payload: SetStorageFolderPayload) -> Result<SetStorageFolderResponse, String> {
    let target_path = normalize_storage_path(&payload.folder);
    let current_path = storage_file(&app)?;

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("无法创建目标数据目录: {}", e))?;
    }

    if current_path != target_path && current_path.exists() && !target_path.exists() {
        fs::copy(&current_path, &target_path).map_err(|e| format!("无法复制现有数据文件: {}", e))?;
    }
    if !target_path.exists() {
        persist_store(&target_path, &default_store())?;
    }

    write_settings(
        &app,
        &AppSettings {
            storage_path: Some(target_path.to_string_lossy().to_string()),
        },
    )?;
    let _ = app.emit("storage:data-changed", serde_json::json!({ "changedAt": now_ms() }));

    Ok(SetStorageFolderResponse {
        ok: true,
        db_path: target_path.to_string_lossy().to_string(),
        restart_required: false,
        error: None,
    })
}

#[tauri::command]
pub async fn app_create_backup(app: AppHandle) -> Result<CreateBackupResponse, String> {
    let source_path = storage_file(&app)?;
    let backups_dir = backups_dir(&app)?;
    fs::create_dir_all(&backups_dir).map_err(|e| format!("无法创建备份目录: {}", e))?;
    let backup_name = format!("astrashell-backup-{}.json", now_ms());
    let backup_path = backups_dir.join(backup_name);
    fs::copy(&source_path, &backup_path).map_err(|e| format!("无法创建备份: {}", e))?;

    Ok(CreateBackupResponse {
        ok: true,
        backup_path: Some(backup_path.to_string_lossy().to_string()),
        count: Some(1),
        error: None,
    })
}

#[tauri::command]
pub async fn app_list_backups(app: AppHandle) -> Result<BackupListResponse, String> {
    let dir = backups_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建备份目录: {}", e))?;
    let mut items = Vec::new();

    for entry in fs::read_dir(&dir).map_err(|e| format!("无法读取备份目录: {}", e))? {
        let entry = match entry {
            Ok(value) => value,
            Err(_) => continue,
        };
        let path = entry.path();
        let metadata = match entry.metadata() {
            Ok(value) => value,
            Err(_) => continue,
        };
        let mtime_ms = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        items.push(BackupItem {
            name: entry.file_name().to_string_lossy().to_string(),
            path: path.to_string_lossy().to_string(),
            size: metadata.len(),
            mtime_ms,
        });
    }

    items.sort_by(|a, b| b.mtime_ms.cmp(&a.mtime_ms));
    Ok(BackupListResponse { ok: true, items, error: None })
}

#[tauri::command]
pub async fn app_restore_backup(app: AppHandle, payload: RestoreBackupPayload) -> Result<RestoreBackupResponse, String> {
    let backup_path = PathBuf::from(payload.backup_path.trim());
    let target_path = storage_file(&app)?;
    if !backup_path.exists() {
        return Ok(RestoreBackupResponse {
            ok: false,
            db_path: None,
            restart_required: false,
            error: Some("备份文件不存在".to_string()),
        });
    }
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("无法创建数据目录: {}", e))?;
    }
    fs::copy(&backup_path, &target_path).map_err(|e| format!("恢复备份失败: {}", e))?;
    let _ = app.emit("storage:data-changed", serde_json::json!({ "changedAt": now_ms() }));
    Ok(RestoreBackupResponse {
        ok: true,
        db_path: Some(target_path.to_string_lossy().to_string()),
        restart_required: false,
        error: None,
    })
}

#[tauri::command]
pub async fn app_open_backups_folder(app: AppHandle) -> Result<OpenBackupsFolderResponse, String> {
    let path = backups_dir(&app)?;
    fs::create_dir_all(&path).map_err(|e| format!("无法创建备份目录: {}", e))?;
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("无法打开备份目录: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("无法打开备份目录: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("无法打开备份目录: {}", e))?;
    }
    Ok(OpenBackupsFolderResponse {
        ok: true,
        path: Some(path.to_string_lossy().to_string()),
        error: None,
    })
}

#[tauri::command]
pub async fn hosts_list(app: AppHandle) -> Result<HostsListResponse, String> {
    let (_, store) = ensure_store(&app)?;
    Ok(HostsListResponse {
        ok: true,
        items: store.hosts,
        extra_categories: store.host_categories,
    })
}

#[tauri::command]
pub async fn hosts_save(app: AppHandle, payload: HostSavePayload) -> Result<HostsSaveResponse, String> {
    let (_, mut store) = ensure_store(&app)?;
    let now = now_ms();
    let host_id = payload.id.clone().unwrap_or_else(|| Uuid::new_v4().to_string());
    let item = HostItem {
        id: host_id.clone(),
        name: payload.name.trim().to_string(),
        host: payload.host.trim().to_string(),
        port: if payload.port == 0 { 22 } else { payload.port },
        username: payload.username.trim().to_string(),
        password: payload.password,
        category: if payload.category.trim().is_empty() {
            "默认".to_string()
        } else {
            payload.category.trim().to_string()
        },
        auth_type: if payload.auth_type.trim().is_empty() {
            "password".to_string()
        } else {
            payload.auth_type.trim().to_string()
        },
        private_key_ref: payload.private_key_ref.unwrap_or_default(),
        purchase_date: payload.purchase_date,
        expiry_date: payload.expiry_date,
        updated_at: now,
    };

    match store.hosts.iter_mut().find(|current| current.id == host_id) {
        Some(current) => *current = item.clone(),
        None => store.hosts.push(item.clone()),
    }
    if !item.category.trim().is_empty() && !store.host_categories.contains(&item.category) && item.category != "默认" {
        store.host_categories.push(item.category.clone());
        store.host_categories.sort();
    }
    let _ = save_store(&app, store)?;
    Ok(HostsSaveResponse {
        ok: true,
        id: host_id,
        error: None,
    })
}

#[tauri::command]
pub async fn hosts_delete(app: AppHandle, payload: IdPayload) -> Result<GenericOkResponse, String> {
    let (_, mut store) = ensure_store(&app)?;
    store.hosts.retain(|item| item.id != payload.id);
    let _ = save_store(&app, store)?;
    Ok(GenericOkResponse { ok: true, error: None })
}

#[tauri::command]
pub async fn hosts_set_categories(app: AppHandle, payload: SetCategoriesPayload) -> Result<CategoriesResponse, String> {
    let (_, mut store) = ensure_store(&app)?;
    store.host_categories = payload
        .extra_categories
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value != "默认" && value != "全部")
        .collect();
    store.host_categories.sort();
    store.host_categories.dedup();
    let saved = save_store(&app, store)?;
    Ok(CategoriesResponse {
        ok: true,
        extra_categories: saved.host_categories,
        error: None,
    })
}

#[tauri::command]
pub async fn snippets_get_state(app: AppHandle) -> Result<SnippetStateResponse, String> {
    let (_, store) = ensure_store(&app)?;
    Ok(SnippetStateResponse {
        ok: true,
        items: store.snippets.items,
        extra_categories: store.snippets.extra_categories,
        error: None,
    })
}

#[tauri::command]
pub async fn snippets_set_state(app: AppHandle, payload: SnippetStatePayload) -> Result<SnippetStateResponse, String> {
    let (_, mut store) = ensure_store(&app)?;
    store.snippets = SnippetState {
        items: payload.items,
        extra_categories: payload
            .extra_categories
            .into_iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect(),
    };
    let saved = save_store(&app, store)?;
    Ok(SnippetStateResponse {
        ok: true,
        items: saved.snippets.items,
        extra_categories: saved.snippets.extra_categories,
        error: None,
    })
}

#[tauri::command]
pub async fn quicktools_get_state(app: AppHandle) -> Result<QuicktoolsResponse, String> {
    let (_, store) = ensure_store(&app)?;
    Ok(QuicktoolsResponse {
        ok: true,
        items: store.quicktools.items,
        error: None,
    })
}

#[tauri::command]
pub async fn quicktools_set_state(app: AppHandle, payload: QuicktoolsPayload) -> Result<QuicktoolsResponse, String> {
    let (_, mut store) = ensure_store(&app)?;
    store.quicktools.items = payload.items;
    let saved = save_store(&app, store)?;
    Ok(QuicktoolsResponse {
        ok: true,
        items: saved.quicktools.items,
        error: None,
    })
}

#[tauri::command]
pub async fn vault_status(app: AppHandle, runtime: State<'_, VaultRuntime>) -> Result<VaultStatusResponse, String> {
    let (path, store) = ensure_store(&app)?;
    let runtime = runtime.lock().unwrap();
    Ok(VaultStatusResponse {
        ok: true,
        configured: true,
        exists: path.exists(),
        initialized: store.vault.initialized,
        unlocked: !store.vault.requires_password || runtime.unlocked,
        requires_password: store.vault.requires_password,
        decrypt_failed: false,
        error: None,
    })
}

#[tauri::command]
pub async fn vault_set_master(
    app: AppHandle,
    payload: VaultMasterPayload,
    runtime: State<'_, VaultRuntime>,
) -> Result<GenericOkResponse, String> {
    if payload.master_password.trim().is_empty() {
        return Ok(GenericOkResponse {
            ok: false,
            error: Some("主密码不能为空".to_string()),
        });
    }
    let (_, mut store) = ensure_store(&app)?;
    let mut runtime = runtime.lock().unwrap();
    let existing_keys = if store.vault.requires_password && runtime.unlocked {
        vault_keys_from_store(&store, &runtime).unwrap_or_default()
    } else {
        store.vault.keys.clone()
    };
    let salt = Uuid::new_v4().to_string();
    let key = derive_vault_key(&payload.master_password, &salt);
    let encrypted_keys = encrypt_vault_keys(&existing_keys, &key)?;
    store.vault.requires_password = true;
    store.vault.initialized = true;
    store.vault.salt = salt.clone();
    store.vault.password_hash = derive_password_hash(&payload.master_password, &salt);
    store.vault.encrypted_keys = encrypted_keys;
    store.vault.keys.clear();
    let _ = save_store(&app, store)?;
    runtime.unlocked = true;
    runtime.key = Some(key);
    Ok(GenericOkResponse { ok: true, error: None })
}

#[tauri::command]
pub async fn vault_unlock(
    app: AppHandle,
    payload: VaultMasterPayload,
    runtime: State<'_, VaultRuntime>,
) -> Result<GenericOkResponse, String> {
    let (_, store) = ensure_store(&app)?;
    if !store.vault.requires_password {
        let mut runtime = runtime.lock().unwrap();
        runtime.unlocked = true;
        runtime.key = None;
        return Ok(GenericOkResponse { ok: true, error: None });
    }
    if store.vault.salt.trim().is_empty() || store.vault.password_hash.trim().is_empty() {
        return Ok(GenericOkResponse {
            ok: false,
            error: Some("密钥仓库尚未初始化".to_string()),
        });
    }
    let key = derive_vault_key(&payload.master_password, &store.vault.salt);
    let password_hash = derive_password_hash(&payload.master_password, &store.vault.salt);
    if password_hash != store.vault.password_hash {
        return Ok(GenericOkResponse {
            ok: false,
            error: Some("主密码错误".to_string()),
        });
    }
    let _ = decrypt_vault_keys(&store.vault.encrypted_keys, &key)?;
    let mut runtime = runtime.lock().unwrap();
    runtime.unlocked = true;
    runtime.key = Some(key);
    Ok(GenericOkResponse { ok: true, error: None })
}

#[tauri::command]
pub async fn vault_reset(app: AppHandle, runtime: State<'_, VaultRuntime>) -> Result<GenericOkResponse, String> {
    let (_, mut store) = ensure_store(&app)?;
    if store.vault.requires_password {
        store.vault.initialized = false;
        store.vault.salt.clear();
        store.vault.password_hash.clear();
        store.vault.encrypted_keys.clear();
        store.vault.keys.clear();
    } else {
        store.vault.keys.clear();
    }
    let _ = save_store(&app, store)?;
    let mut runtime = runtime.lock().unwrap();
    runtime.unlocked = false;
    runtime.key = None;
    Ok(GenericOkResponse { ok: true, error: None })
}

#[tauri::command]
pub async fn vault_key_list(app: AppHandle, runtime: State<'_, VaultRuntime>) -> Result<VaultKeyListResponse, String> {
    let (_, store) = ensure_store(&app)?;
    let runtime = runtime.lock().unwrap();
    let mut items = match vault_keys_from_store(&store, &runtime) {
        Ok(items) => items,
        Err(error) => {
            return Ok(VaultKeyListResponse {
                ok: false,
                items: Vec::new(),
                error: Some(error),
            });
        }
    };
    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(VaultKeyListResponse {
        ok: true,
        items,
        error: None,
    })
}

#[tauri::command]
pub async fn vault_key_get(
    app: AppHandle,
    payload: IdPayload,
    runtime: State<'_, VaultRuntime>,
) -> Result<VaultKeyGetResponse, String> {
    let (_, store) = ensure_store(&app)?;
    let runtime = runtime.lock().unwrap();
    let item = match vault_keys_from_store(&store, &runtime) {
        Ok(items) => items.into_iter().find(|entry| entry.id == payload.id),
        Err(error) => {
            return Ok(VaultKeyGetResponse {
                ok: false,
                item: None,
                error: Some(error),
            });
        }
    };
    Ok(VaultKeyGetResponse {
        ok: item.is_some(),
        item,
        error: None,
    })
}

#[tauri::command]
pub async fn vault_key_save(
    app: AppHandle,
    payload: VaultKeySavePayload,
    runtime: State<'_, VaultRuntime>,
) -> Result<VaultKeySaveResponse, String> {
    let (_, mut store) = ensure_store(&app)?;
    let now = now_ms();
    let detected_type = detect_key_type(&payload);
    let item_id = payload.id.clone().unwrap_or_else(|| Uuid::new_v4().to_string());
    let runtime = runtime.lock().unwrap();
    let mut items = match vault_keys_from_store(&store, &runtime) {
        Ok(items) => items,
        Err(error) => {
            return Ok(VaultKeySaveResponse {
                ok: false,
                id: String::new(),
                detected_type: String::new(),
                error: Some(error),
            });
        }
    };
    let created_at = items
        .iter()
        .find(|entry| entry.id == item_id)
        .map(|entry| entry.created_at)
        .unwrap_or(now);
    let item = VaultKeyItem {
        id: item_id.clone(),
        name: if payload.name.trim().is_empty() {
            "未命名密钥".to_string()
        } else {
            payload.name.trim().to_string()
        },
        key_type: detected_type.clone(),
        fingerprint: fingerprint_of(&payload),
        private_key: payload.private_key,
        public_key: payload.public_key,
        certificate: payload.certificate,
        updated_at: now,
        created_at,
    };
    match items.iter_mut().find(|entry| entry.id == item_id) {
        Some(current) => *current = item,
        None => items.push(item),
    }
    write_vault_keys_to_store(&mut store, &runtime, items)?;
    let _ = save_store(&app, store)?;
    Ok(VaultKeySaveResponse {
        ok: true,
        id: item_id,
        detected_type,
        error: None,
    })
}

#[tauri::command]
pub async fn vault_key_delete(app: AppHandle, payload: IdPayload, runtime: State<'_, VaultRuntime>) -> Result<GenericOkResponse, String> {
    let (_, mut store) = ensure_store(&app)?;
    let runtime = runtime.lock().unwrap();
    let mut items = match vault_keys_from_store(&store, &runtime) {
        Ok(items) => items,
        Err(error) => {
            return Ok(GenericOkResponse {
                ok: false,
                error: Some(error),
            });
        }
    };
    items.retain(|entry| entry.id != payload.id);
    write_vault_keys_to_store(&mut store, &runtime, items)?;
    let _ = save_store(&app, store)?;
    Ok(GenericOkResponse { ok: true, error: None })
}

#[tauri::command]
pub async fn vault_key_import_file(app: AppHandle) -> Result<VaultImportFileResponse, String> {
    let file_path = app.dialog().file().blocking_pick_file();
    let Some(file_path) = file_path else {
        return Ok(VaultImportFileResponse {
            ok: false,
            content: None,
            detected_type: None,
            file_path: None,
            raw: None,
            error: Some("已取消".to_string()),
        });
    };
    let path = PathBuf::from(file_path.to_string());
    let mut file = fs::File::open(&path).map_err(|e| format!("打开密钥文件失败: {}", e))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|e| format!("读取密钥文件失败: {}", e))?;
    let text = String::from_utf8_lossy(&bytes).to_string();
    let payload = VaultKeySavePayload {
        id: None,
        name: path.file_name().map(|v| v.to_string_lossy().to_string()).unwrap_or_default(),
        key_type: "auto".to_string(),
        private_key: text.clone(),
        public_key: String::new(),
        certificate: String::new(),
    };
    Ok(VaultImportFileResponse {
        ok: true,
        content: Some(text.clone()),
        detected_type: Some(detect_key_type(&payload)),
        file_path: Some(path.to_string_lossy().to_string()),
        raw: Some(text),
        error: None,
    })
}

#[tauri::command]
pub async fn audit_list(app: AppHandle, payload: Option<AuditListPayload>) -> Result<AuditListResponse, String> {
    let (_, store) = ensure_store(&app)?;
    let payload = payload.unwrap_or_default();
    let source = payload.source.unwrap_or_else(|| "all".to_string());
    let keyword = payload.keyword.unwrap_or_default().trim().to_lowercase();
    let limit = payload.limit.unwrap_or(1200);

    let mut items = store
        .audit_logs
        .into_iter()
        .filter(|item| {
            if source != "all" && item.source != source {
                return false;
            }
            if keyword.is_empty() {
                return true;
            }
            let haystack = format!("{} {} {}", item.target, item.content, item.action).to_lowercase();
            haystack.contains(&keyword)
        })
        .collect::<Vec<_>>();

    items.sort_by(|a, b| b.ts.cmp(&a.ts));
    if items.len() > limit {
        items.truncate(limit);
    }

    Ok(AuditListResponse {
        ok: true,
        items,
        error: None,
    })
}

#[tauri::command]
pub async fn audit_append(app: AppHandle, payload: AuditAppendPayload) -> Result<AuditAppendResponse, String> {
    let (_, mut store) = ensure_store(&app)?;
    let item = AuditLogItem {
        id: Uuid::new_v4().to_string(),
        ts: now_ms(),
        source: payload.source,
        action: payload.action,
        target: payload.target.unwrap_or_default(),
        content: payload.content.unwrap_or_default(),
        level: payload.level,
    };

    store.audit_logs.push(item.clone());
    if store.audit_logs.len() > 3000 {
        let remove_count = store.audit_logs.len() - 3000;
        store.audit_logs.drain(0..remove_count);
    }

    let _ = save_store(&app, store)?;
    let _ = app.emit("audit:appended", &item);

    Ok(AuditAppendResponse {
        ok: true,
        item,
        error: None,
    })
}

#[tauri::command]
pub async fn audit_clear(app: AppHandle) -> Result<GenericOkResponse, String> {
    let (_, mut store) = ensure_store(&app)?;
    store.audit_logs.clear();
    let _ = save_store(&app, store)?;
    Ok(GenericOkResponse { ok: true, error: None })
}
