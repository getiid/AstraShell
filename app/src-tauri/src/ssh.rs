use serde::{Deserialize, Serialize};
use ssh2::Session as Ssh2Session;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String, // "password" | "key"
    pub password: Option<String>,
    pub private_key: Option<String>,
    pub passphrase: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshSessionInfo {
    pub id: String,
    pub config: SshConfig,
    pub status: String, // "connecting" | "connected" | "disconnected"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshMetricsPayload {
    pub session_id: String,
}

struct SshConnection {
    session: Ssh2Session,
    channel: Arc<Mutex<ssh2::Channel>>,
}

pub struct SshSessionManager {
    sessions: Arc<Mutex<HashMap<String, Arc<Mutex<SshConnection>>>>>,
    info: Arc<Mutex<HashMap<String, SshSessionInfo>>>,
}

impl SshSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            info: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

pub type SshSessions = Arc<Mutex<SshSessionManager>>;

#[tauri::command]
pub async fn ssh_connect(
    app: AppHandle,
    session_id: String,
    config: SshConfig,
    manager: State<'_, SshSessions>,
) -> Result<String, String> {
    log::info!("SSH connecting to {}@{}:{}", config.username, config.host, config.port);

    let tcp = TcpStream::connect(format!("{}:{}", config.host, config.port))
        .map_err(|e| format!("TCP连接失败: {}", e))?;

    let mut sess = Ssh2Session::new().map_err(|e| format!("创建SSH会话失败: {}", e))?;
    sess.set_tcp_stream(tcp);
    sess.handshake()
        .map_err(|e| format!("SSH握手失败: {}", e))?;

    // 认证
    match config.auth_type.as_str() {
        "password" => {
            let password = config
                .password
                .as_ref()
                .ok_or("密码认证需要提供密码")?;
            sess.userauth_password(&config.username, password)
                .map_err(|e| format!("密码认证失败: {}", e))?;
        }
        "key" => {
            let private_key = config
                .private_key
                .as_ref()
                .ok_or("密钥认证需要提供私钥")?;

            // 尝试从内存加载私钥
            sess.userauth_pubkey_memory(
                &config.username,
                None,
                private_key,
                config.passphrase.as_deref(),
            )
            .map_err(|e| format!("密钥认证失败: {}", e))?;
        }
        _ => return Err(format!("不支持的认证类型: {}", config.auth_type)),
    }

    if !sess.authenticated() {
        return Err("SSH认证失败".to_string());
    }

    // 创建 PTY 通道
    let mut channel = sess
        .channel_session()
        .map_err(|e| format!("创建通道失败: {}", e))?;

    channel
        .request_pty("xterm-256color", None, Some((80, 24, 0, 0)))
        .map_err(|e| format!("请求PTY失败: {}", e))?;

    channel
        .shell()
        .map_err(|e| format!("启动shell失败: {}", e))?;

    let channel = Arc::new(Mutex::new(channel));

    // 保存连接
    let connection = Arc::new(Mutex::new(SshConnection {
        session: sess,
        channel: channel.clone(),
    }));

    let session_info = SshSessionInfo {
        id: session_id.clone(),
        config: config.clone(),
        status: "connected".to_string(),
    };

    let mgr = manager.lock().unwrap();
    mgr.sessions
        .lock()
        .unwrap()
        .insert(session_id.clone(), connection);
    mgr.info
        .lock()
        .unwrap()
        .insert(session_id.clone(), session_info);
    drop(mgr);

    // 启动数据读取线程
    let session_id_clone = session_id.clone();
    let app_clone = app.clone();
    thread::spawn(move || {
        read_ssh_data(app_clone, session_id_clone, channel);
    });

    log::info!("SSH连接成功: {}", session_id);
    Ok(session_id)
}

fn read_ssh_data(app: AppHandle, session_id: String, channel: Arc<Mutex<ssh2::Channel>>) {
    let mut buffer = [0u8; 4096];

    loop {
        let mut ch = match channel.lock() {
            Ok(ch) => ch,
            Err(_) => break,
        };

        match ch.read(&mut buffer) {
            Ok(0) => {
                // 连接关闭
                log::info!("SSH会话关闭: {}", session_id);
                let _ = app.emit(
                    "ssh:close",
                    serde_json::json!({ "id": session_id, "reason": "eof" }),
                );
                break;
            }
            Ok(n) => {
                let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                log::debug!("SSH收到数据: {} bytes", n);

                let _ = app.emit(
                    "ssh:data",
                    serde_json::json!({ "id": session_id, "data": data }),
                );
            }
            Err(e) => {
                log::error!("SSH读取错误: {}", e);
                let _ = app.emit(
                    "ssh:error",
                    serde_json::json!({ "id": session_id, "error": e.to_string() }),
                );
                break;
            }
        }
    }
}

#[tauri::command]
pub async fn ssh_disconnect(
    session_id: String,
    manager: State<'_, SshSessions>,
) -> Result<(), String> {
    log::info!("SSH断开连接: {}", session_id);

    let mgr = manager.lock().unwrap();

    // 移除会话信息
    mgr.info.lock().unwrap().remove(&session_id);

    // 关闭连接（自动释放资源）
    if let Some(conn) = mgr.sessions.lock().unwrap().remove(&session_id) {
        // Channel 会在 drop 时自动关闭
        drop(conn);
    }

    Ok(())
}

#[tauri::command]
pub async fn ssh_write(
    session_id: String,
    data: String,
    manager: State<'_, SshSessions>,
) -> Result<(), String> {
    log::debug!("SSH写入数据到 {}: {} bytes", session_id, data.len());

    let mgr = manager.lock().unwrap();
    let sessions = mgr.sessions.lock().unwrap();

    let conn = sessions
        .get(&session_id)
        .ok_or("SSH会话不存在")?;

    let conn = conn.lock().unwrap();
    let mut channel = conn.channel.lock().unwrap();

    channel
        .write_all(data.as_bytes())
        .map_err(|e| format!("写入失败: {}", e))?;

    channel.flush().map_err(|e| format!("刷新失败: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn ssh_resize(
    session_id: String,
    cols: u32,
    rows: u32,
    manager: State<'_, SshSessions>,
) -> Result<(), String> {
    log::debug!("SSH调整窗口大小 {} to {}x{}", session_id, cols, rows);

    let mgr = manager.lock().unwrap();
    let sessions = mgr.sessions.lock().unwrap();

    let conn = sessions
        .get(&session_id)
        .ok_or("SSH会话不存在")?;

    let conn = conn.lock().unwrap();
    let mut channel = conn.channel.lock().unwrap();

    channel
        .request_pty_size(cols, rows, None, None)
        .map_err(|e| format!("调整PTY大小失败: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn ssh_list_sessions(
    manager: State<'_, SshSessions>,
) -> Result<Vec<SshSessionInfo>, String> {
    let mgr = manager.lock().unwrap();
    let info = mgr.info.lock().unwrap();
    Ok(info.values().cloned().collect())
}

#[tauri::command]
pub async fn ssh_test(config: SshConfig) -> Result<(), String> {
    let tcp = TcpStream::connect(format!("{}:{}", config.host, config.port))
        .map_err(|e| format!("TCP连接失败: {}", e))?;

    let mut sess = Ssh2Session::new().map_err(|e| format!("创建SSH会话失败: {}", e))?;
    sess.set_tcp_stream(tcp);
    sess.handshake()
        .map_err(|e| format!("SSH握手失败: {}", e))?;

    match config.auth_type.as_str() {
        "password" => {
            let password = config
                .password
                .as_ref()
                .ok_or("密码认证需要提供密码")?;
            sess.userauth_password(&config.username, password)
                .map_err(|e| format!("密码认证失败: {}", e))?;
        }
        "key" => {
            let private_key = config
                .private_key
                .as_ref()
                .ok_or("密钥认证需要提供私钥")?;
            sess.userauth_pubkey_memory(
                &config.username,
                None,
                private_key,
                config.passphrase.as_deref(),
            )
            .map_err(|e| format!("密钥认证失败: {}", e))?;
        }
        "interactive" => {}
        _ => return Err(format!("不支持的认证类型: {}", config.auth_type)),
    }

    if config.auth_type != "interactive" && !sess.authenticated() {
        return Err("SSH认证失败".to_string());
    }

    Ok(())
}

#[tauri::command]
pub async fn ssh_metrics(_payload: SshMetricsPayload) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "supported": false,
        "metrics": serde_json::Value::Null
    }))
}
