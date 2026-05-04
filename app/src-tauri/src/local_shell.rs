use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalShellConfig {
    pub shell: Option<String>,
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalShellSession {
    pub id: String,
    pub config: LocalShellConfig,
    pub status: String,
}

pub type LocalShellSessions = Arc<Mutex<HashMap<String, LocalShellSession>>>;

#[tauri::command]
pub async fn local_shell_start(
    session_id: String,
    config: LocalShellConfig,
    sessions: State<'_, LocalShellSessions>,
) -> Result<String, String> {
    log::info!("Starting local shell session: {}", session_id);

    // TODO: Implement local shell using portable-pty

    let session = LocalShellSession {
        id: session_id.clone(),
        config,
        status: "running".to_string(),
    };

    sessions.lock().unwrap().insert(session_id.clone(), session);

    Ok(session_id)
}

#[tauri::command]
pub async fn local_shell_write(
    session_id: String,
    data: String,
    sessions: State<'_, LocalShellSessions>,
) -> Result<(), String> {
    log::debug!("Local shell write to {}: {} bytes", session_id, data.len());

    // TODO: Write to PTY

    Ok(())
}

#[tauri::command]
pub async fn local_shell_resize(
    session_id: String,
    cols: u16,
    rows: u16,
    sessions: State<'_, LocalShellSessions>,
) -> Result<(), String> {
    log::debug!("Local shell resize {} to {}x{}", session_id, cols, rows);

    // TODO: Resize PTY

    Ok(())
}

#[tauri::command]
pub async fn local_shell_stop(
    session_id: String,
    sessions: State<'_, LocalShellSessions>,
) -> Result<(), String> {
    log::info!("Stopping local shell session: {}", session_id);

    sessions.lock().unwrap().remove(&session_id);

    Ok(())
}
