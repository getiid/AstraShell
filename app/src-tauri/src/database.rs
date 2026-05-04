use rusqlite::{Connection, Result};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::State;

pub type DbConnection = Arc<Mutex<Option<Connection>>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbConfig {
    pub path: String,
}

#[tauri::command]
pub async fn db_init(
    config: DbConfig,
    db: State<'_, DbConnection>,
) -> Result<(), String> {
    log::info!("Initializing database at: {}", config.path);

    let conn = Connection::open(&config.path)
        .map_err(|e| format!("Failed to open database: {}", e))?;

    // Initialize database schema
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS hosts (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            host TEXT NOT NULL,
            port INTEGER NOT NULL,
            username TEXT NOT NULL,
            auth_type TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS snippets (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            content TEXT NOT NULL,
            category TEXT,
            tags TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS keys (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            public_key TEXT,
            private_key_encrypted TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        "
    ).map_err(|e| format!("Failed to initialize schema: {}", e))?;

    *db.lock().unwrap() = Some(conn);

    Ok(())
}

#[tauri::command]
pub async fn db_execute(
    sql: String,
    params: Vec<serde_json::Value>,
    db: State<'_, DbConnection>,
) -> Result<(), String> {
    log::debug!("Executing SQL: {}", sql);

    let db = db.lock().unwrap();
    let conn = db.as_ref().ok_or("Database not initialized")?;

    // TODO: Properly convert params and execute
    conn.execute(&sql, [])
        .map_err(|e| format!("SQL execution failed: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn db_query(
    sql: String,
    params: Vec<serde_json::Value>,
    db: State<'_, DbConnection>,
) -> Result<Vec<serde_json::Value>, String> {
    log::debug!("Querying SQL: {}", sql);

    let db = db.lock().unwrap();
    let conn = db.as_ref().ok_or("Database not initialized")?;

    // TODO: Properly execute query and return results

    Ok(vec![])
}

#[tauri::command]
pub async fn db_close(db: State<'_, DbConnection>) -> Result<(), String> {
    log::info!("Closing database connection");

    *db.lock().unwrap() = None;

    Ok(())
}
