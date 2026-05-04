mod ssh;
mod sftp;
mod serial;
mod system;
mod storage;

use std::collections::HashMap;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_clipboard_manager::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .manage(ssh::SshSessions::new(Mutex::new(ssh::SshSessionManager::new())))
    .manage(sftp::SftpSessions::new(Mutex::new(HashMap::new())))
    .manage(serial::SerialSessions::new(Mutex::new(HashMap::new())))
    .manage(std::sync::Arc::new(Mutex::new(storage::default_vault_runtime_state())))
    .invoke_handler(tauri::generate_handler![
      // SSH commands
      ssh::ssh_connect,
      ssh::ssh_disconnect,
      ssh::ssh_write,
      ssh::ssh_resize,
      ssh::ssh_list_sessions,
      ssh::ssh_test,
      ssh::ssh_metrics,
      // SFTP commands
      sftp::sftp_connect,
      sftp::sftp_disconnect,
      sftp::sftp_list_dir,
      sftp::sftp_upload,
      sftp::sftp_download,
      sftp::sftp_delete,
      sftp::sftp_mkdir,
      sftp::sftp_rename,
      // Serial commands
      serial::serial_list_ports,
      serial::serial_connect,
      serial::serial_disconnect,
      serial::serial_write,
      // System commands
      system::get_system_info,
      system::get_app_data_dir,
      system::show_item_in_folder,
      system::localfs_list,
      // Storage and app data commands
      storage::app_get_storage,
      storage::app_get_storage_meta,
      storage::app_refresh_storage_data,
      storage::app_pick_storage_folder,
      storage::app_pick_storage_file,
      storage::app_pick_storage_save_file,
      storage::app_set_storage_folder,
      storage::app_create_backup,
      storage::app_list_backups,
      storage::app_restore_backup,
      storage::app_open_backups_folder,
      storage::hosts_list,
      storage::hosts_save,
      storage::hosts_delete,
      storage::hosts_set_categories,
      storage::snippets_get_state,
      storage::snippets_set_state,
      storage::quicktools_get_state,
      storage::quicktools_set_state,
      storage::vault_status,
      storage::vault_set_master,
      storage::vault_unlock,
      storage::vault_reset,
      storage::vault_key_list,
      storage::vault_key_save,
      storage::vault_key_get,
      storage::vault_key_delete,
      storage::vault_key_import_file,
      storage::audit_list,
      storage::audit_append,
      storage::audit_clear,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
