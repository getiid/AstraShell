use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerialPortInfo {
    pub port_name: String,
    pub port_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerialConfig {
    pub port: String,
    pub baud_rate: u32,
    pub data_bits: String,
    pub stop_bits: String,
    pub parity: String,
    pub flow_control: String,
}

pub struct SerialSessionData {
    port: Arc<Mutex<Box<dyn serialport::SerialPort>>>,
}

pub type SerialSessions = Arc<Mutex<HashMap<String, SerialSessionData>>>;

fn parse_data_bits(value: &str) -> Result<serialport::DataBits, String> {
    match value {
        "5" => Ok(serialport::DataBits::Five),
        "6" => Ok(serialport::DataBits::Six),
        "7" => Ok(serialport::DataBits::Seven),
        "8" | "" => Ok(serialport::DataBits::Eight),
        _ => Err(format!("不支持的数据位: {}", value)),
    }
}

fn parse_stop_bits(value: &str) -> Result<serialport::StopBits, String> {
    match value {
        "1" | "" => Ok(serialport::StopBits::One),
        "2" => Ok(serialport::StopBits::Two),
        _ => Err(format!("不支持的停止位: {}", value)),
    }
}

fn parse_parity(value: &str) -> Result<serialport::Parity, String> {
    match value {
        "none" | "" => Ok(serialport::Parity::None),
        "odd" => Ok(serialport::Parity::Odd),
        "even" => Ok(serialport::Parity::Even),
        _ => Err(format!("不支持的校验位: {}", value)),
    }
}

fn parse_flow_control(value: &str) -> Result<serialport::FlowControl, String> {
    match value {
        "none" | "" => Ok(serialport::FlowControl::None),
        "software" => Ok(serialport::FlowControl::Software),
        "hardware" => Ok(serialport::FlowControl::Hardware),
        _ => Err(format!("不支持的流控模式: {}", value)),
    }
}

#[tauri::command]
pub async fn serial_list_ports() -> Result<Vec<SerialPortInfo>, String> {
    log::info!("Listing serial ports");
    let ports = serialport::available_ports().map_err(|e| format!("列出串口失败: {}", e))?;
    Ok(ports
        .into_iter()
        .map(|port| {
            let port_type = match port.port_type {
                serialport::SerialPortType::UsbPort(info) => {
                    let product = info.product.unwrap_or_else(|| "USB".to_string());
                    format!("usb:{product}")
                }
                serialport::SerialPortType::BluetoothPort => "bluetooth".to_string(),
                serialport::SerialPortType::PciPort => "pci".to_string(),
                serialport::SerialPortType::Unknown => "unknown".to_string(),
            };
            SerialPortInfo {
                port_name: port.port_name,
                port_type,
            }
        })
        .collect())
}

#[tauri::command]
pub async fn serial_connect(
    app: AppHandle,
    session_id: String,
    config: SerialConfig,
    sessions: State<'_, SerialSessions>,
) -> Result<String, String> {
    log::info!("Serial connecting to {} at {} baud", config.port, config.baud_rate);
    let port = serialport::new(&config.port, config.baud_rate)
        .data_bits(parse_data_bits(&config.data_bits)?)
        .stop_bits(parse_stop_bits(&config.stop_bits)?)
        .parity(parse_parity(&config.parity)?)
        .flow_control(parse_flow_control(&config.flow_control)?)
        .timeout(Duration::from_millis(120))
        .open()
        .map_err(|e| format!("打开串口失败: {}", e))?;

    let reader = port.try_clone().map_err(|e| format!("复制串口句柄失败: {}", e))?;
    let port = Arc::new(Mutex::new(port));
    sessions
        .lock()
        .unwrap()
        .insert(session_id.clone(), SerialSessionData { port: port.clone() });

    let app_clone = app.clone();
    let read_session_id = session_id.clone();
    thread::spawn(move || {
        let mut reader = reader;
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {}
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                    let _ = app_clone.emit(
                        "serial:data",
                        serde_json::json!({
                            "id": read_session_id,
                            "data": data
                        }),
                    );
                }
                Err(error) if error.kind() == std::io::ErrorKind::TimedOut => {}
                Err(error) => {
                    let _ = app_clone.emit(
                        "serial:error",
                        serde_json::json!({
                            "id": read_session_id,
                            "error": error.to_string()
                        }),
                    );
                    break;
                }
            }
        }
    });

    Ok(session_id)
}

#[tauri::command]
pub async fn serial_disconnect(
    session_id: String,
    sessions: State<'_, SerialSessions>,
) -> Result<(), String> {
    log::info!("Serial disconnecting session: {}", session_id);
    sessions.lock().unwrap().remove(&session_id);
    Ok(())
}

#[tauri::command]
pub async fn serial_write(
    session_id: String,
    data: Vec<u8>,
    sessions: State<'_, SerialSessions>,
) -> Result<(), String> {
    log::debug!("Serial write to {}: {} bytes", session_id, data.len());
    let sessions = sessions.lock().unwrap();
    let session = sessions.get(&session_id).ok_or("串口会话不存在")?;
    let mut port = session.port.lock().unwrap();
    port.write_all(&data).map_err(|e| format!("串口写入失败: {}", e))?;
    port.flush().map_err(|e| format!("串口刷新失败: {}", e))?;
    Ok(())
}
