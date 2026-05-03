# AstraShell 代理接手指南

## 项目定位

AstraShell 是一个开源、免费、跨平台的终端工作台，面向个人运维和轻量服务器管理场景。当前主线是 `app/` 下的 Electron + Vue 3 桌面端，目标不是单独做一个 SSH 客户端，而是把 SSH、SFTP、本地终端、串口、代码片段、密钥仓库、数据库工作台、同步中心、操作日志和版本更新整合到同一条工作流里。

仓库中也包含 `mobile/` 移动端，当前是 Expo + React Native 原型/预览方向，功能成熟度低于桌面端。

注意：部分早期文档仍使用 `LightTerm` 名称，当前项目对外名称与包名应以 `AstraShell`、`astrashell-desktop`、`astrashell-mobile` 为准。

## 主要目录

```text
AstraShell/
├─ app/                 # Electron + Vue 3 桌面端，当前主要开发与发布对象
├─ mobile/              # Expo React Native 移动端
├─ docs/                # 展示页、发布说明、截图资源、同步 HTTP API 文档
├─ memory/              # 项目事实/记忆类资料
├─ 资料/                # 本地交接资料，已在 .gitignore 中排除
├─ README.md            # 对外项目说明
├─ PROJECT_MEMORY.md    # 项目接手记忆
├─ ARCHITECTURE.md      # 架构补充说明，部分内容较早期
├─ UI-IA.md             # 信息架构与界面说明，部分内容较早期
└─ TODO.v1.md           # 早期待办
```

## 技术栈

### 桌面端 `app/`

- Electron 作为桌面壳，主进程入口为 `app/electron/main.mjs`。
- Vue 3 + TypeScript + Vite 构建渲染端。
- xterm.js 提供 SSH 和本地终端渲染能力。
- `ssh2` 负责 SSH/SFTP。
- `serialport` 负责串口能力。
- `better-sqlite3` 负责本地持久化。
- 数据库工作台依赖 `mysql2`、`mssql`、`pg` 等连接能力。
- `electron-updater` + GitHub Release 负责桌面端更新链路。
- 图标库使用 `lucide-vue-next`。

### 移动端 `mobile/`

- Expo + React Native。
- 当前版本为离线原型/预览包，已有主机、SFTP、代码片段、设置等 UI 骨架。
- 移动端资料明确要求禁止提交真实服务器 IP、账号、密钥或数据库连接信息。

## 常用命令

### 桌面端开发

```bash
cd app
npm install
npm run dev
```

`npm run dev` 会同时启动 Vite 与 Electron。

### 桌面端检查

```bash
cd app
npm run typecheck
npm run lint
npm test
npm run build:web
npm run check
```

说明：

- `npm test` 使用 Vitest，配置位于 `app/vitest.config.ts`。
- 当前测试匹配 `src/**/*.test.ts`。
- 已存在测试文件：
  - `app/src/utils/quickConnect.test.ts`
  - `app/src/composables/useSnippetCommandCompletion.test.ts`
- `npm run check` 等价于 lint、test、web build 的组合检查。

### 桌面端打包

```bash
cd app
npm run dist
```

`dist` 会先执行 Web 构建，再通过 electron-builder 打包 macOS、Windows、Linux 目标。产物目录是 `app/release/`。

### 移动端开发

```bash
cd mobile
npm install
npm run start
```

Expo 控制台常用快捷键：

- `a`：Android
- `i`：iOS
- `w`：Web 预览

## 桌面端代码导航

### Electron 层

- `app/electron/main.mjs`：Electron 主进程与窗口生命周期。
- `app/electron/preload.mjs` / `app/electron/preload.cjs`：渲染端安全桥接 API。
- `app/electron/ipc/ssh.mjs`：SSH 相关 IPC。
- `app/electron/ipc/sftp.mjs`：SFTP 相关 IPC。
- `app/electron/ipc/database.mjs`：数据库工作台相关 IPC。
- `app/electron/ipc/local.mjs`：本地终端相关 IPC。
- `app/electron/ipc/localfs.mjs`：本地文件系统相关 IPC。
- `app/electron/ipc/schemas.mjs`：IPC 参数校验/结构定义。
- `app/electron/after-pack.cjs`：打包后处理。

### Vue 渲染端

- `app/src/main.ts`：渲染端入口。
- `app/src/App.vue`：应用根组件。
- `app/src/components/AppShell.vue`：主工作台外壳。
- `app/src/components/AppSidebar.vue`：左侧导航。
- `app/src/components/TerminalWorkspace.vue`：终端工作区。
- `app/src/components/panels/`：各业务面板。
- `app/src/composables/`：核心业务状态、运行时、持久化和动作编排。
- `app/src/styles/app-shell.css` 与 `app/src/style.css`：主界面样式。
- `app/src/theme-light-gray.css`：浅灰主题。

### 重要业务面板

- `HostsPanel.vue` 与 `panels/hosts/`：主机分类、卡片、聚焦、编辑。
- `SftpPanel.vue`：双栏 SFTP/本地文件工作区。
- `DatabasePanel.vue` 与 `panels/database/`：数据库连接、表浏览、SQL 查询、片段选择。
- `SnippetsPanel.vue`：代码片段中心。
- `LocalPanel.vue`：本地终端管理。
- `SerialPanel.vue`：串口工具。
- `VaultPanel.vue`：密钥仓库。
- `SettingsPanel.vue`：设置、同步中心、更新等入口。
- `LogsPanel.vue`：操作日志。

## 核心产品能力

- Hosts：主机分类、搜索、到期提醒、聚焦卡片、双击直连 SSH。
- SSH Terminal：多标签、标签关闭、状态栏、编码切换、片段执行、右键复制粘贴。
- SFTP：双栏本地/远程工作区、独立连接、拖拽上传下载、排序和路径切换。
- Database：MySQL / SQL Server / PostgreSQL 等连接能力、数据库切换、表浏览、SQL 查询、Excel 导出。
- Snippets：分类、说明、绑定服务器、提醒日期、执行结果回写。
- Local Terminal：多本地标签、返回面板不掉线、选中标签后发送片段。
- Serial：端口扫描、连接、ASCII/HEX、定时发送。
- Vault：主密码解锁，私钥/公钥/证书统一保存。
- Logs：按目标聚合输入和系统反馈。
- Sync：固定本地数据库 + 外部数据库文件同步。
- Update：GitHub Release 检查更新与下载。

## 数据与同步策略

- 运行时始终读写应用目录中的固定本地数据库。
- 外部数据库文件只作为同步目标，不直接取代当前运行数据库。
- 推荐同步位置是 iCloud、SMB、U 盘、NAS 挂载目录等本地可挂载路径。
- 不建议多台设备同时高频写同一个同步文件。
- `*.db` 已在 `.gitignore` 中排除，不要提交本地数据库。

## 安全与隐私注意

- 禁止提交真实服务器 IP、账号、密码、私钥、公钥证书、数据库连接串、同步数据库文件。
- `资料/` 是本地交接资料目录，已被 `.gitignore` 排除，默认不要读取后写入公开文档或提交。
- 密钥仓库设计上使用主密码派生密钥，私钥加密后落盘；改动 Vault、同步或数据库字段时要优先考虑迁移和脱敏。
- IPC 新增能力时应通过 preload 暴露受控 API，并在 IPC 层做参数结构校验，避免把 Node 能力直接暴露给渲染端。

## 开发约定

- 优先保持现有 Composition API 风格，业务状态和动作尽量放在 `app/src/composables/`。
- UI 改动应贴合当前浅灰工作台风格：左侧导航、密集但清晰的信息布局、工具型界面优先。
- 新增图标优先使用 `lucide-vue-next`，不要手写重复 SVG。
- 公共逻辑优先写成可测试的 TypeScript 函数，再由 Vue 组件调用。
- 涉及终端、SFTP、同步、数据库、密钥仓库的改动要避免破坏已有会话和本地数据。
- 若新增或修改可独立验证的逻辑，优先补充 `app/src/**/*.test.ts`。

## 发布与版本注意

- 桌面端版本号来源：`app/package.json`。
- README 中版本描述、`docs/index.html`、`docs/release-notes/` 应与发布版本同步。
- 当前 GitHub Release 发布配置位于 `app/package.json` 的 `build.publish`，仓库为 `getiid/AstraShell`。
- Windows 自动升级依赖 GitHub Release 附件和 `latest.yml`。
- macOS 构建当前未签名，用户可能仍需执行：

```bash
xattr -dr com.apple.quarantine /Applications/AstraShell.app
```

发布前建议至少确认：

```bash
cd app
npm run typecheck
npm test
npm run build:web
```

必要时再执行：

```bash
cd app
npm run dist
```

## 接手时优先检查

```bash
git status --short
sed -n '1,120p' app/package.json
```

随后按任务需要查看：

- `README.md`：当前对外说明。
- `PROJECT_MEMORY.md`：最近项目记忆。
- `docs/index.html`：展示页与下载入口。
- `docs/release-notes/`：发布说明。
- `app/src/components/panels/`：主业务面板。
- `app/src/composables/`：核心业务逻辑。
- `app/electron/ipc/`：主进程能力边界。

