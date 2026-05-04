# AstraShell 代理接手指南

> 最后更新：2026-05-04  
> 当前桌面端版本：v0.3.20  
> 主要开发分支：main

## 项目定位

AstraShell 是一个开源、免费、跨平台的终端工作台，面向个人运维和轻量服务器管理场景。当前主线是 `app/` 下的 Electron + Vue 3 桌面端，目标不是单独做一个 SSH 客户端，而是把 SSH、SFTP、本地终端、串口、代码片段、密钥仓库、数据库工作台、同步中心、操作日志和版本更新整合到同一条工作流里。

仓库中也包含 `mobile/` 移动端，当前是 Expo + React Native 原型/预览方向，功能成熟度低于桌面端。

**重要说明**：

- 部分早期文档（如 `ARCHITECTURE.md`）仍使用 `LightTerm` 名称，这是项目的早期名称
- 当前项目对外名称与包名应以 `AstraShell`、`astrashell-desktop`、`astrashell-mobile` 为准
- 接手时优先以 `README.md`、`AGENTS.md` 和实际代码为准，早期文档仅供架构参考

## 快速定位

### 接手时优先检查

```bash
# 查看当前状态
git status --short

# 查看版本号和基本配置
sed -n '1,120p' app/package.json

# 查看最近提交
git log --oneline -10

# 了解项目能力
cat README.md
```

### 关键目录导航

```text
AstraShell/
├─ app/                      # 桌面端主目录（Electron + Vue 3）
│  ├─ electron/              # Electron 主进程
│  │  ├─ main.mjs            # 主进程入口与窗口生命周期
│  │  ├─ preload.mjs         # 安全桥接 API（ESM）
│  │  ├─ preload.cjs         # 安全桥接 API（CJS）
│  │  ├─ after-pack.cjs      # 打包后处理
│  │  └─ ipc/                # IPC 模块集合
│  │     ├─ ssh.mjs          # SSH 连接、命令、状态管理
│  │     ├─ sftp.mjs         # SFTP 文件传输与目录操作
│  │     ├─ database.mjs     # 数据库连接与查询
│  │     ├─ local.mjs        # 本地终端（node-pty）
│  │     ├─ localfs.mjs      # 本地文件系统访问
│  │     └─ schemas.mjs      # IPC 参数校验与结构定义
│  ├─ src/                   # Vue 渲染端
│  │  ├─ main.ts             # 渲染端入口
│  │  ├─ App.vue             # 应用根组件
│  │  ├─ components/         # 组件库（约 23 个 Vue 文件）
│  │  │  ├─ AppShell.vue     # 主工作台外壳
│  │  │  ├─ AppSidebar.vue   # 左侧导航栏
│  │  │  ├─ TerminalWorkspace.vue  # 终端工作区
│  │  │  └─ panels/          # 业务面板集合
│  │  │     ├─ HostsPanel.vue      # 主机管理
│  │  │     ├─ SftpPanel.vue       # SFTP 工作区
│  │  │     ├─ DatabasePanel.vue   # 数据库工作台
│  │  │     ├─ SnippetsPanel.vue   # 代码片段
│  │  │     ├─ LocalPanel.vue      # 本地终端
│  │  │     ├─ SerialPanel.vue     # 串口工具
│  │  │     ├─ VaultPanel.vue      # 密钥仓库
│  │  │     ├─ SettingsPanel.vue   # 设置与同步
│  │  │     └─ LogsPanel.vue       # 操作日志
│  │  ├─ composables/        # 业务逻辑层（约 49 个 TS 文件）
│  │  │  ├─ useTerminalRuntime.ts        # 终端运行时核心
│  │  │  ├─ useSshConnection.ts          # SSH 连接管理
│  │  │  ├─ useSftpWorkspace.ts          # SFTP 工作区状态
│  │  │  ├─ useDatabaseWorkspace.ts      # 数据库工作区
│  │  │  ├─ useHostWorkspace.ts          # 主机管理状态
│  │  │  ├─ useLocalTerminalManager.ts   # 本地终端管理
│  │  │  ├─ useStorageManager.ts         # 持久化管理
│  │  │  └─ ...更多业务模块
│  │  ├─ styles/
│  │  │  ├─ app-shell.css          # 主界面样式
│  │  │  ├─ style.css              # 全局样式
│  │  │  └─ theme-light-gray.css   # 浅灰主题
│  │  └─ utils/                    # 工具函数
│  ├─ build/                 # 打包资源（图标等）
│  ├─ scripts/               # 构建与测试脚本
│  ├─ package.json           # 依赖与版本定义
│  ├─ vite.config.ts         # Vite 配置
│  ├─ vitest.config.ts       # 测试配置
│  └─ tsconfig.json          # TypeScript 配置
├─ mobile/                   # 移动端（Expo React Native）
│  ├─ app/                   # 页面与路由
│  ├─ components/            # React Native 组件
│  └─ package.json           # 移动端依赖
├─ docs/                     # 文档与资源
│  ├─ index.html             # 项目展示页
│  ├─ release-notes/         # 发布说明
│  └─ screenshots/           # 截图资源
├─ memory/                   # 项目事实资料
├─ 资料/                     # 本地交接资料（.gitignore 排除）
├─ README.md                 # 对外项目说明
├─ AGENTS.md                 # 本文档
├─ ARCHITECTURE.md           # 早期架构说明（使用 LightTerm 名称）
└─ LICENSE                   # MIT 许可证
```

## 技术栈

### 桌面端核心依赖

| 分类 | 技术 | 说明 |
| --- | --- | --- |
| 框架 | Electron | 桌面壳，主进程入口 `app/electron/main.mjs` |
| 前端 | Vue 3 + TypeScript + Vite | 渲染端，入口 `app/src/main.ts` |
| 状态管理 | Composition API | 无需 Pinia，状态在 `composables/` 中管理 |
| 终端渲染 | xterm.js (`@xterm/xterm`) | SSH 和本地终端显示 |
| SSH/SFTP | `ssh2` | SSH 连接与 SFTP 文件传输 |
| 本地终端 | `node-pty` | 伪终端支持 |
| 串口 | `serialport` | 串口通信 |
| 数据库 | `better-sqlite3` | 本地持久化 |
| 数据库连接 | `mysql2`, `pg`, `mssql` | 数据库工作台支持多种数据库 |
| 图标库 | `lucide-vue-next` | 统一图标方案 |
| 更新 | `electron-updater` | GitHub Release 自动更新 |
| 参数校验 | `zod` | IPC 参数结构验证 |

### 移动端技术栈

- Expo + React Native
- 当前为原型/预览阶段，已有主机、SFTP、代码片段、设置等 UI 骨架
- **安全要求**：禁止提交真实服务器 IP、账号、密钥或数据库连接信息

## 核心能力概览

### 1. 主机管理（Hosts）
- 主机分类、搜索、到期提醒
- 聚焦卡片视图
- 双击直连 SSH
- 相关文件：`panels/HostsPanel.vue`、`panels/hosts/`、`composables/useHostWorkspace.ts`

### 2. SSH 终端
- 多标签管理、标签关闭、状态栏
- 编码切换（UTF-8、GBK 等）
- 代码片段执行
- 右键复制粘贴
- 相关文件：`composables/useTerminalRuntime.ts`、`useSshConnection.ts`、`ipc/ssh.mjs`

### 3. SFTP 工作区
- 双栏设计：本地/远程独立连接
- 拖拽上传下载、目录级传输
- 排序、路径切换、文件操作
- 相关文件：`panels/SftpPanel.vue`、`composables/useSftpWorkspace.ts`、`ipc/sftp.mjs`

### 4. 数据库工作台
- 支持 MySQL、PostgreSQL、SQL Server
- 数据库切换、表浏览
- SQL 查询、结果展示、Excel 导出
- 代码片段选择与执行
- 相关文件：`panels/DatabasePanel.vue`、`panels/database/`、`composables/useDatabaseWorkspace.ts`、`ipc/database.mjs`

### 5. 代码片段（Snippets）
- 分类管理、说明文档、提醒日期
- 绑定服务器、执行结果回写
- 可在终端、数据库工作台中调用
- 相关文件：`panels/SnippetsPanel.vue`、`composables/snippetManager*.ts`

### 6. 本地终端（Local Terminal）
- 多会话管理
- 返回面板不掉线
- 选中标签后可发送片段
- 相关文件：`panels/LocalPanel.vue`、`composables/useLocalTerminalManager.ts`、`ipc/local.mjs`

### 7. 串口工具（Serial）
- 端口扫描、连接管理
- ASCII/HEX 显示与发送
- 定时发送
- 相关文件：`panels/SerialPanel.vue`

### 8. 密钥仓库（Vault）
- 主密码解锁
- 私钥、公钥、证书统一保存
- 加密存储（AES-256-GCM）
- 相关文件：`panels/VaultPanel.vue`

### 9. 操作日志（Logs）
- 按目标聚合输入和系统反馈
- 操作追溯
- 相关文件：`panels/LogsPanel.vue`

### 10. 同步中心（Sync）
- 固定本地数据库 + 外部数据库文件同步
- 支持立即上传、立即下载、自动上传
- 推荐同步位置：iCloud、SMB、U 盘、NAS 挂载目录
- 相关文件：`panels/SettingsPanel.vue`

### 11. 版本更新（Update）
- GitHub Release 检查更新与下载
- 支持 macOS 和 Windows 自动更新
- 相关配置：`app/package.json` 的 `build.publish`

## 常用命令

### 桌面端开发

```bash
cd app
npm install
npm run dev             # 同时启动 Vite 与 Electron
```

### 桌面端检查

```bash
cd app
npm run typecheck       # TypeScript 类型检查
npm run lint            # ESLint 检查
npm run test            # Vitest 单元测试
npm run build:web       # Vite 构建
npm run check           # 组合检查（lint + test + build）
```

**测试说明**：

- 测试框架：Vitest
- 配置文件：`app/vitest.config.ts`
- 测试文件匹配：`src/**/*.test.ts`
- 已有测试：
  - `app/src/utils/quickConnect.test.ts`
  - `app/src/composables/useSnippetCommandCompletion.test.ts`

### 桌面端打包

```bash
cd app
npm run dist            # 构建 macOS、Windows、Linux 安装包
```

产物目录：`app/release/`

**打包平台说明**：

| 平台 | 目标格式 | 状态 |
| --- | --- | --- |
| macOS | dmg, zip | 主线发布，未签名 |
| Windows x64 | exe, nsis | 已支持，支持自动更新 |
| Linux | AppImage, deb | 构建链路已保留 |

### 移动端开发

```bash
cd mobile
npm install
npm run start           # 启动 Expo 开发服务器
```

Expo 控制台快捷键：

- `a`：Android 模拟器
- `i`：iOS 模拟器
- `w`：Web 预览

## 架构设计

### Electron 层（主进程）

**入口与生命周期**：

- `app/electron/main.mjs`：主进程入口，窗口创建与生命周期管理
- `app/electron/preload.mjs` / `preload.cjs`：渲染端安全桥接 API

**IPC 模块**（`app/electron/ipc/`）：

| 模块 | 文件 | 功能 |
| --- | --- | --- |
| SSH | `ssh.mjs` | SSH 连接、命令执行、状态管理、编码转换 |
| SFTP | `sftp.mjs` | SFTP 文件传输、目录操作、上传下载 |
| 数据库 | `database.mjs` | MySQL/PostgreSQL/SQL Server 连接与查询 |
| 本地终端 | `local.mjs` | node-pty 本地终端会话管理 |
| 本地文件系统 | `localfs.mjs` | 本地文件系统访问 |
| 参数校验 | `schemas.mjs` | IPC 参数结构定义与 Zod 校验 |

**设计原则**：

- IPC 新增能力时应通过 preload 暴露受控 API
- IPC 层必须做参数结构校验，避免直接暴露 Node 能力给渲染端
- 主进程不应有复杂业务逻辑，业务逻辑尽量放在渲染端 `composables/`

### Vue 渲染端（前端）

**层次划分**：

```text
App.vue (根组件)
  └─ AppShell.vue (主工作台)
       ├─ AppSidebar.vue (左侧导航)
       ├─ TerminalWorkspace.vue (终端工作区)
       └─ panels/ (业务面板)
            ├─ HostsPanel.vue
            ├─ SftpPanel.vue
            ├─ DatabasePanel.vue
            └─ ...其他面板
```

**Composables 设计**（`app/src/composables/`）：

- **运行时**：`useTerminalRuntime.ts` - 终端运行时核心，管理输入、输出、会话状态
- **连接管理**：`useSshConnection.ts`、`useLocalTerminalManager.ts`
- **工作区**：`useSftpWorkspace.ts`、`useDatabaseWorkspace.ts`、`useHostWorkspace.ts`
- **持久化**：`useStorageManager.ts` - 管理本地 SQLite 数据库
- **业务模块**：片段管理、串口管理、密钥仓库等

**样式设计**：

- `app/src/styles/app-shell.css`：主界面样式
- `app/src/style.css`：全局样式
- `app/src/theme-light-gray.css`：浅灰工作台主题
- 风格：密集但清晰的信息布局、工具型界面优先

## 数据与同步策略

**核心原则**：

1. **运行时始终读写固定的本地数据库**（位于应用目录）
2. **外部数据库文件只作为同步目标**，不直接替代当前运行数据库
3. **推荐同步位置**：iCloud、SMB、U 盘、NAS 挂载目录等本地可挂载路径
4. **不建议多台设备同时高频写同一个同步文件**

**数据库文件**：

- `*.db` 已在 `.gitignore` 中排除
- 禁止提交本地数据库文件到 Git

**同步工作流**：

1. 在"同步中心"（SettingsPanel）选择外部数据库文件
2. 保存同步配置
3. 按需执行：立即下载、立即上传或自动上传

## 安全与隐私注意

### 敏感信息管理

**禁止提交以下内容到 Git**：

- 真实服务器 IP、账号、密码
- SSH 私钥、公钥、证书
- 数据库连接串
- 同步数据库文件
- API Token 或其他敏感凭证

**特殊目录**：

- `资料/` - 本地交接资料目录，已在 `.gitignore` 排除
- **默认不要读取后写入公开文档或提交**

### 密钥仓库设计

- 使用主密码派生密钥
- 私钥使用 AES-256-GCM 加密后落盘
- 改动 Vault、同步或数据库字段时要优先考虑迁移和脱敏

### IPC 安全

- 通过 preload 暴露受控 API
- IPC 层做参数结构校验（`schemas.mjs`）
- 避免直接暴露 Node 能力给渲染端

## 开发约定

### 代码风格

1. **保持 Composition API 风格**：业务状态和动作尽量放在 `app/src/composables/`
2. **UI 风格一致**：贴合当前浅灰工作台风格，左侧导航、密集但清晰的信息布局
3. **图标统一**：优先使用 `lucide-vue-next`，不要手写重复 SVG
4. **公共逻辑可测试**：优先写成 TypeScript 函数，再由 Vue 组件调用
5. **避免破坏已有会话**：涉及终端、SFTP、同步、数据库、密钥仓库的改动要谨慎

### 测试约定

- 新增或修改可独立验证的逻辑时，优先补充 `app/src/**/*.test.ts`
- 使用 Vitest 运行测试：`npm run test`
- 测试文件与源码文件同目录

### 避免引入不必要的复杂度

- 不要添加超出任务需求的特性、重构或抽象
- 三行相似代码优于过早抽象
- 不为假设的未来需求设计

### 注释原则

- 默认不写注释
- 只在以下情况添加注释：隐藏约束、微妙不变量、特定 bug 的 workaround、会让读者困惑的行为
- 不要解释代码做什么（命名应已说明）
- 不要引用当前任务、修复或调用方（这些属于 PR 描述）

## 发布与版本管理

### 版本号来源

- 桌面端版本号：`app/package.json` 的 `version` 字段
- 当前版本：`0.3.20`

### 版本同步

发布前确保以下文件版本号同步：

1. `app/package.json`
2. `README.md` - "当前桌面端版本"
3. `docs/index.html` - 展示页版本号
4. `docs/release-notes/` - 发布说明

### 发布前检查

```bash
cd app
npm run typecheck       # 类型检查
npm run lint            # 代码检查
npm run test            # 单元测试
npm run build:web       # Web 构建
```

必要时执行完整打包：

```bash
cd app
npm run dist
```

### GitHub Release

- 发布配置：`app/package.json` 的 `build.publish`
- 仓库：`getiid/AstraShell`
- Windows 自动升级依赖 GitHub Release 附件和 `latest.yml`

### macOS 签名问题

当前 macOS 构建未签名，用户可能需要执行：

```bash
xattr -dr com.apple.quarantine /Applications/AstraShell.app
```

## 常见问题

### 为什么代码片段没有自动出现在另一台设备？

当前不是账号云同步模式，而是本地数据库 + 外部数据库文件同步：

1. 在"同步中心"选择外部数据库文件
2. 保存同步配置
3. 执行立即下载、立即上传或自动上传

### 为什么返回面板后 SSH 或本地终端还在？

这是刻意保留的工作流设计。返回只是离开终端视图，不会关闭会话，方便在 SSH、本地终端、SFTP 和数据库工作台之间切换。

### 如何查看项目统计信息？

```bash
# Composables 文件数（业务逻辑）
find app/src/composables -name "*.ts" | wc -l    # 约 49 个

# Vue 组件文件数
find app/src/components -name "*.vue" | wc -l    # 约 23 个

# IPC 模块列表
ls -1 app/electron/ipc/*.mjs
```

## 推荐工作流

### 初次接手

```bash
# 1. 查看当前状态
git status --short

# 2. 查看最近提交
git log --oneline -10

# 3. 阅读对外说明
cat README.md

# 4. 查看版本与依赖
sed -n '1,120p' app/package.json

# 5. 启动开发环境
cd app && npm install && npm run dev
```

### 日常开发

1. 在 Hosts 中整理 SSH 主机，在 Vault 中维护密钥材料
2. 在 Snippets 中按分类沉淀脚本
3. 进入 SSH、本地终端或串口后，通过终端工具直接调用片段
4. 需要传文件时切到 SFTP 工作区
5. 需要连库排查时进入 Database 工作台
6. 需要跨设备共享时，通过 Sync 把外部数据库文件作为同步目标
7. 需要追溯操作时，进入 Logs 查看记录

### 功能开发流程

1. **理解需求**：阅读 README、AGENTS、相关 panel 和 composable
2. **规划改动**：确定涉及的文件（IPC、composable、panel、样式）
3. **实现功能**：
   - 如涉及主进程能力，先在 `ipc/` 中实现并添加参数校验
   - 在 `composables/` 中封装业务逻辑
   - 在 `panels/` 或 `components/` 中实现 UI
4. **测试验证**：
   - 运行 `npm run typecheck`、`npm run lint`、`npm run test`
   - 启动 `npm run dev` 验证功能
   - 如涉及 UI，测试主流程和边界情况
5. **补充测试**：对可独立验证的逻辑添加 `*.test.ts`
6. **提交代码**：遵循现有提交风格

### 按任务类型查找文件

| 任务类型 | 重点查看 |
| --- | --- |
| SSH 相关 | `ipc/ssh.mjs`, `composables/useTerminalRuntime.ts`, `useSshConnection.ts` |
| SFTP 相关 | `ipc/sftp.mjs`, `composables/useSftpWorkspace.ts`, `panels/SftpPanel.vue` |
| 数据库相关 | `ipc/database.mjs`, `composables/useDatabaseWorkspace.ts`, `panels/DatabasePanel.vue` |
| 片段相关 | `composables/snippetManager*.ts`, `panels/SnippetsPanel.vue` |
| 本地终端相关 | `ipc/local.mjs`, `composables/useLocalTerminalManager.ts`, `panels/LocalPanel.vue` |
| 串口相关 | `panels/SerialPanel.vue` |
| 主机管理相关 | `composables/useHostWorkspace.ts`, `panels/HostsPanel.vue`, `panels/hosts/` |
| 密钥仓库相关 | `panels/VaultPanel.vue` |
| 同步相关 | `panels/SettingsPanel.vue`, `composables/useStorageManager.ts` |
| 日志相关 | `panels/LogsPanel.vue` |
| 样式相关 | `styles/app-shell.css`, `style.css`, `theme-light-gray.css` |
| IPC 参数校验 | `ipc/schemas.mjs` |

## 扩展阅读

- [README.md](README.md) - 对外项目说明
- [ARCHITECTURE.md](ARCHITECTURE.md) - 早期架构说明（使用 LightTerm 名称）
- [docs/release-notes/](docs/release-notes/) - 发布说明
- [memory/](memory/) - 项目事实资料

## 贡献

- Issue: <https://github.com/getiid/AstraShell/issues>
- Pull Request: <https://github.com/getiid/AstraShell/pulls>

项目保持开源、免费、无阉割功能版本，欢迎继续一起打磨。

---

**最后提醒**：

- 优先以 `README.md`、`AGENTS.md` 和实际代码为准
- 早期文档（如 `ARCHITECTURE.md`）仅供架构参考
- 涉及敏感信息的改动要特别谨慎
- 新增能力时优先考虑安全、可测试性和向后兼容
