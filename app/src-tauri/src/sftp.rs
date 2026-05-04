use serde::{Deserialize, Serialize};
use ssh2::Session as Ssh2Session;
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SftpConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String,
    pub password: Option<String>,
    pub private_key: Option<String>,
    pub passphrase: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SftpFileInfo {
    pub filename: String,
    pub path: String,
    pub size: u64,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    pub mtime: i64,
    #[serde(rename = "modifiedAt")]
    pub modified_at: i64,
    pub permissions: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SftpSessionData {
    pub config: SftpConfig,
}

#[derive(Debug, Clone, Serialize)]
pub struct SftpBasicResponse {
    pub ok: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SftpTransferResponse {
    pub ok: bool,
    #[serde(rename = "filePath")]
    pub file_path: Option<String>,
    #[serde(rename = "remoteFile")]
    pub remote_file: Option<String>,
    #[serde(rename = "remoteDir")]
    pub remote_dir: Option<String>,
    #[serde(rename = "folderMode")]
    pub folder_mode: bool,
    #[serde(rename = "uploadedFiles")]
    pub uploaded_files: usize,
    #[serde(rename = "uploadedDirs")]
    pub uploaded_dirs: usize,
    pub error: Option<String>,
}

pub type SftpSessions = Arc<Mutex<HashMap<String, SftpSessionData>>>;

fn connect_session(config: &SftpConfig) -> Result<Ssh2Session, String> {
    let tcp = TcpStream::connect(format!("{}:{}", config.host, config.port))
        .map_err(|e| format!("TCP连接失败: {}", e))?;
    let mut session = Ssh2Session::new().map_err(|e| format!("创建SSH会话失败: {}", e))?;
    session.set_tcp_stream(tcp);
    session.handshake().map_err(|e| format!("SSH握手失败: {}", e))?;

    match config.auth_type.as_str() {
        "password" => {
            let password = config.password.as_ref().ok_or("密码认证需要提供密码")?;
            session
                .userauth_password(&config.username, password)
                .map_err(|e| format!("密码认证失败: {}", e))?;
        }
        "key" => {
            let private_key = config.private_key.as_ref().ok_or("密钥认证需要提供私钥")?;
            session
                .userauth_pubkey_memory(
                    &config.username,
                    None,
                    private_key,
                    config.passphrase.as_deref(),
                )
                .map_err(|e| format!("密钥认证失败: {}", e))?;
        }
        _ => return Err(format!("不支持的认证类型: {}", config.auth_type)),
    }

    if !session.authenticated() {
        return Err("SSH认证失败".to_string());
    }
    Ok(session)
}

fn with_sftp_session<T>(
    session_id: &str,
    sessions: &State<'_, SftpSessions>,
    handler: impl FnOnce(&SftpConfig, ssh2::Sftp) -> Result<T, String>,
) -> Result<T, String> {
    let config = sessions
        .lock()
        .unwrap()
        .get(session_id)
        .cloned()
        .ok_or("SFTP会话不存在，请先连接")?
        .config;

    let session = connect_session(&config)?;
    let sftp = session.sftp().map_err(|e| format!("创建SFTP会话失败: {}", e))?;
    handler(&config, sftp)
}

fn basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "download.bin".to_string())
}

fn copy_with_progress<R: Read, W: Write>(
    mut reader: R,
    mut writer: W,
    total: u64,
    mut on_progress: impl FnMut(u64, u64),
) -> Result<u64, String> {
    let mut buffer = [0u8; 16 * 1024];
    let mut transferred = 0u64;
    loop {
        let read = reader.read(&mut buffer).map_err(|e| format!("读取失败: {}", e))?;
        if read == 0 {
            break;
        }
        writer
            .write_all(&buffer[..read])
            .map_err(|e| format!("写入失败: {}", e))?;
        transferred += read as u64;
        on_progress(transferred, total);
    }
    writer.flush().map_err(|e| format!("刷新写入失败: {}", e))?;
    Ok(transferred)
}

fn emit_progress(app: &AppHandle, kind: &str, transferred: u64, total: u64, done: bool) {
    let percent = if total > 0 {
        ((transferred as f64 / total as f64) * 100.0).round() as u64
    } else if done {
        100
    } else {
        0
    };
    let _ = app.emit(
        "sftp:progress",
        serde_json::json!({
            "type": kind,
            "percent": percent,
            "transferred": transferred,
            "total": total,
            "done": done
        }),
    );
}

fn upload_file(
    app: &AppHandle,
    sftp: &ssh2::Sftp,
    local_file: &Path,
    remote_file: &Path,
) -> Result<(), String> {
    let mut local = fs::File::open(local_file).map_err(|e| format!("打开本地文件失败: {}", e))?;
    let metadata = local.metadata().map_err(|e| format!("读取本地文件元信息失败: {}", e))?;
    let total = metadata.len();
    let mut remote = sftp
        .create(remote_file)
        .map_err(|e| format!("创建远程文件失败: {}", e))?;
    copy_with_progress(&mut local, &mut remote, total, |transferred, total| {
        emit_progress(app, "upload", transferred, total, false);
    })?;
    emit_progress(app, "upload", total, total, true);
    Ok(())
}

fn upload_dir_recursive(
    app: &AppHandle,
    sftp: &ssh2::Sftp,
    local_dir: &Path,
    remote_dir: &Path,
    counters: &mut (usize, usize),
) -> Result<(), String> {
    let _ = sftp.mkdir(remote_dir, 0o755);
    counters.1 += 1;
    for entry in fs::read_dir(local_dir).map_err(|e| format!("读取本地目录失败: {}", e))? {
        let entry = entry.map_err(|e| format!("读取本地目录项失败: {}", e))?;
        let local_path = entry.path();
        let remote_path = remote_dir.join(entry.file_name());
        if local_path.is_dir() {
            upload_dir_recursive(app, sftp, &local_path, &remote_path, counters)?;
        } else {
            upload_file(app, sftp, &local_path, &remote_path)?;
            counters.0 += 1;
        }
    }
    Ok(())
}

fn remove_dir_recursive(sftp: &ssh2::Sftp, path: &Path) -> Result<(), String> {
    for (child_path, stat) in sftp.readdir(path).map_err(|e| format!("读取远程目录失败: {}", e))? {
        let name = child_path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default();
        if name == "." || name == ".." {
            continue;
        }
        if stat.is_dir() {
            remove_dir_recursive(sftp, &child_path)?;
            sftp.rmdir(&child_path).map_err(|e| format!("删除远程目录失败: {}", e))?;
        } else {
            sftp.unlink(&child_path).map_err(|e| format!("删除远程文件失败: {}", e))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn sftp_connect(
    session_id: String,
    config: SftpConfig,
    sessions: State<'_, SftpSessions>,
) -> Result<String, String> {
    log::info!("SFTP connecting to {}@{}:{}", config.username, config.host, config.port);
    let _ = connect_session(&config)?;
    sessions.lock().unwrap().insert(session_id.clone(), SftpSessionData { config });
    Ok(session_id)
}

#[tauri::command]
pub async fn sftp_disconnect(
    session_id: String,
    sessions: State<'_, SftpSessions>,
) -> Result<SftpBasicResponse, String> {
    log::info!("SFTP disconnecting session: {}", session_id);
    sessions.lock().unwrap().remove(&session_id);
    Ok(SftpBasicResponse { ok: true, error: None })
}

#[tauri::command]
pub async fn sftp_list_dir(
    session_id: String,
    path: String,
    sessions: State<'_, SftpSessions>,
) -> Result<Vec<SftpFileInfo>, String> {
    log::debug!("SFTP list dir: {} in session {}", path, session_id);
    with_sftp_session(&session_id, &sessions, |_config, sftp| {
        let mut items = Vec::new();
        for (entry_path, stat) in sftp.readdir(Path::new(&path)).map_err(|e| format!("读取远程目录失败: {}", e))? {
            let name = entry_path
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_default();
            if name == "." || name == ".." {
                continue;
            }
            let resolved_stat = sftp.stat(&entry_path).unwrap_or(stat.clone());
            items.push(SftpFileInfo {
                filename: name,
                path: entry_path.to_string_lossy().to_string(),
                size: resolved_stat.size.unwrap_or(stat.size.unwrap_or(0)),
                is_dir: resolved_stat.is_dir() || stat.is_dir(),
                mtime: resolved_stat.mtime.unwrap_or(stat.mtime.unwrap_or(0)) as i64,
                modified_at: resolved_stat.mtime.unwrap_or(stat.mtime.unwrap_or(0)) as i64,
                permissions: resolved_stat
                    .perm
                    .or(stat.perm)
                    .map(|perm| format!("{perm:o}")),
            });
        }
        items.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.filename.to_lowercase().cmp(&b.filename.to_lowercase()),
        });
        Ok(items)
    })
}

#[tauri::command]
pub async fn sftp_upload(
    app: AppHandle,
    session_id: String,
    local_path: String,
    remote_path: String,
    sessions: State<'_, SftpSessions>,
) -> Result<SftpTransferResponse, String> {
    log::info!("SFTP upload from {} to {}", local_path, remote_path);
    with_sftp_session(&session_id, &sessions, |_config, sftp| {
        let local = PathBuf::from(local_path.trim());
        let remote = PathBuf::from(remote_path.trim());
        if !local.exists() {
            return Err("本地文件不存在".to_string());
        }
        if local.is_dir() {
            let remote_dir = remote.join(
                local.file_name()
                    .map(|value| value.to_string_lossy().to_string())
                    .unwrap_or_else(|| "folder".to_string()),
            );
            let mut counters = (0usize, 0usize);
            upload_dir_recursive(&app, &sftp, &local, &remote_dir, &mut counters)?;
            Ok(SftpTransferResponse {
                ok: true,
                file_path: None,
                remote_file: None,
                remote_dir: Some(remote_dir.to_string_lossy().to_string()),
                folder_mode: true,
                uploaded_files: counters.0,
                uploaded_dirs: counters.1,
                error: None,
            })
        } else {
            let remote_file = remote.join(
                local.file_name()
                    .map(|value| value.to_string_lossy().to_string())
                    .unwrap_or_else(|| "upload.bin".to_string()),
            );
            upload_file(&app, &sftp, &local, &remote_file)?;
            Ok(SftpTransferResponse {
                ok: true,
                file_path: None,
                remote_file: Some(remote_file.to_string_lossy().to_string()),
                remote_dir: Some(remote.to_string_lossy().to_string()),
                folder_mode: false,
                uploaded_files: 1,
                uploaded_dirs: 0,
                error: None,
            })
        }
    })
}

#[tauri::command]
pub async fn sftp_download(
    app: AppHandle,
    session_id: String,
    remote_path: String,
    local_path: String,
    sessions: State<'_, SftpSessions>,
) -> Result<SftpTransferResponse, String> {
    log::info!("SFTP download from {} to {}", remote_path, local_path);
    with_sftp_session(&session_id, &sessions, |_config, sftp| {
        let remote = PathBuf::from(remote_path.trim());
        let stat = sftp.stat(&remote).map_err(|e| format!("读取远程文件元信息失败: {}", e))?;
        if stat.is_dir() {
            return Err("暂不支持下载远程目录".to_string());
        }

        let target_path = if local_path.trim().is_empty() {
            let picked = app
                .dialog()
                .file()
                .set_file_name(&basename(remote_path.trim()))
                .blocking_save_file();
            let Some(path) = picked else {
                return Ok(SftpTransferResponse {
                    ok: false,
                    file_path: None,
                    remote_file: None,
                    remote_dir: None,
                    folder_mode: false,
                    uploaded_files: 0,
                    uploaded_dirs: 0,
                    error: Some("已取消".to_string()),
                });
            };
            PathBuf::from(path.to_string())
        } else {
            let base = PathBuf::from(local_path.trim());
            if base.is_dir() || !base.extension().is_some() {
                base.join(basename(remote_path.trim()))
            } else {
                base
            }
        };

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建本地目录失败: {}", e))?;
        }

        let mut remote_file = sftp.open(&remote).map_err(|e| format!("打开远程文件失败: {}", e))?;
        let mut local_file = fs::File::create(&target_path).map_err(|e| format!("创建本地文件失败: {}", e))?;
        let total = stat.size.unwrap_or(0);
        copy_with_progress(&mut remote_file, &mut local_file, total, |transferred, total| {
            emit_progress(&app, "download", transferred, total, false);
        })?;
        emit_progress(&app, "download", total, total, true);

        Ok(SftpTransferResponse {
            ok: true,
            file_path: Some(target_path.to_string_lossy().to_string()),
            remote_file: Some(remote.to_string_lossy().to_string()),
            remote_dir: None,
            folder_mode: false,
            uploaded_files: 0,
            uploaded_dirs: 0,
            error: None,
        })
    })
}

#[tauri::command]
pub async fn sftp_delete(
    session_id: String,
    path: String,
    sessions: State<'_, SftpSessions>,
) -> Result<SftpBasicResponse, String> {
    log::info!("SFTP delete: {}", path);
    with_sftp_session(&session_id, &sessions, |_config, sftp| {
        let target = PathBuf::from(path.trim());
        match sftp.unlink(&target) {
            Ok(_) => Ok(SftpBasicResponse { ok: true, error: None }),
            Err(_) => {
                remove_dir_recursive(&sftp, &target)?;
                sftp.rmdir(&target).map_err(|e| format!("删除目录失败: {}", e))?;
                Ok(SftpBasicResponse { ok: true, error: None })
            }
        }
    })
}

#[tauri::command]
pub async fn sftp_mkdir(
    session_id: String,
    path: String,
    sessions: State<'_, SftpSessions>,
) -> Result<SftpBasicResponse, String> {
    log::info!("SFTP mkdir: {}", path);
    with_sftp_session(&session_id, &sessions, |_config, sftp| {
        sftp.mkdir(Path::new(path.trim()), 0o755)
            .map_err(|e| format!("创建目录失败: {}", e))?;
        Ok(SftpBasicResponse { ok: true, error: None })
    })
}

#[tauri::command]
pub async fn sftp_rename(
    session_id: String,
    old_path: String,
    new_path: String,
    sessions: State<'_, SftpSessions>,
) -> Result<SftpBasicResponse, String> {
    log::info!("SFTP rename from {} to {}", old_path, new_path);
    with_sftp_session(&session_id, &sessions, |_config, sftp| {
        sftp.rename(Path::new(old_path.trim()), Path::new(new_path.trim()), None)
            .map_err(|e| format!("重命名失败: {}", e))?;
        Ok(SftpBasicResponse { ok: true, error: None })
    })
}
