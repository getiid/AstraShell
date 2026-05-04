# Electron 到 Tauri 迁移进度

## ✅ 已完成的工作

### 1. Rust 后端基础架构
- ✅ 配置 Cargo.toml 依赖
- ✅ 创建模块结构
  - ssh.rs - SSH 连接管理
  - sftp.rs - SFTP 文件传输
  - serial.rs - 串口通信  
  - system.rs - 系统功能
- ✅ 注册 Tauri 命令到 lib.rs
- ✅ 编译通过

### 2. 前端适配
- ✅ 创建 Tauri API 桥接层 (tauri-bridge.ts)
- ✅ 兼容现有的 `window.lightterm` API
- ✅ 在 main.ts 中导入桥接

### 3. 移除的功能
- ❌ 本地终端 (已按用户要求删除)
- ❌ 数据库功能 (已按用户要求删除)
- ❌ 云同步功能 (暂不实现)

## 🚧 待实现的核心功能

### SSH 模块 (ssh.rs)
- [ ] 使用 ssh2 crate 实现实际的 SSH 连接
- [ ] 实现 PTY (伪终端) 支持
- [ ] 实现数据读写
- [ ] 实现窗口大小调整
- [ ] 添加事件发送 (ssh:data, ssh:close, ssh:error)

### SFTP 模块 (sftp.rs)
- [ ] 基于 SSH 连接实现 SFTP 会话
- [ ] 实现目录列表
- [ ] 实现文件上传/下载
- [ ] 实现文件删除/重命名
- [ ] 实现目录创建
- [ ] 添加进度事件 (sftp:progress)

### 串口模块 (serial.rs)
- [ ] 使用 serialport crate 实现端口枚举
- [ ] 实现串口连接配置 (波特率、数据位等)
- [ ] 实现数据读写
- [ ] 添加事件发送 (serial:data, serial:error)

### 应用管理功能
- [ ] 存储管理 (appGetStorage, appSetStorageFolder 等)
- [ ] 备份/恢复功能
- [ ] 文件对话框 (appPickStorageFolder 等)
- [ ] 外部链接打开

### Vault (密钥管理)
- [ ] 主密码设置和验证
- [ ] 密钥加密存储 (AES-GCM)
- [ ] 密钥列表/保存/获取/删除
- [ ] 私钥文件导入

### Hosts 管理
- [ ] 主机配置的 CRUD 操作
- [ ] 分类管理
- [ ] 与本地存储集成

### Snippets & Quick Tools
- [ ] 代码片段状态管理
- [ ] 快捷工具状态管理

### Audit Logs
- [ ] 审计日志记录
- [ ] 日志查询和过滤
- [ ] 日志清理

### 自动更新
- [ ] 检查更新
- [ ] 下载更新
- [ ] 安装更新
- [ ] 更新状态事件

### 本地文件系统
- [ ] localfsList - 列出本地目录

## 📝 下一步建议

### 优先级 1 - 核心终端功能
1. 实现 SSH 连接和 PTY
2. 实现 SSH 数据读写和事件

### 优先级 2 - SFTP 功能
1. 实现 SFTP 基础连接
2. 实现文件列表、上传、下载

### 优先级 3 - 应用功能
1. 实现存储管理
2. 实现 Vault 密钥管理
3. 实现 Hosts 管理

### 优先级 4 - 其他功能
1. 串口通信
2. 审计日志
3. 自动更新

## 🔧 技术栈

### Rust 后端
- tauri 2.11.0
- ssh2 0.9 (SSH/SFTP)
- serialport 4.5 (串口)
- rusqlite 0.32 (如果需要本地数据存储)
- tokio (异步运行时)

### 前端
- Vue 3
- @tauri-apps/api
- 现有的 UI 组件保持不变

## 📌 注意事项

1. Electron 的 IPC 使用 `ipcRenderer.invoke()`，Tauri 使用 `invoke()`
2. Electron 的事件监听使用 `ipcRenderer.on()`，Tauri 使用 `listen()`
3. 所有 Tauri 命令使用下划线命名 (snake_case)
4. Tauri 命令参数通过结构体传递，需要添加 `#[tauri::command]` 宏
5. 需要在 lib.rs 中注册所有命令
