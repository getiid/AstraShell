# AstraShell

<p align="center">
  <img src="docs/screenshots/astrashell-banner.png" alt="AstraShell Banner" width="320" />
</p>

<p align="center">
  开源、免费、跨平台的终端工作台，把 SSH、SFTP、本地终端、串口、代码片段、密钥仓库、同步中心和版本更新收进同一条工作流。
</p>

<p align="center">
  <a href="https://github.com/getiid/AstraShell/releases/latest">下载最新版本</a>
  ·
  <a href="https://github.com/getiid/AstraShell">GitHub 仓库</a>
  ·
  <a href="docs/index.html">项目展示页</a>
</p>

![AstraShell 当前工作台总览](docs/screenshots/workspace-2026-03-26.svg)

## 🚀 最新进展（2026-05-04）

**正在进行 Electron → Tauri 迁移！**

为了获得更小的包体积、更快的启动速度和更好的性能，我们正在将桌面端从 Electron 迁移到 Tauri（Rust + Vue 3）。

### ✅ 已完成的迁移工作

- ✅ Tauri 项目初始化和配置
- ✅ Rust 后端架构搭建（`app/src-tauri/`）
  - SSH 模块框架 (`ssh.rs`)
  - SFTP 模块框架 (`sftp.rs`)
  - 串口模块框架 (`serial.rs`)
  - 系统功能模块 (`system.rs`)
- ✅ 前端 API 桥接层（`src/lib/tauri-bridge.ts`）
- ✅ 编译成功，应用可启动
- ✅ 移除本地终端和数据库功能（简化架构）

### 📋 下一步计划

**优先级 P0 - 核心功能实现**
1. **SSH 连接** - 使用 `ssh2` crate 实现真实的 SSH 连接、PTY、数据流处理
2. **SFTP 文件传输** - 实现文件列表、上传/下载、文件操作
3. **应用数据管理** - 存储文件夹选择、配置管理、备份/恢复

**优先级 P1 - 重要功能**
4. **Vault 密钥管理** - AES-GCM 加密、密钥 CRUD
5. **Hosts 配置管理** - 主机配置 CRUD、分类管理
6. **串口通信** - 端口枚举、数据读写

**优先级 P2 - 可选功能**
7. 审计日志
8. 自动更新
9. Snippets 管理

详细迁移文档：
- [TAURI_MIGRATION_STATUS.md](TAURI_MIGRATION_STATUS.md) - 迁移状态追踪
- [TAURI_MIGRATION_GUIDE.md](TAURI_MIGRATION_GUIDE.md) - 开发指南
- [TAURI_MIGRATION_COMPLETE.md](TAURI_MIGRATION_COMPLETE.md) - 完成总结

## 项目概览

AstraShell 当前主线是 `app/` 下的桌面端，正在从 Electron + Vue 3 迁移到 Tauri (Rust) + Vue 3。目标不是单独做一个 SSH 客户端，而是把”连接、传输、执行、记录、同步、更新”串成一个持续可用的工作台。

Electron 版本已经成型的能力包括：

- ✅ SSH 多标签终端，支持快速连接、主机分类、密钥仓库、中文编码切换
- ✅ SFTP 双栏工作区，支持本地/远程独立连接、拖拽上传下载、排序和路径切换
- ✅ 代码片段中心，支持分类、说明、提醒日期、执行结果回写
- ✅ 串口工具，支持端口扫描、连接、ASCII/HEX、定时发送
- ✅ 密钥仓库，主密码解锁、私钥/公钥/证书统一保存
- ✅ 操作日志，按目标分组查看输入和系统反馈
- ✅ GitHub Release 自动更新链路

**注意：** 本地终端和数据库功能在 Tauri 版本中已移除，专注于 SSH/SFTP/串口核心功能。

## 当前界面

### 1. 主工作台

![AstraShell 工作区界面](docs/screenshots/workspace-2026-03-26.svg)

- 左侧统一切换 Hosts、SFTP、Snippets、Serial、Local、Vault、Settings、Logs
- 终端工具抽屉里可以先选片段分类，再选命令执行
- 本地终端和 SSH 一样支持多会话返回，不需要为了看别的页面先关闭会话

### 2. 本地终端面板

![AstraShell 本地终端面板](docs/screenshots/local-panel-2026-03-26.svg)

- 已开连接卡片显示最近命令和处理状态
- 单击卡片只选中目标终端，双击才真正进入终端会话
- 下方代码片段区支持分类筛选、搜索和滚动浏览，适合片段数量增多后的持续使用

## 核心模块

| 模块 | 说明 | Electron 版本 | Tauri 版本 |
| --- | --- | --- | --- |
| Hosts | 主机分类、到期提醒、卡片聚焦、双击直连 SSH | ✅ 已可用 | 🚧 待实现 |
| SSH Terminal | 多标签、编码切换、片段执行、右键复制粘贴 | ✅ 已可用 | 🚧 开发中 |
| SFTP | 双栏本地/远程工作区、拖拽上传下载、排序筛选 | ✅ 已可用 | 🚧 开发中 |
| Snippets | 分类管理、绑定服务器、手动执行、结果回写、提醒日期 | ✅ 已可用 | 🚧 待实现 |
| Serial | 扫描端口、连接、ASCII/HEX、定时发送 | ✅ 已可用 | 🚧 待实现 |
| Vault | 主密码解锁、私钥/公钥/证书统一保存 | ✅ 已可用 | 🚧 待实现 |
| Logs | 输入与反馈聚合记录，按目标分组查看 | ✅ 已可用 | 🚧 待实现 |
| Update | GitHub Release 检查更新与下载 | ✅ 已可用 | 🚧 待实现 |
| Database | 数据库服务器连接、表预览、SQL 查询 | ✅ 已可用 | ❌ 已移除 |
| Local Terminal | 多本地标签、返回不掉线 | ✅ 已可用 | ❌ 已移除 |
| Sync | 本地数据库 + 外部数据库文件同步 | ✅ 已可用 | ❌ 已移除 |

## 推荐工作流

1. 首次启动时初始化本地数据库，并设置密钥仓库主密码。
2. 如果需要跨设备同步，到“应用设置 -> 同步中心”选择或新建一个外部数据库文件。
3. 在 Hosts 中维护 SSH 主机资料和密钥引用。
4. 在 Snippets 中整理常用脚本动作，并按分类维护。
5. 进入 SSH、本地终端或串口后，通过终端工具直接调用片段。
6. 需要连库排查时，进入 Database 先连接数据库服务器，再选择数据库查看表和执行 SQL。
7. 需要传文件时切到 SFTP 双栏，左右两边独立选择本地或远程连接。
8. 需要追溯操作时，进入 Logs 查看按目标聚合的记录。

## 数据与同步策略

AstraShell 现在采用固定本地数据库方案：

- 运行时始终读写应用目录中的本地数据库
- 外部数据库文件只作为同步目标，不直接取代当前运行数据库
- 推荐把同步文件放在 iCloud、SMB、U 盘、NAS 挂载目录等本地可挂载位置
- 不建议多台设备同时高频写同一个同步文件

这个设计的目的是减少在线状态下频繁切换数据库导致的状态错乱，把同步动作显式化、可回退、可检查。

## 平台与版本

| 平台 | Electron 版本 | Tauri 版本 |
| --- | --- | --- |
| macOS | ✅ 主线发布平台 | 🚧 开发中 |
| Windows x64 | ✅ 已支持 | 🚧 开发中 |
| Linux | ✅ 已支持 | 🚧 开发中 |
| Android | 已有预览包 (React Native) | - |
| iOS | 开发中 (React Native) | - |

- 当前版本号来源：`app/package.json`
- 当前版本：`0.3.16`
- Electron 版本历史：[`docs/release-notes/`](docs/release-notes)
- Tauri 迁移进度：[TAURI_MIGRATION_STATUS.md](TAURI_MIGRATION_STATUS.md)

## 本地开发

### 桌面端 - Tauri 版本（推荐）

```bash
cd app
npm install

# 开发模式（自动启动前端和 Rust 后端）
npm run dev:tauri

# 仅启动前端
npm run dev:web

# 编译 Rust 后端
cd src-tauri && cargo build
```

### 桌面端 - Electron 版本（旧版）

```bash
cd app
npm install
npm run dev
```

常用命令：

```bash
cd app
npm run typecheck
npm test
npm run build:web
```

### 移动端

```bash
cd mobile
npm install
npm run start
```

## 打包与发布

### Tauri 版本打包

```bash
cd app

# 构建所有平台
npm run build:tauri

# 仅生成 Web 构建
npm run build:web
```

### Electron 版本打包（旧版）

```bash
cd app

# 完整打包
npm run dist

# 仅打 Windows 安装包
npx electron-builder --win --x64
```

发布前建议至少确认：

1. `app/package.json` 版本号已更新。
2. `README.md`、`docs/index.html` 和 `docs/release-notes/` 已同步。
3. `cd app && npm run typecheck && npm test` 已通过。
4. 打包产物名称与 Release 资产名称一致。

## 项目结构

```text
AstraShell/
├─ app/                            # 桌面端主目录
│  ├─ src/                         # Vue 3 前端代码
│  │  └─ lib/tauri-bridge.ts       # Tauri API 桥接层
│  ├─ src-tauri/                   # Tauri Rust 后端
│  │  ├─ src/
│  │  │  ├─ lib.rs                 # 主入口
│  │  │  ├─ ssh.rs                 # SSH 连接模块
│  │  │  ├─ sftp.rs                # SFTP 传输模块
│  │  │  ├─ serial.rs              # 串口通信模块
│  │  │  └─ system.rs              # 系统功能模块
│  │  ├─ Cargo.toml                # Rust 依赖配置
│  │  └─ tauri.conf.json           # Tauri 配置
│  ├─ electron/                    # Electron 主进程（旧版）
│  └─ package.json
├─ mobile/                         # Expo React Native 移动端
├─ docs/                           # 项目展示页、发布说明、截图资源
├─ PROJECT_MEMORY.md               # 当前项目记忆 / 接手说明
├─ ARCHITECTURE.md                 # 架构补充资料
├─ UI-IA.md                        # 信息架构与界面说明
├─ TAURI_MIGRATION_STATUS.md       # Tauri 迁移状态追踪
├─ TAURI_MIGRATION_GUIDE.md        # Tauri 开发指南
└─ TAURI_MIGRATION_COMPLETE.md     # 迁移完成总结
```

## 常见问题

### macOS 提示“已损坏，无法打开”

```bash
xattr -dr com.apple.quarantine /Applications/AstraShell.app
```

### 为什么代码片段没有自动同步到另一台设备

当前不是账号云同步模式，而是本地数据库 + 外部数据库文件同步：

- 先在“同步中心”选择外部数据库文件
- 再保存同步配置
- 最后根据需要执行“立即下载 / 立即上传 / 自动上传”

### 为什么本地终端返回面板后会话还在

这是当前刻意保留的设计。返回只离开终端视图，不关闭 PTY 会话，方便在 SSH、本地终端、SFTP 之间来回切换。

## 贡献

- Issue: <https://github.com/getiid/AstraShell/issues>
- Pull Request: <https://github.com/getiid/AstraShell/pulls>

项目保持开源、免费、无功能阉割版本，欢迎继续一起打磨。
