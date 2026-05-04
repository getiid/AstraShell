# Tauri 迁移环境准备完成

## ✅ 已完成的工作

### 1. 环境准备
- ✅ Rust 工具链安装完成（rustc 1.95.0）
- ✅ Cargo 包管理器安装完成（cargo 1.95.0）
- ✅ Node.js 环境确认（v25.8.1）
- ✅ npm 包管理器确认（11.11.0）

### 2. Tauri 依赖安装
- ✅ @tauri-apps/cli@2.11.0（开发依赖）
- ✅ @tauri-apps/api@2.11.0（运行时依赖）

### 3. Tauri 项目初始化
- ✅ 创建了 `src-tauri/` 目录
- ✅ 生成了 Tauri 配置文件
- ✅ 生成了 Rust 项目结构

### 4. 项目配置
**Cargo.toml 配置：**
- 项目名称：astrashell
- 版本：0.3.16
- 添加了核心依赖：
  - tauri 2.11.0（核心框架）
  - tauri-plugin-fs（文件系统）
  - tauri-plugin-dialog（对话框）
  - tauri-plugin-shell（Shell 命令）
  - tauri-plugin-clipboard-manager（剪贴板）
  - tokio（异步运行时）
  - rusqlite（SQLite 数据库）
  - ssh2（SSH 客户端）
  - serialport（串口通信）

**tauri.conf.json 配置：**
- 产品名称：AstraShell
- 版本：0.3.16
- 标识符：ai.astrashell.desktop
- 窗口大小：1400x900（最小 1200x700）
- 开发服务器：http://localhost:5173
- 构建输出：../dist

**package.json 脚本：**
- `npm run dev:tauri` - 启动 Tauri 开发模式
- `npm run build:tauri` - 构建 Tauri 应用

---

## 📁 项目结构

```
app/
├── src/                    # Vue 前端代码
├── src-tauri/             # Tauri Rust 后端
│   ├── src/               # Rust 源代码
│   │   ├── lib.rs        # 库入口
│   │   └── main.rs       # 主程序入口
│   ├── icons/            # 应用图标
│   ├── capabilities/     # 权限配置
│   ├── Cargo.toml        # Rust 依赖配置
│   ├── tauri.conf.json   # Tauri 配置
│   └── build.rs          # 构建脚本
├── electron/             # Electron 代码（待迁移）
├── dist/                 # 构建输出
└── package.json          # npm 配置
```

---

## 🔧 下一步工作

### 阶段 1：基础功能迁移（1-2 周）

#### 1.1 文件系统操作
**需要迁移的功能：**
- 文件读写（SFTP 本地文件操作）
- 目录遍历
- 文件选择对话框

**Electron → Tauri 映射：**
```javascript
// Electron
window.lightterm.fsRead()
window.lightterm.fsWrite()
window.lightterm.fsReadDir()

// Tauri
import { readTextFile, writeTextFile, readDir } from '@tauri-apps/plugin-fs'
import { open } from '@tauri-apps/plugin-dialog'
```

#### 1.2 SQLite 数据库
**需要迁移的功能：**
- 主机配置存储
- 代码片段存储
- 密钥存储
- 操作日志

**实现方式：**
- Rust 端：使用 rusqlite
- 前端：通过 Tauri Command 调用

#### 1.3 剪贴板操作
**需要迁移的功能：**
- 读取剪贴板
- 写入剪贴板

**Electron → Tauri 映射：**
```javascript
// Electron
window.lightterm.clipboardRead()
window.lightterm.clipboardWrite()

// Tauri
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager'
```

---

### 阶段 2：核心功能迁移（2-3 周）

#### 2.1 SSH 连接
**需要迁移的功能：**
- SSH 连接建立
- SSH 命令执行
- SSH 数据流处理
- 多标签管理

**实现方式：**
- Rust 端：使用 ssh2 crate
- 异步处理：使用 tokio
- 前端通信：通过 Tauri Event 系统

**关键文件：**
- `electron/ipc/ssh.mjs` → `src-tauri/src/ssh.rs`

#### 2.2 SFTP 文件传输
**需要迁移的功能：**
- SFTP 连接
- 文件上传/下载
- 目录操作
- 进度跟踪

**实现方式：**
- Rust 端：使用 ssh2 的 SFTP 功能
- 进度回调：通过 Tauri Event

**关键文件：**
- `electron/ipc/sftp.mjs` → `src-tauri/src/sftp.rs`

#### 2.3 串口通信
**需要迁移的功能：**
- 串口列表
- 串口连接
- 数据收发
- 波特率配置

**实现方式：**
- Rust 端：使用 serialport crate
- 数据流：通过 Tauri Event

**关键文件：**
- `electron/ipc/serial.mjs` → `src-tauri/src/serial.rs`

---

### 阶段 3：高级功能迁移（1 周）

#### 3.1 自动更新
**Electron → Tauri 映射：**
```javascript
// Electron
electron-updater

// Tauri
tauri-plugin-updater
```

#### 3.2 系统托盘
**实现方式：**
- 使用 Tauri 的系统托盘 API
- 配置托盘菜单

#### 3.3 快捷键
**实现方式：**
- 使用 Tauri 的全局快捷键 API

---

## 🚀 快速开始

### 测试 Tauri 环境
```bash
# 进入 app 目录
cd app

# 启动 Tauri 开发模式（第一次会下载依赖，需要等待）
npm run dev:tauri
```

### 构建 Tauri 应用
```bash
# 构建生产版本
npm run build:tauri

# 输出位置：
# macOS: src-tauri/target/release/bundle/dmg/
# Windows: src-tauri/target/release/bundle/msi/
# Linux: src-tauri/target/release/bundle/appimage/
```

---

## 📊 预期收益

| 指标 | Electron | Tauri | 改进 |
|------|----------|-------|------|
| 安装包大小 | ~120MB | ~15MB | **-87%** |
| 启动时间 | 2-3s | <1s | **-70%** |
| 内存占用 | 200MB+ | 50MB | **-75%** |
| 安全性 | 中 | 高 | **提升** |

---

## ⚠️ 注意事项

1. **第一次运行会很慢**
   - Rust 需要编译所有依赖
   - 预计需要 5-10 分钟
   - 后续运行会快很多

2. **SSH/SFTP 功能需要重写**
   - Electron 使用 Node.js 的 ssh2 包
   - Tauri 需要使用 Rust 的 ssh2 crate
   - API 不同，需要重新实现

3. **数据库迁移**
   - 现有的 SQLite 数据库可以继续使用
   - 只需要在 Rust 端重新实现数据库操作

4. **IPC 通信方式改变**
   - Electron：window.lightterm.*
   - Tauri：invoke() 和 Event 系统
   - 需要更新前端代码

---

## 📝 迁移检查清单

### 环境准备
- [x] 安装 Rust 工具链
- [x] 安装 Tauri CLI
- [x] 初始化 Tauri 项目
- [x] 配置 Cargo.toml
- [x] 配置 tauri.conf.json
- [x] 添加 npm 脚本

### 基础功能
- [ ] 文件系统操作
- [ ] SQLite 数据库
- [ ] 剪贴板操作
- [ ] 对话框（文件选择）

### 核心功能
- [ ] SSH 连接和命令执行
- [ ] SFTP 文件传输
- [ ] 串口通信
- [ ] 多标签管理

### 高级功能
- [ ] 自动更新
- [ ] 系统托盘
- [ ] 全局快捷键
- [ ] 应用图标

### 测试和优化
- [ ] 功能测试
- [ ] 性能测试
- [ ] 打包测试
- [ ] 文档更新

---

生成时间：2026-05-04
