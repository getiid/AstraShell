use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    pub platform: String,
    pub arch: String,
    pub version: String,
    pub home_dir: String,
    pub temp_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalFsListPayload {
    pub local_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalFsItem {
    pub name: String,
    pub is_dir: bool,
    pub path: String,
    pub size: u64,
    pub created_at: u64,
    pub modified_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalFsListResponse {
    pub ok: bool,
    pub error: Option<String>,
    pub path: Option<String>,
    pub items: Option<Vec<LocalFsItem>>,
}

#[tauri::command]
pub async fn get_system_info() -> Result<SystemInfo, String> {
    let home_dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/"))
        .to_string_lossy()
        .to_string();

    let temp_dir = std::env::temp_dir()
        .to_string_lossy()
        .to_string();

    Ok(SystemInfo {
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        home_dir,
        temp_dir,
    })
}

#[tauri::command]
pub async fn get_app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let resolver = app.path();
    let app_data_dir = resolver.app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    Ok(app_data_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn show_item_in_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to show in folder: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to show in folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(std::path::Path::new(&path).parent().unwrap_or(std::path::Path::new("/")))
            .spawn()
            .map_err(|e| format!("Failed to show in folder: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn localfs_list(payload: LocalFsListPayload) -> Result<LocalFsListResponse, String> {
    #[cfg(target_os = "windows")]
    if payload.local_path.as_deref().unwrap_or("").trim().is_empty() {
        let mut items = Vec::new();
        for code in b'A'..=b'Z' {
            let drive = format!("{}:\\", code as char);
            let drive_path = PathBuf::from(&drive);
            if !drive_path.exists() {
                continue;
            }
            items.push(LocalFsItem {
                name: format!("{}:", code as char),
                is_dir: true,
                path: drive,
                size: 0,
                created_at: 0,
                modified_at: 0,
            });
        }
        return Ok(LocalFsListResponse {
            ok: true,
            error: None,
            path: Some(String::new()),
            items: Some(items),
        });
    }

    let requested_path = payload.local_path.unwrap_or_default();
    let base_path = if requested_path.trim().is_empty() {
        dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
    } else {
        PathBuf::from(requested_path.trim())
    };

    let read_dir = match fs::read_dir(&base_path) {
        Ok(read_dir) => read_dir,
        Err(error) => {
            return Ok(LocalFsListResponse {
                ok: false,
                error: Some(error.to_string()),
                path: None,
                items: None,
            });
        }
    };

    let mut items = Vec::new();
    for entry in read_dir.flatten() {
        let path = entry.path();
        let metadata = entry.metadata().ok();
        let created_at = metadata
            .as_ref()
            .and_then(|m| m.created().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let modified_at = metadata
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        items.push(LocalFsItem {
            name: entry.file_name().to_string_lossy().to_string(),
            is_dir: metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false),
            path: path.to_string_lossy().to_string(),
            size: metadata.as_ref().map(|m| m.len()).unwrap_or(0),
            created_at,
            modified_at,
        });
    }

    items.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(LocalFsListResponse {
        ok: true,
        error: None,
        path: Some(base_path.to_string_lossy().to_string()),
        items: Some(items),
    })
}
