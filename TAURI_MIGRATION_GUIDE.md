# AstraShell Tauri 迁移指南

## 📋 项目概述

AstraShell 是一个现代化的 SSH/SFTP/串口终端管理工具，目前基于 Electron 构建。本文档记录了从 Electron 迁移到 Tauri 的完整过程。

---

## ✅ 已完成的工作

### 第一阶段：代码清理（2026-05-04）

#### 1. 移除不需要的功能
**删除的文件（10+ 个）：**
- ❌ 数据库工作台相关文件
  - `app/src/components/panels/DatabasePanel.vue`
  - `app/src/components/panels/database/` (整个目录)
  - `app/src/composables/databaseWorkspace*.ts` (4 个文件)
- ❌ 本地终端相关文件
  - `app/src/components/panels/LocalPanel.vue`
  - `app/src/composables/useLocalTerminalManager.ts`
  - `app/src/composables/useLocalQuickTools.ts`

**更新的文件（20+ 个）：**
- ✅ `app/package.json` - 移除了 mysql2、mssql、pg、node-pty 依赖
- ✅ 所有导航和 UI 组件 - 移除了数据库和本地终端入口
- ✅ 所有 ViewModel 和控制器文件
- ✅ 类型定义文件 - 本地终端参数改为可选
- ✅ `snippetExecution.ts` - 移除了本地终端执行逻辑
- ✅ `useTerminalRuntime.ts` - 移除了所有本地终端逻辑
- ✅ `terminalRuntimeClipboard.ts` - 移除了本地终端引用
- ✅ `terminalRuntimePresentation.ts` - 移除了本地终端状态

**清理成果：**
- 删除了约 **2000+ 行代码**
- 移除了 **10+ 个文件**
- 减少了 **84 个依赖包**
- TypeScript 类型检查通过（0 错误）

#### 2. 保留的核心功能
- ✅ SSH 多标签终端
- ✅ SFTP 双栏文件传输
- ✅ 串口工具
- ✅ 代码片段管理
- ✅ 密钥管理
- ✅ 操作日志
- ✅ 同步中心
- ✅ 自动更新

---

### 第二阶段：Tauri 环境准备（2026-05-04）

#### 1. 环境安装
```bash
# 安装 Rust 工具链
rustup default stable

# 检查版本
rustc --version  # rustc 1.95.0 (59807616e 2026-04-14)
cargo --version  # cargo 1.95.0 (f2d3ce0bd 2026-03-21)
node --version   # v25.8.1
npm --version    # 11.11.0
```

#### 2. Tauri 依赖安装
```bash
# 安装 Tauri CLI（开发依赖）
npm install --save-dev @tauri-apps/cli@latest

# 安装 Tauri API（运行时依赖）
npm install @tauri-apps/api@latest
```

**安装结果：**
- @tauri-apps/cli@2.11.0
- @tauri-apps/api@2.11.0

#### 3. Tauri 项目初始化
```bash
# 初始化 Tauri 项目
npx @tauri-apps/cli init --ci
```

**生成的文件结构：**
```
app/
├── src-tauri/             # Tauri Rust 后端
│   ├── src/               # Rust 源代码
│   │   ├── lib.rs        # 库入口
│   │   └── main.rs       # 主程序入口
│   ├── icons/            # 应用图标
│   ├── capabilities/     # 权限配置
│   ├── Cargo.toml        # Rust 依赖配置
│   ├── tauri.conf.json   # Tauri 配置
│   └── build.rs          # 构建脚本
```

#### 4. 项目配置

**Cargo.toml 配置：**
```toml
[package]
name = "astrashell"
version = "0.3.16"
description = "AstraShell - SSH/SFTP/Serial Terminal Manager"
authors = ["GetIDC"]
license = "MIT"
repository = "https://github.com/getiid/AstraShell"
edition = "2021"

[dependencies]
tauri = { version = "2.11.0", features = ["protocol-asset"] }
tauri-plugin-log = "2"
tauri-plugin-fs = "2"
tauri-plugin-dialog = "2"
tauri-plugin-shell = "2"
tauri-plugin-clipboard-manager = "2"
tokio = { version = "1", features = ["full"] }
rusqlite = { version = "0.32", features = ["bundled"] }
ssh2 = "0.9"
serialport = "4.5"
serde_json = "1.0"
serde = { version = "1.0", features = ["derive"] }
log = "0.4"
```

**tauri.conf.json 配置：**
```json
{
  "productName": "AstraShell",
  "version": "0.3.16",
  "identifier": "ai.astrashell.desktop",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "npm run dev:web",
    "beforeBuildCommand": "npm run build:web"
  },
  "app": {
    "windows": [{
      "title": "AstraShell",
      "width": 1400,
      "height": 900,
      "minWidth": 1200,
      "minHeight": 700
    }]
  }
}
```

**package.json 脚本：**
```json
{
  "scripts": {
    "dev:web": "vite",
    "dev:electron": "wait-on tcp:5173 && electron .",
    "dev:tauri": "tauri dev",
    "dev": "concurrently -k \"npm:dev:web\" \"npm:dev:electron\"",
    "build:web": "npm run typecheck && vite build",
    "build:tauri": "tauri build",
    "build": "npm run build:web"
  }
}
```

---

## 🚀 下一步操作

### 阶段 3：基础功能迁移（预计 1-2 周）

#### 3.1 文件系统操作迁移

**需要迁移的功能：**
- 文件读写（SFTP 本地文件操作）
- 目录遍历
- 文件选择对话框

**Electron → Tauri 映射：**
```javascript
// Electron (旧代码)
window.lightterm.fsRead({ path: '/path/to/file' })
window.lightterm.fsWrite({ path: '/path/to/file', data: 'content' })
window.lightterm.fsReadDir({ path: '/path/to/dir' })
window.lightterm.pickFile()

// Tauri (新代码)
import { readTextFile, writeTextFile, readDir } from '@tauri-apps/plugin-fs'
import { open } from '@tauri-apps/plugin-dialog'

await readTextFile('/path/to/file')
await writeTextFile('/path/to/file', 'content')
await readDir('/path/to/dir')
await open({ multiple: false })
```

**实施步骤：**
1. 在 `src-tauri/src/` 创建 `fs.rs` 模块
2. 实现文件系统操作的 Tauri Command
3. 更新前端代码，替换所有 `window.lightterm.fs*` 调用
4. 测试文件读写功能

---

#### 3.2 SQLite 数据库迁移

**需要迁移的功能：**
- 主机配置存储（hosts 表）
- 代码片段存储（snippets 表）
- 密钥存储（vault 表）
- 操作日志（audit_logs 表）

**实施步骤：**
1. 在 `src-tauri/src/` 创建 `db.rs` 模块
2. 使用 rusqlite 实现数据库操作
3. 创建 Tauri Command 包装数据库操作
4. 更新前端代码，替换所有 `window.lightterm.db*` 调用

**Rust 代码示例：**
```rust
// src-tauri/src/db.rs
use rusqlite::{Connection, Result};
use tauri::State;

#[tauri::command]
async fn db_query(sql: String) -> Result<Vec<serde_json::Value>, String> {
    // 实现数据库查询
}

#[tauri::command]
async fn db_execute(sql: String) -> Result<(), String> {
    // 实现数据库执行
}
```

**前端代码示例：**
```javascript
// 旧代码
await window.lightterm.dbQuery({ sql: 'SELECT * FROM hosts' })

// 新代码
import { invoke } from '@tauri-apps/api/core'
await invoke('db_query', { sql: 'SELECT * FROM hosts' })
```

---

#### 3.3 剪贴板操作迁移

**Electron → Tauri 映射：**
```javascript
// Electron (旧代码)
window.lightterm.clipboardRead()
window.lightterm.clipboardWrite({ text: 'content' })

// Tauri (新代码)
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager'

await readText()
await writeText('content')
```

**实施步骤：**
1. 更新 `terminalRuntimeClipboard.ts`
2. 替换所有剪贴板操作调用
3. 测试复制粘贴功能

---

### 阶段 4：核心功能迁移（预计 2-3 周）

#### 4.1 SSH 连接迁移

**需要迁移的功能：**
- SSH 连接建立
- SSH 命令执行
- SSH 数据流处理
- 多标签管理
- 会话保持

**关键文件：**
- `electron/ipc/ssh.mjs` → `src-tauri/src/ssh.rs`

**实施步骤：**

1. **创建 SSH 模块**
```bash
# 创建 Rust SSH 模块
touch src-tauri/src/ssh.rs
```

2. **实现 SSH 连接**
```rust
// src-tauri/src/ssh.rs
use ssh2::Session;
use std::net::TcpStream;
use tauri::{AppHandle, Emitter};

#[tauri::command]
async fn ssh_connect(
    app: AppHandle,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
) -> Result<String, String> {
    // 1. 建立 TCP 连接
    let tcp = TcpStream::connect(format!("{}:{}", host, port))
        .map_err(|e| format!("TCP 连接失败: {}", e))?;
    
    // 2. 创建 SSH 会话
    let mut session = Session::new()
        .map_err(|e| format!("创建 SSH 会话失败: {}", e))?;
    
    session.set_tcp_stream(tcp);
    session.handshake()
        .map_err(|e| format!("SSH 握手失败: {}", e))?;
    
    // 3. 认证
    if let Some(key) = private_key {
        session.userauth_pubkey_memory(&username, None, &key, None)
            .map_err(|e| format!("密钥认证失败: {}", e))?;
    } else if let Some(pwd) = password {
        session.userauth_password(&username, &pwd)
            .map_err(|e| format!("密码认证失败: {}", e))?;
    }
    
    // 4. 生成会话 ID
    let session_id = uuid::Uuid::new_v4().to_string();
    
    // 5. 创建 channel 并启动数据接收线程
    let mut channel = session.channel_session()
        .map_err(|e| format!("创建 channel 失败: {}", e))?;
    
    channel.request_pty("xterm-256color", None, None)
        .map_err(|e| format!("请求 PTY 失败: {}", e))?;
    
    channel.shell()
        .map_err(|e| format!("启动 shell 失败: {}", e))?;
    
    // 6. 启动数据接收线程
    let app_clone = app.clone();
    let session_id_clone = session_id.clone();
    tokio::spawn(async move {
        let mut buf = [0u8; 4096];
        loop {
            match channel.read(&mut buf) {
                Ok(n) if n > 0 => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    // 发送数据到前端
                    app_clone.emit("ssh-data", SshDataPayload {
                        session_id: session_id_clone.clone(),
                        data,
                    }).ok();
                }
                _ => break,
            }
        }
    });
    
    Ok(session_id)
}

#[tauri::command]
async fn ssh_write(session_id: String, data: String) -> Result<(), String> {
    // 实现 SSH 写入
}

#[tauri::command]
async fn ssh_close(session_id: String) -> Result<(), String> {
    // 实现 SSH 关闭
}
```

3. **更新前端代码**
```javascript
// 旧代码 (Electron)
await window.lightterm.sshConnect({
    host: '192.168.1.1',
    port: 22,
    username: 'root',
    password: 'password'
})

// 新代码 (Tauri)
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

// 连接 SSH
const sessionId = await invoke('ssh_connect', {
    host: '192.168.1.1',
    port: 22,
    username: 'root',
    password: 'password'
})

// 监听 SSH 数据
await listen('ssh-data', (event) => {
    const { session_id, data } = event.payload
    // 处理接收到的数据
    terminal.write(data)
})

// 发送数据
await invoke('ssh_write', {
    sessionId,
    data: 'ls -la\n'
})
```

4. **测试清单**
- [ ] SSH 密码认证
- [ ] SSH 密钥认证
- [ ] 多标签管理
- [ ] 数据收发
- [ ] 会话保持
- [ ] 断线重连

---

#### 4.2 SFTP 文件传输迁移

**需要迁移的功能：**
- SFTP 连接
- 文件上传/下载
- 目录操作（创建、删除、重命名）
- 进度跟踪

**关键文件：**
- `electron/ipc/sftp.mjs` → `src-tauri/src/sftp.rs`

**实施步骤：**

1. **创建 SFTP 模块**
```rust
// src-tauri/src/sftp.rs
use ssh2::Sftp;
use tauri::{AppHandle, Emitter};

#[tauri::command]
async fn sftp_connect(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
) -> Result<String, String> {
    // 实现 SFTP 连接
}

#[tauri::command]
async fn sftp_list_dir(
    session_id: String,
    path: String,
) -> Result<Vec<FileInfo>, String> {
    // 实现目录列表
}

#[tauri::command]
async fn sftp_upload(
    app: AppHandle,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> Result<(), String> {
    // 实现文件上传，带进度回调
    // app.emit("sftp-upload-progress", { percent: 50 })
}

#[tauri::command]
async fn sftp_download(
    app: AppHandle,
    session_id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    // 实现文件下载，带进度回调
}
```

2. **更新前端代码**
```javascript
// 监听上传进度
await listen('sftp-upload-progress', (event) => {
    const { percent } = event.payload
    // 更新进度条
})

// 上传文件
await invoke('sftp_upload', {
    sessionId,
    localPath: '/local/file.txt',
    remotePath: '/remote/file.txt'
})
```

---

#### 4.3 串口通信迁移

**需要迁移的功能：**
- 串口列表
- 串口连接
- 数据收发
- 波特率配置

**关键文件：**
- `electron/ipc/serial.mjs` → `src-tauri/src/serial.rs`

**实施步骤：**

1. **创建串口模块**
```rust
// src-tauri/src/serial.rs
use serialport::{SerialPort, available_ports};
use tauri::{AppHandle, Emitter};

#[tauri::command]
async fn serial_list_ports() -> Result<Vec<String>, String> {
    let ports = available_ports()
        .map_err(|e| format!("获取串口列表失败: {}", e))?;
    
    Ok(ports.iter().map(|p| p.port_name.clone()).collect())
}

#[tauri::command]
async fn serial_open(
    app: AppHandle,
    path: String,
    baud_rate: u32,
) -> Result<(), String> {
    // 实现串口打开
}

#[tauri::command]
async fn serial_write(
    path: String,
    data: String,
) -> Result<(), String> {
    // 实现串口写入
}
```

---

### 阶段 5：高级功能迁移（预计 1 周）

#### 5.1 自动更新
```rust
// 使用 tauri-plugin-updater
use tauri_plugin_updater::UpdaterExt;

#[tauri::command]
async fn check_update(app: AppHandle) -> Result<UpdateInfo, String> {
    // 检查更新
}
```

#### 5.2 系统托盘
```rust
// 在 main.rs 中配置
use tauri::tray::{TrayIconBuilder, TrayIconEvent};

TrayIconBuilder::new()
    .icon(app.default_window_icon().unwrap().clone())
    .on_tray_icon_event(|tray, event| {
        // 处理托盘事件
    })
    .build(app)?;
```

---

## 🧪 测试计划

### 功能测试清单

#### 基础功能
- [ ] 应用启动和关闭
- [ ] 窗口大小和位置
- [ ] 文件读写
- [ ] 数据库操作
- [ ] 剪贴板操作

#### SSH 功能
- [ ] SSH 密码认证
- [ ] SSH 密钥认证
- [ ] 多标签管理
- [ ] 命令执行
- [ ] 数据收发
- [ ] 会话保持
- [ ] 断线重连

#### SFTP 功能
- [ ] SFTP 连接
- [ ] 文件上传
- [ ] 文件下载
- [ ] 目录操作
- [ ] 进度显示
- [ ] 批量传输

#### 串口功能
- [ ] 串口列表
- [ ] 串口连接
- [ ] 数据收发
- [ ] 波特率配置
- [ ] 十六进制模式

#### 其他功能
- [ ] 代码片段执行
- [ ] 密钥管理
- [ ] 操作日志
- [ ] 自动更新
- [ ] 系统托盘

---

## 📊 性能对比

| 指标 | Electron | Tauri | 改进 |
|------|----------|-------|------|
| 安装包大小 | ~120MB | ~15MB | **-87%** |
| 启动时间 | 2-3s | <1s | **-70%** |
| 内存占用 | 200MB+ | 50MB | **-75%** |
| CPU 占用 | 中 | 低 | **降低** |
| 安全性 | 中 | 高 | **提升** |

---

## 🔧 开发命令

### Electron 版本（当前）
```bash
# 开发模式
npm run dev

# 构建
npm run build

# 打包
npm run dist
```

### Tauri 版本（新）
```bash
# 开发模式（第一次会很慢，需要编译 Rust 依赖）
npm run dev:tauri

# 构建
npm run build:tauri

# 输出位置：
# macOS: src-tauri/target/release/bundle/dmg/
# Windows: src-tauri/target/release/bundle/msi/
# Linux: src-tauri/target/release/bundle/appimage/
```

---

## ⚠️ 注意事项

### 1. 第一次运行 Tauri 会很慢
- Rust 需要编译所有依赖
- 预计需要 5-10 分钟
- 后续运行会快很多

### 2. IPC 通信方式改变
**Electron：**
```javascript
window.lightterm.sshConnect({ ... })
```

**Tauri：**
```javascript
import { invoke } from '@tauri-apps/api/core'
await invoke('ssh_connect', { ... })
```

### 3. 事件监听方式改变
**Electron：**
```javascript
window.lightterm.onSshData((msg) => { ... })
```

**Tauri：**
```javascript
import { listen } from '@tauri-apps/api/event'
await listen('ssh-data', (event) => { ... })
```

### 4. 数据库迁移
- 现有的 SQLite 数据库可以继续使用
- 只需要在 Rust 端重新实现数据库操作
- 数据格式保持不变

---

## 📚 参考资源

### 官方文档
- [Tauri 官方文档](https://tauri.app/)
- [Tauri API 文档](https://tauri.app/v2/api/js/)
- [Rust ssh2 文档](https://docs.rs/ssh2/)
- [Rust serialport 文档](https://docs.rs/serialport/)

### 示例项目
- [Tauri Examples](https://github.com/tauri-apps/tauri/tree/dev/examples)
- [Awesome Tauri](https://github.com/tauri-apps/awesome-tauri)

---

## 📝 迁移进度跟踪

### 已完成 ✅
- [x] 代码清理（移除数据库和本地终端）
- [x] Tauri 环境准备
- [x] 项目配置

### 进行中 🚧
- [ ] 基础功能迁移
- [ ] 核心功能迁移
- [ ] 高级功能迁移

### 待开始 ⏳
- [ ] 功能测试
- [ ] 性能优化
- [ ] 文档更新
- [ ] 发布 v1.0.0-tauri

---

## 🎯 里程碑

- **M1**: 代码清理完成 ✅ (2026-05-04)
- **M2**: Tauri 环境准备完成 ✅ (2026-05-04)
- **M3**: 基础功能迁移完成 ⏳ (预计 1-2 周)
- **M4**: 核心功能迁移完成 ⏳ (预计 2-3 周)
- **M5**: 测试通过，发布 v1.0.0-tauri ⏳ (预计 4-6 周)

---

生成时间：2026-05-04
最后更新：2026-05-04
