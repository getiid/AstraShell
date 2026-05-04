# AstraShell

<p align="center">
  <img src="docs/screenshots/astrashell-banner.png" alt="AstraShell Banner" width="320" />
</p>

<p align="center">
  开源、免费、跨平台的终端工作台，把 SSH、SFTP、串口、代码片段、密钥仓库、同步中心和版本更新收进同一条工作流。
</p>

<p align="center">
  <a href="https://github.com/getiid/AstraShell/releases/latest">下载最新版本</a>
  ·
  <a href="https://github.com/getiid/AstraShell">GitHub 仓库</a>
  ·
  <a href="docs/index.html">项目展示页</a>
</p>

![AstraShell 当前工作台](docs/screenshots/workspace-2026-05-03.png)

## 最新进展

当前仓库主线正在进行 Electron -> Tauri 迁移。桌面端现状是：

- Electron 版本仍然是稳定工作线
- `app/src-tauri/` 中已经接入 Tauri/Rust 后端骨架与迁移中的核心模块
- 本地终端和数据库能力不再作为 Tauri 迁移目标，当前聚焦 SSH / SFTP / Serial / Vault / Storage

迁移相关文档：

- [TAURI_MIGRATION_STATUS.md](TAURI_MIGRATION_STATUS.md)
- [TAURI_MIGRATION_GUIDE.md](TAURI_MIGRATION_GUIDE.md)
- [TAURI_MIGRATION_COMPLETE.md](TAURI_MIGRATION_COMPLETE.md)

## 项目概览

AstraShell 当前主线是 `app/` 下的桌面端，目标不是单独做一个 SSH 客户端，而是把连接、传输、执行、记录、同步和更新整合成一个持续可用的个人运维工作台。

仓库中也包含 `mobile/` 移动端原型，当前成熟度低于桌面端，桌面端仍是主开发与发布对象。

## 当前能力

- SSH 多标签终端，支持快速连接、编码切换、右键复制粘贴和片段执行
- Hosts 主机管理，支持分类、搜索、到期提醒、聚焦卡片和双击直连
- SFTP 双栏工作区，支持本地/远程独立连接、拖拽上传下载和目录级传输
- Snippets 代码片段中心，支持分类、说明、提醒日期和执行结果回写
- Serial 串口工具，支持端口扫描、连接、ASCII/HEX 和定时发送
- Vault 密钥仓库，统一管理私钥、公钥、证书和 API Token
- Logs 操作日志，按目标聚合记录输入和系统反馈
- Settings 中包含存储管理、同步配置、更新状态等入口

## 核心模块状态

| 模块 | Electron 版本 | Tauri 版本 |
| --- | --- | --- |
| Hosts | 已可用 | 迁移中 |
| SSH Terminal | 已可用 | 开发中 |
| SFTP | 已可用 | 开发中 |
| Snippets | 已可用 | 迁移中 |
| Serial | 已可用 | 迁移中 |
| Vault | 已可用 | 迁移中 |
| Logs | 已可用 | 迁移中 |
| Update | 已可用 | 迁移中 |
| Database | 已可用 | 不再迁移 |
| Local Terminal | 已可用 | 不再迁移 |
| Sync | 已可用 | 部分迁移中 |

## 推荐工作流

1. 在 Hosts 中整理 SSH 主机，在 Vault 中维护密钥材料。
2. 在 Snippets 中按分类沉淀部署、巡检、发布和恢复脚本。
3. 进入 SSH 或串口后，通过终端工具直接调用片段。
4. 需要传文件时切到 SFTP 工作区，左右两栏可独立选择本地或远程位置。
5. 需要跨设备共享时，通过 Settings 中的同步与存储功能管理外部数据文件。
6. 需要追溯操作时，进入 Logs 查看按目标聚合后的记录。

## 数据与同步策略

AstraShell 采用固定本地数据库方案：

- 运行时始终读写应用目录中的本地数据库
- 外部数据库文件只负责同步，不直接替代当前运行数据库
- 推荐同步位置是 iCloud、SMB、U 盘、NAS 挂载目录等本地可挂载路径
- 不建议多台设备同时高频写同一个同步文件

## 平台与版本

| 平台 | Electron 版本 | Tauri 版本 |
| --- | --- | --- |
| macOS | 主线发布平台 | 开发中 |
| Windows x64 | 已支持 | 开发中 |
| Linux | 构建链路已保留 | 开发中 |
| Android | Expo / React Native 原型 | - |
| iOS | Expo / React Native 原型 | - |

- 当前桌面端版本号来源：`app/package.json`
- 当前桌面端版本：`0.3.20`
- 发布说明目录：[`docs/release-notes/`](docs/release-notes)

## 本地开发

### Electron 桌面端

```bash
cd app
npm install
npm run dev
```

### Tauri 桌面端

```bash
cd app
npm install
npm run dev:tauri
```

常用检查：

```bash
cd app
npm run typecheck
npm run lint
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

Electron 桌面端：

```bash
cd app
npm run dist
```

Tauri 桌面端：

```bash
cd app
npm run build:tauri
```

发布前建议至少确认：

1. `app/package.json` 版本号已更新。
2. `README.md`、`docs/index.html` 和 `docs/release-notes/` 已同步到当前版本。
3. `cd app && npm run typecheck && npm run lint && npm test` 已通过。
4. GitHub Release 资产名称与版本号保持一致。

## 项目结构

```text
AstraShell/
├─ app/                 # 桌面端主目录
│  ├─ src/              # Vue 3 前端
│  ├─ electron/         # Electron 主进程
│  └─ src-tauri/        # Tauri / Rust 迁移中的后端
├─ mobile/              # Expo React Native 移动端原型
├─ docs/                # 展示页、发布说明、截图资源
├─ memory/              # 项目事实资料
├─ AGENTS.md            # 代理接手指南
└─ TAURI_MIGRATION_*.md # 迁移文档
```

## 常见问题

### macOS 提示“已损坏，无法打开”

```bash
xattr -dr com.apple.quarantine /Applications/AstraShell.app
```

### 为什么代码片段没有自动出现在另一台设备

当前不是账号云同步模式，而是本地数据库 + 外部数据库文件同步：

- 先在设置中选择外部数据库文件
- 再保存同步配置
- 最后按需要执行立即下载、立即上传或自动上传

## 贡献

- Issue: <https://github.com/getiid/AstraShell/issues>
- Pull Request: <https://github.com/getiid/AstraShell/pulls>
